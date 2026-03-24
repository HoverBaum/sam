import React, { useEffect, useState } from "react";
import { render, Text, useApp } from "ink";
import { IndexProgressLine } from "../ui/IndexProgressLine.tsx";
import type { RuntimeConfig } from "../config.ts";
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
const DEFAULT_FAILURE_SAMPLE_LIMIT = 3;

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

export interface IndexFailure {
  path: string;
  message: string;
}

export interface IndexRunResult {
  totalFiles: number;
  indexedCount: number;
  deletedCount: number;
  failedCount: number;
  failureSamples: IndexFailure[];
  skipEmbed: boolean;
  dryRun: boolean;
}

interface IndexVaultClient {
  files(ext?: string): Promise<string[]>;
  read(path: string): Promise<string>;
  eval(code: string): Promise<string>;
}

interface ExecuteIndexOptions {
  continueOnEmbedError?: boolean;
  maxFailureSamples?: number;
  embedText?: (config: RuntimeConfig, text: string) => Promise<number[]>;
  createVaultClient?: (config: RuntimeConfig) => IndexVaultClient;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return String((error as Error).message ?? error);
}

function formatEmbeddingFailure(config: RuntimeConfig, path: string, error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("did not contain a valid vector")) {
    return `Skipped ${path}: ${config.embeddingProvider} returned no embedding vector for "${config.embeddingModel}". Check that the selected model supports embeddings, then retry /index.`;
  }
  if (message.includes("unreachable or failed")) {
    return `Skipped ${path}: ${config.embeddingProvider} could not return embeddings from ${config.embeddingBaseUrl}. Check the service and retry /index.`;
  }
  return `Skipped ${path}: ${message}`;
}

export function indexShellMessages(result: IndexRunResult): string[] {
  if (result.failedCount === 0) {
    return [`Index run finished (${result.indexedCount} indexed, ${result.deletedCount} removed).`];
  }

  const messages = [
    `Index run finished with warnings (${result.indexedCount} indexed, ${result.deletedCount} removed, ${result.failedCount} skipped).`,
    ...result.failureSamples.map((failure) => failure.message),
  ];
  const remaining = result.failedCount - result.failureSamples.length;
  if (remaining > 0) {
    messages.push(
      remaining === 1
        ? "1 more note was skipped during indexing."
        : `${remaining} more notes were skipped during indexing.`,
    );
  }
  return messages;
}

export async function executeIndex(
  context: CommandContext,
  args: CommandArgs,
  onProgress: (state: Partial<IndexRunState>) => void,
  options: ExecuteIndexOptions = {},
): Promise<IndexRunResult> {
  const rebuild = booleanFlag(args.flags, "rebuild");
  const skipEmbed = booleanFlag(args.flags, "skip-embed");
  const continueOnEmbedError = options.continueOnEmbedError ?? false;
  const maxFailureSamples = Math.max(options.maxFailureSamples ?? DEFAULT_FAILURE_SAMPLE_LIMIT, 0);
  const embedText = options.embedText ?? embed;
  const createVaultClient = options.createVaultClient ?? ((config: RuntimeConfig) => new VaultClient(config));
  const now = options.now ?? (() => Date.now());

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
      failedCount: 0,
      failureSamples: [],
      skipEmbed,
      dryRun: true,
    };
  }

  const vault = createVaultClient(context.config);
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
  const indexedAt = now();
  const manifestFiles: Record<string, { contentHash: string; indexedAt: number }> = {
    ...(existingManifest?.files ?? {}),
  };
  const failureSamples: IndexFailure[] = [];
  let failedCount = 0;
  let indexedCount = 0;

  onProgress({ phase: "Indexing notes", done: 0, total: Math.max(targets.length, 1) });
  let dimensions: number | undefined = existingManifest?.profile.dimensions;

  for (let i = 0; i < targets.length; i += 1) {
    const path = targets[i];
    const content = await vault.read(path);
    const contentHash = await hashContent(content);

    if (skipEmbed) {
      manifestFiles[path] = { contentHash, indexedAt };
      indexedCount += 1;
      onProgress({ done: i + 1 });
      continue;
    }

    try {
      const vector = await embedText(context.config, content);
      dimensions ??= vector.length;
      manifestFiles[path] = { contentHash, indexedAt };
      store.set(path, {
        id: path,
        vector,
        metadata: { path, title: path.replace(/\.md$/, "") },
      });
      indexedCount += 1;
    } catch (error) {
      if (!continueOnEmbedError) {
        throw error;
      }
      failedCount += 1;
      if (failureSamples.length < maxFailureSamples) {
        failureSamples.push({
          path,
          message: formatEmbeddingFailure(context.config, path, error),
        });
      }
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

  const shouldPersistProfile = existingManifest !== null || skipEmbed || targets.length === 0 ||
    Object.keys(manifestFiles).length > 0 || store.size > 0;
  if (shouldPersistProfile) {
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
  }

  onProgress({
    phase: failedCount > 0 ? "Completed with warnings" : "Completed",
    done: Math.max(targets.length, 1),
    total: Math.max(targets.length, 1),
  });
  return {
    totalFiles: paths.length,
    indexedCount,
    deletedCount: staleness.deletedPaths.length,
    failedCount,
    failureSamples,
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
