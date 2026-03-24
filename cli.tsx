import React from "react";
import { render } from "ink";
import { ensureSamDirs, resolveRuntimeConfig } from "./config.ts";
import { parseArgs } from "./utils/args.ts";
import type { CommandArgs, CommandContext } from "./types.ts";
import { runConnectCommand } from "./commands/connect.tsx";
import { runIndexCommand } from "./commands/index.tsx";
import { runNewCommand } from "./commands/new.tsx";
import { runProcessCommand } from "./commands/process.tsx";
import { Shell } from "./ui/Shell.tsx";

async function runSubcommand(
  command: string,
  context: CommandContext,
  args: CommandArgs,
): Promise<void> {
  if (command === "index") {
    await runIndexCommand(context, args);
    return;
  }

  if (command === "connect") {
    await runConnectCommand(context, args);
    return;
  }

  if (command === "new") {
    await runNewCommand(context, args);
    return;
  }

  if (command === "process" || command === "inbox") {
    await runProcessCommand(context, args);
    return;
  }

  if (command === "help" || command === "--help") {
    console.log("sam [--dry-run] [--model <id>] [--vault <name-or-id>] [--embed-model <id>] [subcommand]");
    console.log("Subcommands: index, connect, new, process");
    return;
  }

  throw new Error(`Unknown subcommand: ${command}`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(Deno.args);
  const config = await resolveRuntimeConfig(parsed.flags);
  await ensureSamDirs();

  const context: CommandContext = {
    config,
    cwd: Deno.cwd(),
  };

  const [first, ...rest] = parsed.positionals;
  if (!first) {
    const app = render(<Shell context={context} />);
    await app.waitUntilExit();
    return;
  }

  await runSubcommand(first, context, { flags: parsed.flags, positionals: rest });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`sam error: ${message}`);
    Deno.exit(1);
  }
}
