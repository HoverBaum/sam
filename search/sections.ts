import type { OutlineNode } from "../vault/client.ts";

const HEADING_RE = /^(?<indent>[ \t]{0,3})(?<marks>#{1,6})[ \t]+(?<text>.*?)[ \t]*#*[ \t]*$/gm;
const MIN_SECTION_TEXT_LENGTH = 40;

interface ScannedHeading {
  title: string;
  level: number;
  startOffset: number;
}

interface OutlineHeading {
  title: string;
  level: number;
  path: string;
}

export interface SectionChunk {
  heading: string;
  path: string;
  slug: string;
  level: number;
  text: string;
}

function normalizeHeadingKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanHeadingText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stripHeadingMarkers(text: string): string {
  return text.replace(/^[ \t]{0,3}#{1,6}[ \t]+.*$/m, "").trim();
}

function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return slug.length > 0 ? slug : "section";
}

function scanMarkdownHeadings(content: string): ScannedHeading[] {
  const headings: ScannedHeading[] = [];
  for (const match of content.matchAll(HEADING_RE)) {
    const title = cleanHeadingText(match.groups?.text ?? "");
    const marks = match.groups?.marks ?? "";
    if (!title || marks.length === 0 || match.index === undefined) {
      continue;
    }
    headings.push({
      title,
      level: marks.length,
      startOffset: match.index,
    });
  }
  return headings;
}

function flattenOutline(nodes: OutlineNode[], parentTitles: string[] = []): OutlineHeading[] {
  const flat: OutlineHeading[] = [];
  for (const node of nodes) {
    const title = cleanHeadingText(node.title);
    if (!title) {
      continue;
    }
    const pathTitles = [...parentTitles, title];
    flat.push({
      title,
      level: node.level,
      path: pathTitles.join(" > "),
    });
    flat.push(...flattenOutline(node.children, pathTitles));
  }
  return flat;
}

function deriveOutlinePathsFromScan(headings: ScannedHeading[]): string[] {
  const stack: Array<{ level: number; title: string }> = [];
  const out: string[] = [];
  for (const heading of headings) {
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push({ level: heading.level, title: heading.title });
    out.push(stack.map((entry) => entry.title).join(" > "));
  }
  return out;
}

function alignOutlinePaths(headings: ScannedHeading[], outline: OutlineNode[]): string[] {
  if (headings.length === 0) {
    return [];
  }
  const fallback = deriveOutlinePathsFromScan(headings);
  const flatOutline = flattenOutline(outline);
  if (flatOutline.length === 0) {
    return fallback;
  }

  const aligned: string[] = [];
  let outlineIndex = 0;
  for (const heading of headings) {
    const normalizedTitle = normalizeHeadingKey(heading.title);
    let matchedPath: string | undefined;
    for (; outlineIndex < flatOutline.length; outlineIndex += 1) {
      const candidate = flatOutline[outlineIndex];
      if (
        candidate.level === heading.level &&
        normalizeHeadingKey(candidate.title) === normalizedTitle
      ) {
        matchedPath = candidate.path;
        outlineIndex += 1;
        break;
      }
    }
    aligned.push(matchedPath ?? fallback[aligned.length]);
  }
  return aligned;
}

export function buildSectionItemId(notePath: string, slug: string, occurrence: number): string {
  return occurrence <= 1 ? `${notePath}#${slug}` : `${notePath}#${slug}-${occurrence}`;
}

export function extractSectionChunks(content: string, outline: OutlineNode[]): SectionChunk[] {
  const headings = scanMarkdownHeadings(content);
  if (headings.length === 0) {
    return [];
  }

  const headingPaths = alignOutlinePaths(headings, outline);
  const slugCounts = new Map<string, number>();
  const sections: SectionChunk[] = [];

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const next = headings[i + 1];
    const text = content.slice(heading.startOffset, next?.startOffset ?? content.length).trim();
    if (stripHeadingMarkers(text).length < MIN_SECTION_TEXT_LENGTH) {
      continue;
    }
    const path = headingPaths[i] ?? heading.title;
    const slugBase = slugify(path);
    const occurrence = (slugCounts.get(slugBase) ?? 0) + 1;
    slugCounts.set(slugBase, occurrence);
    sections.push({
      heading: heading.title,
      path,
      slug: occurrence <= 1 ? slugBase : `${slugBase}-${occurrence}`,
      level: heading.level,
      text,
    });
  }

  return sections;
}
