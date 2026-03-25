import React from "react";
import { render } from "ink";
import type { CommandArgs, CommandContext } from "../types.ts";
import {
  classifyStaleness,
  connectNeighbors,
  readManifest,
  resolveActiveProfileDir,
} from "../search/index.ts";
import { ConnectFlow } from "../ui/ConnectFlow.tsx";
import { useVaultDisplay } from "../ui/useVaultDisplay.ts";
import { VaultClient } from "../vault/client.ts";

function ConnectWithVault(props: { context: CommandContext; onExit: () => void }) {
  const vaultDisplay = useVaultDisplay(props.context);
  return <ConnectFlow context={props.context} vaultDisplay={vaultDisplay} onExit={props.onExit} />;
}

async function maybePrintStalenessWarning(context: CommandContext): Promise<void> {
  try {
    const vault = new VaultClient(context.config);
    const evalResult = await vault.eval(
      'JSON.stringify(app.vault.getMarkdownFiles().map(f=>({path:f.path,mtime:f.stat.mtime})))',
    );
    const files = JSON.parse(evalResult) as Array<{ path: string; mtime: number }>;
    const profileDir = await resolveActiveProfileDir(context.config);
    const manifest = await readManifest(profileDir);
    const summary = classifyStaleness(manifest, files);
    const changed = summary.newPaths.length + summary.modifiedPaths.length + summary.deletedPaths.length;
    if (changed > 0) {
      console.error(`sam connect: ${changed} notes changed since last index — run sam index to update.`);
    }
  } catch {
    // Optional: ignore if Obsidian unavailable
  }
}

export async function printConnectLines(context: CommandContext, sourcePath: string): Promise<void> {
  await maybePrintStalenessWarning(context);
  const graphCache = new Map<string, Promise<{ links: Set<string>; backlinks: Set<string> }>>();
  const vault = new VaultClient(context.config);
  const sourceLinks = await vault.links(sourcePath).then((rows) => rows.map((row) => row.path)).catch(() => []);
  const hits = await connectNeighbors(context.config, sourcePath, {
    topK: 5,
    candidatePool: 60,
    sourceLinkedPaths: sourceLinks,
    graphClient: vault,
    graphCache,
    excludeSourceLinkedPaths: true,
  });
  for (const hit of hits) {
    console.log(`${hit.id}\t${hit.finalScore.toFixed(3)}`);
  }
}

export async function runConnectCommand(context: CommandContext, args: CommandArgs): Promise<void> {
  const pathArg = args.positionals.join(" ").trim();
  if (pathArg) {
    try {
      await printConnectLines(context, pathArg);
    } catch (e) {
      console.error(`sam connect: ${String((e as Error).message ?? e)}`);
      Deno.exit(1);
    }
    return;
  }

  const instance = render(
    <ConnectWithVault
      context={context}
      onExit={() => {
        instance.unmount();
        Deno.exit(0);
      }}
    />,
  );
  await instance.waitUntilExit();
}
