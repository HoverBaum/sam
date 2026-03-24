import type { RuntimeConfig } from "./config.ts";

export interface CommandContext {
  config: RuntimeConfig;
  cwd: string;
}

export interface CommandArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

