import type { RuntimeConfig } from "../config.ts";

export interface BacklinkEntry {
  sourcePath: string;
  targetPath?: string;
  count?: number;
}

export interface LinkEntry {
  path: string;
  count?: number;
}

export interface UnresolvedLink {
  link: string;
  count?: number;
  sources: string[];
}

export interface FileStatEntry {
  path: string;
  mtime: number;
}

export interface OutlineNode {
  title: string;
  level: number;
  children: OutlineNode[];
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function splitLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      const trimmed = parsed.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return JSON.parse(trimmed);
      }
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function parseJson(stdout: string, commandName: string): unknown {
  const direct = tryParseJson(stdout);
  if (direct !== undefined) {
    return direct;
  }

  const lines = splitLines(stdout);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = tryParseJson(lines[i]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  const firstBrace = stdout.indexOf("{");
  const firstBracket = stdout.indexOf("[");
  const starts = [firstBrace, firstBracket].filter((index) => index >= 0);
  const start = starts.length === 0 ? -1 : Math.min(...starts);
  const lastBrace = stdout.lastIndexOf("}");
  const lastBracket = stdout.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (start >= 0 && end > start) {
    const parsed = tryParseJson(stdout.slice(start, end + 1));
    if (parsed !== undefined) {
      return parsed;
    }
  }

  throw new Error(`${commandName} expected JSON output but got non-JSON content.`);
}

function toArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  return [];
}

function readFileStatMap(payload: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const path = readString(rec, ["path", "file"]);
      const mtime = readNumber(rec, ["mtime", "modified", "stat"]);
      if (path && mtime !== undefined) {
        out[path] = mtime;
      }
    }
    return out;
  }
  if (!payload || typeof payload !== "object") {
    return out;
  }
  for (const [path, value] of Object.entries(payload)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[path] = value;
      continue;
    }
    if (typeof value === "string" && !Number.isNaN(Number(value))) {
      out[path] = Number(value);
    }
  }
  return out;
}

function normalizeOutlineLevel(level: number | undefined, fallback: number): number {
  if (level === undefined || !Number.isFinite(level)) {
    return fallback;
  }
  return Math.max(1, Math.min(6, Math.floor(level)));
}

function parseOutlineNode(value: unknown, fallbackLevel: number): OutlineNode | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const title = readString(record, ["title", "heading", "name", "text", "label"])?.trim();
  if (!title) {
    return undefined;
  }
  const level = normalizeOutlineLevel(
    readNumber(record, ["level", "depth", "headingLevel", "heading_level"]),
    fallbackLevel,
  );
  const rawChildren = record.children ?? record.items ?? record.headings ?? record.nodes ?? record.sections;
  const children = Array.isArray(rawChildren)
    ? rawChildren
      .map((child) => parseOutlineNode(child, level + 1))
      .filter((child): child is OutlineNode => child !== undefined)
    : [];
  return { title, level, children };
}

export function parseOutlineNodes(payload: unknown): OutlineNode[] {
  const rows = toArrayPayload(payload);
  return rows
    .map((row) => parseOutlineNode(row, 1))
    .filter((row): row is OutlineNode => row !== undefined);
}

async function runObsidian(
  config: RuntimeConfig,
  tokens: string[],
  options: { includeVault?: boolean } = {},
): Promise<string> {
  const includeVault = options.includeVault ?? true;
  const args = includeVault && config.vault ? [`vault=${config.vault}`, ...tokens] : tokens;

  if (config.dryRun) {
    console.log(`[dry-run] obsidian ${args.join(" ")}`);
    return "";
  }

  let result: Deno.CommandOutput;
  try {
    result = await new Deno.Command("obsidian", {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        "Obsidian CLI not found. Install/enable it and ensure Obsidian is running.",
      );
    }
    throw error;
  }

  const stdout = decode(result.stdout);
  const stderr = decode(result.stderr);

  if (result.code !== 0) {
    if (stderr.includes("Unable to connect to main process")) {
      throw new Error(
        "Unable to connect to Obsidian main process. Open the Obsidian app and retry.",
      );
    }
    throw new Error(`obsidian ${args.join(" ")} failed (${result.code})${stderr ? `: ${stderr}` : ""}`);
  }

  return stdout;
}

export class VaultClient {
  constructor(private readonly config: RuntimeConfig) {}

  async currentVaultName(): Promise<string> {
    const stdout = await runObsidian(this.config, ["vault", "info=name"]);
    const first = splitLines(stdout)[0];
    if (!first) {
      throw new Error("Obsidian CLI returned an empty vault name.");
    }
    return first;
  }

  async listVaultNames(): Promise<string[]> {
    const stdout = await runObsidian(this.config, ["vaults"], { includeVault: false });
    return splitLines(stdout);
  }

  async files(ext = "md"): Promise<string[]> {
    const stdout = await runObsidian(this.config, ["files", `ext=${ext}`]);
    return splitLines(stdout);
  }

  async read(path: string): Promise<string> {
    return runObsidian(this.config, ["read", `path=${path}`]);
  }

  async outline(path: string): Promise<OutlineNode[]> {
    const stdout = await runObsidian(this.config, ["outline", `path=${path}`, "format=json"]);
    return parseOutlineNodes(parseJson(stdout, "outline"));
  }

  async create(params: {
    path?: string;
    name?: string;
    content?: string;
    overwrite?: boolean;
    open?: boolean;
  }): Promise<void> {
    const tokens = ["create"];
    if (params.path) tokens.push(`path=${params.path}`);
    if (params.name) tokens.push(`name=${params.name}`);
    if (params.content) tokens.push(`content=${params.content}`);
    if (params.overwrite) tokens.push("overwrite");
    if (params.open) tokens.push("open");
    await runObsidian(this.config, tokens);
  }

  async eval(code: string): Promise<string> {
    return runObsidian(this.config, ["eval", `code=${code}`]);
  }

  async fileStats(paths: string[]): Promise<FileStatEntry[]> {
    if (paths.length === 0) {
      return [];
    }

    try {
      const stdout = await this.eval(
        'JSON.stringify(app.vault.getMarkdownFiles().map((f) => ({ path: f.path, mtime: f.stat.mtime ?? 0 })))',
      );
      const payload = parseJson(stdout, "eval");
      const mtimes = readFileStatMap(payload);
      return paths.map((path) => {
        const mtime = mtimes[path] ?? 0;
        return { path, mtime: Number.isFinite(mtime) ? mtime : 0 };
      });
    } catch (error) {
      if (!String((error as Error).message ?? error).includes("expected JSON output")) {
        throw error;
      }
      const out: FileStatEntry[] = [];
      for (const path of paths) {
        const stdout = await this.eval(
          `JSON.stringify(app.vault.getAbstractFileByPath(${JSON.stringify(path)})?.stat?.mtime ?? 0)`,
        );
        const payload = parseJson(stdout, "eval");
        const mtime = typeof payload === "number"
          ? payload
          : typeof payload === "string" && !Number.isNaN(Number(payload))
          ? Number(payload)
          : 0;
        out.push({ path, mtime: Number.isFinite(mtime) ? mtime : 0 });
      }
      return out;
    }
  }

  async backlinks(path: string): Promise<BacklinkEntry[]> {
    const stdout = await runObsidian(this.config, ["backlinks", `path=${path}`, "format=json"]);
    const rows = toArrayPayload(parseJson(stdout, "backlinks"));
    return rows
      .map((row): BacklinkEntry | undefined => {
        if (typeof row === "string") {
          return { sourcePath: row };
        }
        if (!row || typeof row !== "object") {
          return undefined;
        }
        const rec = row as Record<string, unknown>;
        const sourcePath = readString(rec, ["sourcePath", "source", "path", "file", "from"]);
        if (!sourcePath) {
          return undefined;
        }
        return {
          sourcePath,
          targetPath: readString(rec, ["targetPath", "target", "to"]),
          count: readNumber(rec, ["count", "total"]),
        };
      })
      .filter((row): row is BacklinkEntry => row !== undefined);
  }

  async links(path: string): Promise<LinkEntry[]> {
    const stdout = await runObsidian(this.config, ["links", `path=${path}`, "format=json"]);
    const rows = toArrayPayload(parseJson(stdout, "links"));
    return rows
      .map((row): LinkEntry | undefined => {
        if (typeof row === "string") {
          return { path: row };
        }
        if (!row || typeof row !== "object") {
          return undefined;
        }
        const rec = row as Record<string, unknown>;
        const value = readString(rec, ["path", "file", "target", "link"]);
        if (!value) {
          return undefined;
        }
        return {
          path: value,
          count: readNumber(rec, ["count", "total"]),
        };
      })
      .filter((row): row is LinkEntry => row !== undefined);
  }

  async unresolved(): Promise<UnresolvedLink[]> {
    const stdout = await runObsidian(this.config, ["unresolved", "verbose", "format=json"]);
    const rows = toArrayPayload(parseJson(stdout, "unresolved"));
    return rows
      .map((row): UnresolvedLink | undefined => {
        if (typeof row === "string") {
          return { link: row, sources: [] };
        }
        if (!row || typeof row !== "object") {
          return undefined;
        }
        const rec = row as Record<string, unknown>;
        const link = readString(rec, ["link", "name", "target"]);
        if (!link) {
          return undefined;
        }
        const rawSources = rec.sources;
        const sources = Array.isArray(rawSources)
          ? rawSources.filter((v): v is string => typeof v === "string")
          : [];
        return {
          link,
          count: readNumber(rec, ["count", "total"]),
          sources,
        };
      })
      .filter((row): row is UnresolvedLink => row !== undefined);
  }

  async orphans(): Promise<string[]> {
    const stdout = await runObsidian(this.config, ["orphans"]);
    return splitLines(stdout);
  }

  async deadends(): Promise<string[]> {
    const stdout = await runObsidian(this.config, ["deadends"]);
    return splitLines(stdout);
  }
}
