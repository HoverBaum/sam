# sam — Vision & Plan

> *A personal knowledge agent for Obsidian/Zettelkasten: fast capture, automated structuring, and connection surfacing — without replacing the thinking that makes Zettelkasten work.*

---

## Why we're building this

The bottleneck in a Zettelkasten isn't ideas — it's the friction between having a thought or encountering a source and getting it properly into the vault as a structured, connected note. That friction compounds: an inbox fills up, interesting URLs sit in a browser tab, voice thoughts evaporate. The connections that *would* have enriched the system never get made.

`sam` removes that friction tax. It handles the mechanical work — structuring, formatting, filing, deduplication, surfacing candidates — so the human can focus on the judgment work: is this idea worth capturing? Does this connection actually mean something?

Sam becomes like a mind spirit (looking at you Dross) that enhances the users cognitive capability.

**The core principle: scripts where deterministic, AI where judgment is genuinely needed, human for meaning.**

---

## Design principles

**1. Scripts over AI by default.**
If a process can be expressed as a deterministic script, it should be. Scripts are instant, free, predictable, and auditable. AI is reserved for tasks that require language understanding or judgment — structuring prose, extracting ideas, or suggesting candidates that require semantic similarity.

**2. Revertible and Reviewable.**
Every command that would modify the vault supports `--dry-run`. Show exactly what would be created or changed before committing. No surprises. Changes to the vault should have a git style review where they are clear and revertable.

**3. Human decides connections.**
AI surfaces related notes as candidates. The human decides whether a link is meaningful. The Zettelkasten only grows stronger if the connections reflect real understanding — not pattern-matching.

**4. Prompting lives in product code for now.**
The first version should keep note-structuring behavior in versioned code, not external skill files. That keeps the system easier to reason about while the workflow is still being discovered.

**5. CLI first, composability later.**
`sam` should be excellent as a daily-use CLI before we package it for larger agent systems. Internal modules should still be cleanly composable, but exported agent-facing interfaces are not part of the first milestone.

**6. Vault I/O via Obsidian CLI.**
All reads and writes go through the official `obsidian` CLI (v1.12+). This keeps sync, conflict resolution, and file management within Obsidian's control. The embedding pipeline reads vault files directly for performance, but never writes directly.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        User                             │
│   voice / brain dump / URL / file / inbox note          │
└────────────────────────┬────────────────────────────────┘
                         │
                    ┌────▼─────┐
                    │ sam CLI  │
                    └────┬─────┘
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌─────▼──────┐ ┌───▼────────────┐
   │  AI layer   │ │  Scripts   │ │  Vault client  │
   │             │ │  (Deno)    │ │  (obsidian CLI)│
   └──────┬──────┘ └─────┬──────┘ └───┬────────────┘
          │              │            │
   ┌──────▼──────────────▼────────────▼──────────────┐
   │              Embedding index                     │
   │         (local, vectra / JSON, nomic-embed)      │
   └──────────────────────────────────────────────────┘
```

### Modules

| Module                 | Responsibility                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| `cli.tsx`              | Entry point, command routing, global flags (`--dry-run`, `--model`)         |
| `commands/new.tsx`     | Capture pipeline: ingest → structure → link → review → write                |
| `commands/index.ts`    | Vault embedding indexer, watch mode                                         |
| `commands/process.tsx` | Inbox processor: batch review of unprocessed notes                          |
| `commands/source.ts`   | Source pipeline: URL/file → note, with deduplication logic                  |
| `ai/provider.ts`       | Provider abstraction: route calls to Claude, OpenAI, Gemini, or local LLM   |
| `ai/instructions.ts`   | Built-in prompt text and prompt assembly                                    |
| `ai/structure.ts`      | AI: raw input → structured Zettel draft                                     |
| `ai/link.ts`           | AI: draft + related notes → wikilinks woven into body                       |
| `search/embed.ts`      | ollama/nomic-embed wrapper                                                  |
| `search/index.ts`      | vectra index: build, update, query                                          |
| `vault/client.ts`      | Thin wrapper over `obsidian` CLI commands (CRUD, backlinks, links, orphans) |
| `vault/read.ts`        | Direct fs reads for embedding pipeline only                                 |
| `scripts/`             | Pure deterministic scripts (dedup, link rewrite, canonical, etc.)           |
| `ui/ReviewScreen.tsx`  | Ink: show draft, accept/edit/discard                                        |
| `ui/LinkPicker.tsx`    | Ink: toggle suggested wikilinks                                             |

---

## Phases

### Phase 0 — Foundation (start here)

- Project scaffold (TypeScript, Ink, Deno)
- `vault/client.ts`: wrap `obsidian` CLI commands
- `ai/instructions.ts`: define built-in system prompts
- `--dry-run` flag wired globally
- `sam index`: embed vault notes into local index

### Phase 1 — Capture pipeline

**Command:**
```bash
sam new "attention and memory might be the same cognitive process"
sam new --url https://example.com/paper
sam new --file ./paper.pdf
sam new   # opens $EDITOR for brain dump
```

**Flow:**
1. Ingest input (text, URL fetch, PDF extract)
2. **AI (structure):** raw input → Zettel draft using built-in system instructions
3. **Search:** embed draft → cosine search vault index → top 5 related notes
4. **AI (link):** draft + related note titles/summaries → insert `[[wikilinks]]` naturally into body
5. **Ink review screen:** show draft with links; toggle links on/off; edit title; accept or discard
6. On accept: `obsidian create` writes note to vault

**Dry-run output example:**
```
──── DRY RUN ────────────────────────────────────────
📄 File: Attention and memory may share the same cognitive substrate.md
📂 Folder: inbox/

#evergreen #ai

Cognitive science increasingly suggests attention and memory aren't 
separate faculties but two expressions of the same underlying process. 
[[Working memory]] capacity correlates almost perfectly with attentional 
control measures, and [[Baddeley's model]] struggles to explain this 
without collapsing the distinction.

→ Suggested links found: [[Working memory]], [[Cognitive load]]
→ Would write via: obsidian create
─────────────────────────────────────────────────────
```

### Phase 2 — Source pipeline

Sources (URLs, PDFs) get special treatment beyond plain notes.

**Command:**
```bash
sam source https://example.com/article
sam source ./paper.pdf --relates-to "memory, attention"
```

**Deduplication (script, not AI):**
When a source is added that already exists in the vault (same URL, same file hash), the script:
1. Detects the existing note
2. Creates or updates a **canonical note** that links to both versions
3. Rewrites all `[[wikilinks]]` in the vault pointing to the old note to point to the canonical one
4. Old note gets a `canonical: [[Canonical Note Title]]` line added

This is a pure deterministic script — no AI involved.

```bash
scripts/canonicalize --source "old-note.md" --canonical "canonical-note.md"
# --dry-run supported
```

### Phase 3 — Intake queues (multi-inbox processing)

```bash
sam inbox --queue default                 # oldest unprocessed note in one queue
sam inbox --queue reading                 # process a specific queue
sam inbox --queue default --all           # step through all notes in one queue
sam inbox --queue default --batch         # non-interactive, writes suggestions as comments in-note
sam inbox --external discord --channel zettelkasten-capture --sync
```

Use "intake queue" as the working name (better than "inbox" when there are many sources).

Supported queue types in this phase:
1. **Single-note queue:** one rolling note with many captured fragments; `sam inbox` can split the note into candidate Zettels.
2. **Folder queue:** many notes in one or more vault folders (for example `inbox/`, `reading-inbox/`, `fleeting/`).
3. **External queue:** imported capture streams (for example a Discord channel) synced into a local queue before processing.

For each queued item: Claude reads it, may suggest splitting into multiple Zettels, runs link surfacing, presents review. Processed items move from the queue to the appropriate vault folder via `obsidian move`.

## Future vision — packaging `sam` as a skill

Skill support is intentionally out of scope for the first implementation, but it remains a good long-term direction once the workflow is proven.

If we package `sam` as a skill later, the skill should be derived from real execution traces and project-specific conventions rather than generic prompt-writing. That means extracting concrete procedures, gotchas, templates, and validation loops from actual usage of the CLI.

The future skill should also follow progressive disclosure: keep the always-loaded instructions short, then load detailed references only when the current task requires them. The goal is not to make skills the architecture; it is to wrap a working architecture in a well-scoped skill once the product behavior is stable.

---

## What AI does vs. what scripts do

| Task                                 | AI  | Script     |
| ------------------------------------ | --- | ---------- |
| Structure raw input into Zettel      | ✅   |            |
| Insert wikilinks into note body      | ✅   |            |
| Detect duplicate source (URL/hash)   |     | ✅          |
| Rewrite vault links to canonical     |     | ✅          |
| Move processed note to folder        |     | ✅          |
| Embed notes for similarity search    |     | ✅ (ollama) |
| Find top-N related notes             |     | ✅ (vectra) |
| Decide if a connection is meaningful |     | 🧠 human    |

