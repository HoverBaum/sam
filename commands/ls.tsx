import type { RuntimeConfig } from "../config.ts";
import { normalize as normalizePosixPath, relative as relativePosixPath } from "@std/path/posix";
import type { CommandArgs, CommandContext } from "../types.ts";
import type { MarkdownFileWithTags } from "../vault/client.ts";
import { VaultClient } from "../vault/client.ts";

interface LsVaultClient {
  files(ext?: string): Promise<string[]>;
  markdownFilesWithTags?(): Promise<MarkdownFileWithTags[]>;
}

interface ExecuteLsOptions {
  createVaultClient?: (config: RuntimeConfig) => LsVaultClient;
}

export interface LsRunResult {
  paths: string[];
  excludedByFolder: number;
  excludedByTag: number;
}

function parseCsvFlag(
  flags: Record<string, string | boolean>,
  names: string[],
): string[] {
  const values: string[] = [];
  for (const name of names) {
    const raw = flags[name];
    if (typeof raw !== "string") continue;
    for (const item of raw.split(",")) {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        values.push(trimmed);
      }
    }
  }
  return values;
}

function normalizeVaultPath(value: string): string {
  let normalized = normalizePosixPath(value.replaceAll("\\", "/")).trim();
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function normalizeFolder(value: string): string | null {
  const normalized = normalizeVaultPath(value);
  return normalized.length > 0 ? normalized : null;
}

function pathIsInFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  if (normalizedPath === folder) {
    return true;
  }
  const rel = relativePosixPath(folder, normalizedPath);
  return rel.length > 0 && rel !== "." && !rel.startsWith("../");
}

function normalizeTag(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function tagsMatch(candidate: string, excluded: string): boolean {
  return candidate === excluded || candidate.startsWith(`${excluded}/`);
}

export async function executeLs(
  context: CommandContext,
  args: CommandArgs,
  options: ExecuteLsOptions = {},
): Promise<LsRunResult> {
  const createVaultClient = options.createVaultClient ??
    ((config: RuntimeConfig) => new VaultClient(config));
  const vault = createVaultClient(context.config);

  const excludedFolders = parseCsvFlag(args.flags, ["exclude-folder", "exclude-folders"])
    .map(normalizeFolder)
    .filter((value): value is string => value !== null);
  const excludedTags = parseCsvFlag(args.flags, ["exclude-tag", "exclude-tags"])
    .map(normalizeTag)
    .filter((value): value is string => value !== null);

  let paths = (await vault.files("md")).filter((path) =>
    path.toLowerCase().endsWith(".md")
  );

  let excludedByFolder = 0;
  if (excludedFolders.length > 0) {
    paths = paths.filter((path) => {
      const match = excludedFolders.some((folder) => pathIsInFolder(path, folder));
      if (match) excludedByFolder += 1;
      return !match;
    });
  }

  let excludedByTag = 0;
  if (excludedTags.length > 0) {
    if (!vault.markdownFilesWithTags) {
      throw new Error("Tag exclusions require a vault client that can read note tags.");
    }

    const tagRows = await vault.markdownFilesWithTags();
    const tagsByPath = new Map(
      tagRows.map((row) => [
        row.path,
        row.tags
          .map(normalizeTag)
          .filter((tag): tag is string => tag !== null),
      ]),
    );

    paths = paths.filter((path) => {
      const tags = tagsByPath.get(path) ?? [];
      const match = tags.some((tag) =>
        excludedTags.some((excludedTag) => tagsMatch(tag, excludedTag))
      );
      if (match) excludedByTag += 1;
      return !match;
    });
  }

  paths.sort((a, b) => a.localeCompare(b));

  return { paths, excludedByFolder, excludedByTag };
}

export async function runLsCommand(context: CommandContext, args: CommandArgs): Promise<void> {
  const result = await executeLs(context, args);
  for (const path of result.paths) {
    console.log(path);
  }
}
