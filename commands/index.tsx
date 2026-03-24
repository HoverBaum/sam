import React, { useEffect, useState } from "react";
import { render, Text, useApp } from "ink";
import { IndexProgressLine } from "../ui/IndexProgressLine.tsx";
import type { CommandArgs, CommandContext } from "../types.ts";
import { booleanFlag } from "../utils/args.ts";
import { mapLimit } from "../utils/concurrency.ts";
import { embed } from "../search/embed.ts";
import {
  assertProfileMatch,
  classifyStaleness,
  hashContent,
  indexManifestSummary,
  readManifest,
  readStore,
  resolveActiveProfileDir,
  resolveProfileDir,
  writeManifest,
  writeStore,
  type IndexManifest,
} from "../search/index.ts";
import { VaultClient } from "../vault/client.ts";

/** Max concurrent Obsidian CLI processes during mtime scan (avoids fork bombs on large vaults). */
const INDEX_OBSIDIAN_CONCURRENCY = 24;

function ProgressView(props: { total: number; done: number; phase: string }) {
  return <IndexProgressLine phase={props.phase} done={props.done} total={props.total} />;
}

interface IndexRunState {
  phase: string;
  total: number;
  done: number;
  finished: boolean;
  error?: string;
}

export interface IndexRunResult {
  totalFiles: number;
  indexedCount: number;
  deletedCount: number;
  skipEmbed: boolean;
  dryRun: boolean;
}

export async function executeIndex(
  context: CommandContext,
  args: CommandArgs,
  onProgress: (state: Partial<IndexRunState>) => void,
): Promise<IndexRunResult> {
  const rebuild = booleanFlag(args.flags, "rebuild");
  const skipEmbed = booleanFlag(args.flags, "skip-embed");

  const activeDir = await resolveActiveProfileDir(context.config);
  const existingManifest = await readManifest(activeDir);
  if (existingManifest) {
    assertProfileMatch(context.config, existingManifest);
  }

  if (context.config.dryRun) {
    const summary = indexManifestSummary(existingManifest);
    console.log("=== SAM DRY RUN ===");
    console.log(`command: sam index`);
    console.log("mode: local-manifest-preview (no Obsidian calls)");
    console.log(`indexed-files-known: ${summary.indexedFiles}`);
    console.log(`profile: ${summary.profile}`);
    console.log(`rebuild: ${rebuild}`);
    console.log(`skip-embed: ${skipEmbed}`);
    console.log("=== END DRY RUN ===");
    return {
      totalFiles: summary.indexedFiles,
      indexedCount: summary.indexedFiles,
      deletedCount: 0,
      skipEmbed,
      dryRun: true,
    };
  }

  const vault = new VaultClient(context.config);
  onProgress({ phase: "Listing markdown files", done: 0, total: 1 });
  const paths = (await vault.files("md")).filter((line) => line.endsWith(".md"));

  const pathTotal = Math.max(paths.length, 1);
  onProgress({ phase: "Checking file timestamps", done: 0, total: pathTotal });
  let mtimeDone = 0;
  const currentFiles = await mapLimit(paths, INDEX_OBSIDIAN_CONCURRENCY, async (path) => {
    const code = `JSON.stringify(app.vault.getAbstractFileByPath(${JSON.stringify(path)})?.stat?.mtime ?? 0)`;
    const mtimeText = await vault.eval(code);
    const mtime = Number(mtimeText.replaceAll("\"", ""));
    mtimeDone += 1;
    onProgress({ done: mtimeDone, total: pathTotal });
    return { path, mtime: Number.isFinite(mtime) ? mtime : 0 };
  });

  const staleness = classifyStaleness(rebuild ? null : existingManifest, currentFiles);
  const targets = rebuild ? currentFiles.map((f) => f.path) : [...staleness.newPaths, ...staleness.modifiedPaths];

  const store = await readStore(activeDir);
  const now = Date.now();
  const manifestFiles: Record<string, { contentHash: string; indexedAt: number }> = {
    ...(existingManifest?.files ?? {}),
  };

  onProgress({ phase: "Indexing notes", done: 0, total: Math.max(targets.length, 1) });
  let dimensions: number | undefined = existingManifest?.profile.dimensions;

  for (let i = 0; i < targets.length; i += 1) {
    const path = targets[i];
    const content = await vault.read(path);
    const contentHash = await hashContent(content);

    manifestFiles[path] = { contentHash, indexedAt: now };

    if (!skipEmbed) {
      const vector = await embed(context.config, content);
      dimensions ??= vector.length;
      store.set(path, {
        id: path,
        vector,
        metadata: { path, title: path.replace(/\.md$/, "") },
      });
    }

    onProgress({ done: i + 1 });
  }

  for (const deletedPath of staleness.deletedPaths) {
    delete manifestFiles[deletedPath];
    store.delete(deletedPath);
  }

  if (!dimensions) {
    dimensions = existingManifest?.profile.dimensions ?? 768;
  }

  const profileDir = await resolveProfileDir(context.config, dimensions);
  const manifest: IndexManifest = {
    profile: {
      provider: context.config.embeddingProvider,
      model: context.config.embeddingModel,
      dimensions,
    },
    files: manifestFiles,
  };

  await writeStore(profileDir, store);
  await writeManifest(profileDir, manifest);

  onProgress({ phase: "Completed", done: Math.max(targets.length, 1), total: Math.max(targets.length, 1) });
  return {
    totalFiles: paths.length,
    indexedCount: targets.length,
    deletedCount: staleness.deletedPaths.length,
    skipEmbed,
    dryRun: false,
  };
}

export async function runIndexCommand(context: CommandContext, args: CommandArgs): Promise<void> {
  const initial: IndexRunState = {
    phase: "Starting",
    done: 0,
    total: 1,
    finished: false,
  };

  const app = render(<ProgressRunner context={context} args={args} initial={initial} />);
  await app.waitUntilExit();
}

function ProgressRunner(
  { context, args, initial }: { context: CommandContext; args: CommandArgs; initial: IndexRunState },
) {
  const { exit } = useApp();
  const [state, setState] = useState<IndexRunState>(initial);

  useEffect(() => {
    executeIndex(context, args, (patch) => {
      setState((previous: IndexRunState) => ({ ...previous, ...patch }));
    })
      .then(() => setState((previous: IndexRunState) => ({ ...previous, finished: true })))
      .catch((error) =>
        setState((previous: IndexRunState) => ({
          ...previous,
          finished: true,
          error: String((error as Error).message ?? error),
        }))
      )
      .finally(() => {
        exit();
      });
  }, [context, args, exit]);

  if (state.error) {
    return <Text color="red">index failed: {state.error}</Text>;
  }
  if (state.finished) {
    return <Text color="green">index complete</Text>;
  }
  return <ProgressView total={state.total} done={state.done} phase={state.phase} />;
}
