import { basename } from "@std/path";
import type { CommandArgs, CommandContext } from "../types.ts";
import { booleanFlag } from "../utils/args.ts";
import type { BacklinkEntry, LinkEntry } from "../vault/client.ts";
import { VaultClient } from "../vault/client.ts";

interface BacklinksVaultClient {
  backlinks(path: string): Promise<BacklinkEntry[]>;
  links(path: string): Promise<LinkEntry[]>;
  read(path: string): Promise<string>;
}

interface BacklinksEntry {
  path: string;
  count: number;
  context?: string;
}

export interface BacklinksReport {
  sourcePath: string;
  includeContext: boolean;
  outgoing: BacklinksEntry[];
  incoming: BacklinksEntry[];
}

interface BacklinksReportOptions {
  includeContext?: boolean;
  createVaultClient?: (context: CommandContext) => BacklinksVaultClient;
}

interface MarkdownLine {
  text: string;
  start: number;
  end: number;
  blank: boolean;
  heading: boolean;
}

interface LinkOccurrence {
  rawTarget: string;
  index: number;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const MARKDOWN_LINK_RE = /(?<!!)\[[^\]]*]\(([^)]+)\)/g;
const HEADING_LINE_RE = /^[ \t]{0,3}#{1,6}[ \t]+\S/;
const CONTEXT_MAX_CHARS = 180;

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

function normalizeLinkTarget(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if (value.startsWith("[[") && value.endsWith("]]")) {
    value = value.slice(2, -2);
  }
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1);
  }
  if (value.includes("|")) {
    value = value.split("|")[0];
  }
  if (value.startsWith("./")) {
    value = value.slice(2);
  }
  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) {
    value = value.slice(0, hashIndex);
  }
  const queryIndex = value.indexOf("?");
  if (queryIndex >= 0) {
    value = value.slice(0, queryIndex);
  }
  return normalizePath(value);
}

function extractMarkdownLinkTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    if (closing > 1) {
      return trimmed.slice(1, closing);
    }
  }
  return trimmed;
}

function normalizeMatchKey(path: string): string {
  return stripMarkdownExtension(normalizePath(path)).toLowerCase();
}

function linkTargetsPath(rawTarget: string, candidatePath: string): boolean {
  const normalizedTarget = normalizeLinkTarget(rawTarget);
  if (!normalizedTarget) return false;
  const targetKey = normalizeMatchKey(normalizedTarget);
  const candidateNormalized = normalizePath(candidatePath);
  const candidateKey = normalizeMatchKey(candidateNormalized);
  if (targetKey === candidateKey) return true;
  return basename(targetKey) === basename(candidateKey);
}

function collectLinkOccurrences(content: string): LinkOccurrence[] {
  const out: LinkOccurrence[] = [];
  for (const match of content.matchAll(WIKILINK_RE)) {
    if (!match[1] || match.index === undefined) continue;
    out.push({ rawTarget: match[1], index: match.index });
  }
  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    if (!match[1] || match.index === undefined) continue;
    out.push({ rawTarget: extractMarkdownLinkTarget(match[1]), index: match.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateContext(text: string): string {
  if (text.length <= CONTEXT_MAX_CHARS) return text;
  return `${text.slice(0, CONTEXT_MAX_CHARS - 1).trimEnd()}…`;
}

function cleanHeadingText(line: string): string {
  const text = line
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/, "")
    .replace(/[ \t]+#*[ \t]*$/, "")
    .replace(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/(?<!!)\[[^\]]*]\(([^)]+)\)/g, "$1");
  return collapseWhitespace(text);
}

function markdownLines(content: string): MarkdownLine[] {
  const rawLines = content.split("\n");
  const lines: MarkdownLine[] = [];
  let cursor = 0;
  for (const line of rawLines) {
    const start = cursor;
    const end = cursor + line.length;
    const trimmed = line.trim();
    lines.push({
      text: line,
      start,
      end,
      blank: trimmed.length === 0,
      heading: HEADING_LINE_RE.test(line),
    });
    cursor = end + 1;
  }
  return lines;
}

function lineIndexForOffset(lines: MarkdownLine[], offset: number): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (offset <= lines[i].end) return i;
  }
  return Math.max(0, lines.length - 1);
}

function nearestHeading(lines: MarkdownLine[], fromIndex: number): string | undefined {
  for (let i = fromIndex; i >= 0; i -= 1) {
    if (lines[i].heading) {
      const heading = cleanHeadingText(lines[i].text);
      if (heading) return heading;
    }
  }
  for (let i = fromIndex + 1; i < lines.length; i += 1) {
    if (lines[i].heading) {
      const heading = cleanHeadingText(lines[i].text);
      if (heading) return heading;
    }
  }
  return undefined;
}

function paragraphContext(lines: MarkdownLine[], lineIndex: number): string | undefined {
  if (lines.length === 0) return undefined;
  if (lines[lineIndex].blank || lines[lineIndex].heading) return undefined;
  let start = lineIndex;
  while (start > 0 && !lines[start - 1].blank && !lines[start - 1].heading) {
    start -= 1;
  }
  let end = lineIndex;
  while (end < lines.length - 1 && !lines[end + 1].blank && !lines[end + 1].heading) {
    end += 1;
  }
  const text = collapseWhitespace(lines.slice(start, end + 1).map((line) => line.text.trim()).join(" "));
  if (!text) return undefined;
  const listOnly = text
    .replace(/^[-*+][ \t]+/, "")
    .replace(/^\d+[.)][ \t]+/, "")
    .trim();
  const isOnlyWikilink = /^\[\[[^\]]+\]\]$/u.test(listOnly);
  const isOnlyMarkdownLink = /^(?<!!)\[[^\]]*\]\([^)]+\)$/u.test(listOnly);
  if (isOnlyWikilink || isOnlyMarkdownLink) {
    return undefined;
  }
  return text;
}

function contextAtOffset(content: string, offset: number): string | undefined {
  const lines = markdownLines(content);
  if (lines.length === 0) return undefined;
  const index = lineIndexForOffset(lines, offset);
  const paragraph = paragraphContext(lines, index);
  if (paragraph) return truncateContext(paragraph);
  const heading = nearestHeading(lines, index);
  if (!heading) return undefined;
  return `Heading: ${truncateContext(heading)}`;
}

export function extractLinkContext(content: string, candidatePath: string): string | undefined {
  const matches = collectLinkOccurrences(content).filter((occurrence) =>
    linkTargetsPath(occurrence.rawTarget, candidatePath)
  );
  if (matches.length === 0) return undefined;
  return contextAtOffset(content, matches[0].index);
}

function aggregateOutgoing(links: LinkEntry[]): BacklinksEntry[] {
  const byPath = new Map<string, number>();
  for (const entry of links) {
    const path = normalizePath(entry.path);
    if (!path) continue;
    byPath.set(path, (byPath.get(path) ?? 0) + (entry.count ?? 1));
  }
  return [...byPath.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function aggregateIncoming(backlinks: BacklinkEntry[]): BacklinksEntry[] {
  const byPath = new Map<string, number>();
  for (const entry of backlinks) {
    const path = normalizePath(entry.sourcePath);
    if (!path) continue;
    byPath.set(path, (byPath.get(path) ?? 0) + (entry.count ?? 1));
  }
  return [...byPath.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildBacklinksReport(
  context: CommandContext,
  sourcePath: string,
  options: BacklinksReportOptions = {},
): Promise<BacklinksReport> {
  const includeContext = options.includeContext ?? false;
  const createVaultClient = options.createVaultClient ?? ((ctx: CommandContext) => new VaultClient(ctx.config));
  const vault = createVaultClient(context);
  const normalizedSource = normalizePath(sourcePath);
  const [outgoingRows, incomingRows] = await Promise.all([
    vault.links(normalizedSource),
    vault.backlinks(normalizedSource),
  ]);
  const outgoing = aggregateOutgoing(outgoingRows);
  const incoming = aggregateIncoming(incomingRows);

  if (!includeContext) {
    return {
      sourcePath: normalizedSource,
      includeContext: false,
      outgoing,
      incoming,
    };
  }

  const outgoingWithContext = [...outgoing];
  try {
    const sourceContent = await vault.read(normalizedSource);
    for (const entry of outgoingWithContext) {
      entry.context = extractLinkContext(sourceContent, entry.path);
    }
  } catch {
    // Best-effort context only.
  }

  const incomingWithContext = await Promise.all(incoming.map(async (entry) => {
    try {
      const content = await vault.read(entry.path);
      return { ...entry, context: extractLinkContext(content, normalizedSource) };
    } catch {
      return entry;
    }
  }));

  return {
    sourcePath: normalizedSource,
    includeContext: true,
    outgoing: outgoingWithContext,
    incoming: incomingWithContext,
  };
}

function formatSection(label: string, entries: BacklinksEntry[]): string[] {
  const lines = [`${label} (${entries.length}):`];
  if (entries.length === 0) {
    lines.push("(none)");
    return lines;
  }
  for (const entry of entries) {
    const countSuffix = entry.count > 1 ? ` x${entry.count}` : "";
    lines.push(`- ${entry.path}${countSuffix}`);
    if (entry.context) {
      lines.push(`  context: ${entry.context}`);
    }
  }
  return lines;
}

export function formatBacklinksLines(report: BacklinksReport): string[] {
  return [
    `Backlinks for ${report.sourcePath}`,
    ...formatSection("Links from this note", report.outgoing),
    ...formatSection("Links to this note", report.incoming),
  ];
}

export async function backlinksShellLines(
  context: CommandContext,
  sourcePath: string,
  options: BacklinksReportOptions = {},
): Promise<string[]> {
  const report = await buildBacklinksReport(context, sourcePath, options);
  return formatBacklinksLines(report);
}

export async function printBacklinksLines(
  context: CommandContext,
  sourcePath: string,
  options: BacklinksReportOptions = {},
): Promise<void> {
  const lines = await backlinksShellLines(context, sourcePath, options);
  for (const line of lines) {
    console.log(line);
  }
}

export async function runBacklinksCommand(context: CommandContext, args: CommandArgs): Promise<void> {
  const pathArg = args.positionals.join(" ").trim();
  if (!pathArg) {
    throw new Error("Usage: sam backlinks <path> [--context]");
  }
  const includeContext = booleanFlag(args.flags, "context") || booleanFlag(args.flags, "c");
  await printBacklinksLines(context, pathArg, { includeContext });
}
