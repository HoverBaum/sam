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

**4. Skills as configuration.**
Note structuring behavior is driven by a skill file. Users can bring their own skills to change how notes are written. The tool is a pipeline; the skill is the style layer.

**5. Composable: CLI for daily use, skill interface for agents.**
`sam` commands work standalone in the terminal. The same logic is also exposed as an agent skill so it can be called from a larger multi-agent system. Both interfaces are first-class.

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
| `cli.tsx`              | Entry point, command routing (yargs), global flags (`--dry-run`, `--skill`) |
| `commands/new.tsx`     | Capture pipeline: ingest → structure → link → review → write                |
| `commands/index.ts`    | Vault embedding indexer, watch mode                                         |
| `commands/process.tsx` | Inbox processor: batch review of unprocessed notes                          |
| `commands/source.ts`   | Source pipeline: URL/file → note, with deduplication logic                  |
| `ai/structure.ts`      | Claude: raw input → structured Zettel draft                                 |
| `ai/link.ts`           | Claude: draft + related notes → wikilinks woven into body                   |
| `ai/skill.ts`          | Load and apply skill files as system prompts                                |
| `search/embed.ts`      | ollama/nomic-embed wrapper                                                  |
| `search/index.ts`      | vectra index: build, update, query                                          |
| `vault/client.ts`      | Thin wrapper over `obsidian` CLI commands                                   |
| `vault/read.ts`        | Direct fs reads for embedding pipeline only                                 |
| `scripts/`             | Pure deterministic scripts (dedup, link rewrite, canonical, etc.)           |
| `ui/ReviewScreen.tsx`  | Ink: show draft, accept/edit/discard                                        |
| `ui/LinkPicker.tsx`    | Ink: toggle suggested wikilinks                                             |

---

## Phases

### Phase 0 — Foundation (start here)

- Project scaffold (TypeScript, Ink, yargs)
- `vault/client.ts`: wrap `obsidian` CLI commands
- `ai/skill.ts`: load skill file → system prompt
- `--dry-run` flag wired globally
- `sam index`: embed vault notes into local vectra index

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
2. **Claude (structure):** raw input → Zettel draft using skill as system prompt
3. **Search:** embed draft → cosine search vault index → top 5 related notes
4. **Claude (link):** draft + related note titles/summaries → insert `[[wikilinks]]` naturally into body
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
sam scripts/canonicalize --source "old-note.md" --canonical "canonical-note.md"
# --dry-run supported
```

### Phase 3 — Inbox processor

```bash
sam process          # oldest unprocessed inbox note
sam process --all    # step through all inbox notes
sam process --batch  # non-interactive, writes suggestions as comments in-note
```

For each inbox note: Claude reads it, may suggest splitting into multiple Zettels, runs link surfacing, presents review. Processed notes move from `inbox/` to the appropriate vault folder via `obsidian move`.

### Phase 4 — Skill interface (agent composition)

Expose `sam` functionality as a callable skill for use in larger agent systems:

```typescript
// skill interface — same logic as CLI, no Ink dependency
import { captureNote } from "sam/skill";

const result = await captureNote({
  input: "brain dump text or URL",
  skill: "./my-skill.md",
  dryRun: true,
});
// returns: { draft, suggestedLinks, filename }
```

The CLI and skill share the same core pipeline modules. Ink is only imported in CLI entry points.

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

---

## Open questions (to revisit)

- **Runtime:** Node/TypeScript vs. Deno — decision deferred. The architecture is compatible with either; Deno is appealing for its built-in toolchain and permissions model.
- **Embedding model:** `nomic-embed-text` via ollama is the plan; benchmark against vault size to validate latency.
- **Obsidian CLI stability:** Early Access as of v1.12 — keep `vault/client.ts` isolated so commands can be updated without touching the rest of the system.
- **Connection surfacing as a standalone command:** A future `sam connections` command could periodically scan the vault for notes that *should* be linked but aren't, and present a review queue. Held for later — the philosophical question of whether this helps or hinders Zettelkasten thinking is still open.