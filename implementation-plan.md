# sam — Implementation Plan

> Derived from [Vision.md](./Vision.md). This document translates the vision into a concrete, ordered build sequence.

---

## Tech Stack

| Layer           | Choice                                      | Reason                                                                                                                                                                  |
| --------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | **Deno**                                    | First-class TypeScript, no `node_modules`, built-in permissions model                                                                                                   |
| Terminal UI     | **Ink** (React for CLIs)                    | Interactive review screens, link pickers                                                                                                                                |
| AI              | **Vercel AI SDK** (`ai` on npm + `@ai-sdk/*` providers) | Unified provider abstraction (Claude, OpenAI, Gemini, Groq, Mistral, etc.); `generateObject` / `generateText`, streaming, tool calling; selected by config or `--model` flag |
| Embeddings      | **ollama + nomic-embed-text**               | Local, free, fast                                                                                                                                                       |
| Vector index    | **vectra** (JSON-backed)                    | Simple local index, no server needed                                                                                                                                    |
| Vault I/O       | **Obsidian CLI** (Obsidian 1.12+ installer) | Official interface; keeps sync/conflict handling in Obsidian. Command reference: [Obsidian CLI (bundled)](./external-docs/Obsidian-cli-docs.md)                          |
| Source fetching | **fetch + pdf-parse**                       | URL content and PDF text extraction                                                                                                                                     |
| Prompting       | **Built-in prompts** (`ai/instructions.ts`) | Keep note-creation behavior versioned in product code for now                                                                                                           |

---

## Configuration and vault resolution

**Obsidian CLI vault targeting** (see [Obsidian CLI docs](./external-docs/Obsidian-cli-docs.md) — “Target a vault”):

- If the shell’s **current working directory is inside a vault folder**, that vault is used by default.
- Otherwise the CLI uses the **currently active vault** in the Obsidian app.
- To target a specific vault explicitly, pass **`vault=<name>`** or **`vault=<id>`** as the **first parameter** before the subcommand, e.g. `obsidian vault="My Vault" create …`.

**`~/.sam/config.json`** should store user defaults so runs are repeatable outside that cwd. At minimum:

| Field        | Purpose |
| ------------ | ------- |
| `vault`      | Optional. Vault **name or id** string passed through to Obsidian as `vault=…` on every CLI invocation when set. Omit to rely on cwd / active vault. |
| `vaultPath`  | Optional. Filesystem path to the vault root for `vault/read.ts` and indexing. If unset, use **current working directory** as vault root (matches Obsidian’s “cwd inside vault” behavior). |
| (same file)  | AI defaults from P0-3a: `model`, `apiKey`, `baseUrl`, etc. |

**Resolution order for the vault argument** (most specific wins):

1. Global CLI flag, e.g. `--vault <name-or-id>` (wire in P0-1 / scaffold)
2. Environment variable, e.g. `SAM_VAULT`
3. `vault` in `~/.sam/config.json`
4. Omit `vault=` — Obsidian uses cwd vault or active vault

**Implementation notes:**

- `vault/client.ts` builds each command line as: optional `vault=<resolved> ` prefix, then the Obsidian subcommand and parameters documented in the bundled CLI reference.
- `vault/read.ts` (indexing) uses `vaultPath` from config when set; otherwise the vault root is the **current working directory** (same default idea as Obsidian: shell inside the vault folder).

---

## Repository Layout

```
sam/
├── cli.tsx                   # Entry point, command routing
├── config.ts                 # Load ~/.sam/config.json; merge flags/env (vault, model, …)
├── commands/
│   ├── new.tsx               # Capture pipeline
│   ├── index.ts              # Vault indexer + watch mode
│   ├── process.tsx           # Inbox processor
│   └── source.ts             # Source pipeline (URL / PDF)
├── ai/
│   ├── config.ts             # Model/API key selection and resolution
│   ├── instructions.ts       # Built-in system prompts and prompt assembly
│   ├── structure.ts          # AI: raw input → Zettel draft (generateObject)
│   └── link.ts               # AI: draft + candidates → wikilinks (generateText)
├── search/
│   ├── embed.ts              # ollama nomic-embed wrapper
│   └── index.ts              # vectra build / update / query
├── vault/
│   ├── client.ts             # Thin wrapper over obsidian CLI
│   └── read.ts               # Direct fs reads (embedding pipeline only)
├── scripts/
│   ├── dedup.ts              # Detect duplicate sources (URL / file hash)
│   ├── canonicalize.ts       # Rewrite vault links → canonical note
│   └── link-rewrite.ts       # Bulk wikilink rewrite utility
├── ui/
│   ├── ReviewScreen.tsx      # Ink: show draft, accept / edit / discard
│   └── LinkPicker.tsx        # Ink: toggle suggested wikilinks
├── deno.json                 # Tasks, import map, permissions
└── README.md                 # Project overview and usage
```

---

## Phase 0 — Foundation

**Goal:** Runnable scaffold. Every downstream phase builds on this.

### Tasks

#### P0-1: Project scaffold
- [ ] `deno.json` with tasks: `dev`, `build`, `test`
- [ ] Import map pointing to npm specifiers for `ai`, `@ai-sdk/*` providers, Ink, and other deps as needed
- [ ] `cli.tsx` entry with global flags: `--dry-run`, `--model`, `--vault` (see [Configuration and vault resolution](#configuration-and-vault-resolution))
- [ ] Load and merge `~/.sam/config.json` (create schema with defaults for missing keys)
- [ ] Compile check passes (`deno check`)

#### P0-2: `vault/client.ts` — obsidian CLI wrapper
- [ ] Resolve vault for every invocation using: `--vault` → `SAM_VAULT` → `config.vault` → omit (cwd / active vault); pass `vault=<name|id>` as **first** token when set ([Obsidian CLI docs](./external-docs/Obsidian-cli-docs.md))
- [ ] Shell out to `obsidian` CLI for vault operations per bundled reference (e.g. `create`, `open`, `move`, `files`, `read`; exact names/params per [Obsidian CLI docs](./external-docs/Obsidian-cli-docs.md))
- [ ] **Backlinks & link graph:**
  - `backlinks(file): Promise<BacklinkEntry[]>` — who links to a note (`file=` or `path=`, `format=json`)
  - `links(file): Promise<LinkEntry[]>` — outgoing links from a note
  - `unresolved(): Promise<UnresolvedLink[]>` — vault-wide unresolved links
  - `orphans(): Promise<string[]>` — notes with no incoming links
  - `deadends(): Promise<string[]>` — notes with no outgoing links
- [ ] Accept `--dry-run`: log intended command, skip execution
- [ ] Typed return values; throw on non-zero exit

#### P0-3a: `ai/config.ts` — AI model selection
- [ ] Define config shape aligned with `~/.sam/config.json`: `{ model: string, apiKey?: string, baseUrl?: string, vault?: string, vaultPath?: string }` (shared `config` module for `vault/client.ts`, `vault/read.ts`, and `ai/config.ts`)
- [ ] Model selection order: `--model` flag → `SAM_AI_MODEL` env var → `~/.sam/config.json` → default (`anthropic/claude-3-5-sonnet-20241022`)
- [ ] Support Vercel AI SDK model IDs: `anthropic/claude-*`, `openai/*`, `google/*`, `mistral/*`, `groq/*`, etc.
- [ ] For local models: support OpenAI-compatible baseUrl endpoint (e.g., `baseUrl: "http://localhost:11434"`)
- [ ] All `ai/` modules import from the `ai` package and provider packages (`@ai-sdk/anthropic`, …) only through a thin layer in `ai/config.ts` where practical; avoid scattering provider SDK imports

#### P0-3b: `ai/instructions.ts` — built-in prompt assembly
- [ ] Define the core system prompt for note structuring and link-weaving
- [ ] Keep prompt text versioned in the repo, not loaded from external skill files
- [ ] Support provider/model-specific tweaks in code where needed
- [ ] Return prompt fragments/helpers that `ai/structure.ts` and `ai/link.ts` can reuse

#### P0-4: `sam index` command (`commands/index.ts`)
- [ ] Walk vault directory via `vault/read.ts` (same vault path rules as [Configuration and vault resolution](#configuration-and-vault-resolution))
- [ ] Embed each note with `search/embed.ts` (ollama `nomic-embed-text`)
- [ ] Upsert into `search/index.ts` (vectra JSON index, stored in `~/.sam/index/`)
- [ ] `--skip-embed`: update metadata / file list only without calling ollama (supports machines without local embeddings; pairs with [Error handling](#error-handling))
- [ ] `--watch` flag: file-system watcher re-indexes on change (debounce rapid saves to avoid thrashing on large vaults)
- [ ] Progress bar via Ink; respect `--dry-run` (report what would be indexed)

**Note:** `search/embed.ts` and `search/index.ts` are implemented here first; Phase 1 **reuses** these modules for `sam new` (no second implementation). P1-3 is “capture pipeline uses the shared search API,” not a duplicate embed layer.

---

## Phase 1 — Capture Pipeline (`sam new`)

**Goal:** End-to-end note creation from raw input to vault.

### Tasks

#### P1-1: Input ingestion
- [ ] Plain text argument: pass through directly
- [ ] `--url <url>`: fetch HTML → extract readable text (Mozilla Readability or similar)
- [ ] `--file <path>`: detect PDF vs plain text; extract accordingly
- [ ] No argument: spawn `$EDITOR`, read result on close
- [ ] Return normalized `{ rawContent: string, sourceUrl?: string, sourceFile?: string }`

#### P1-2: `ai/structure.ts` — structure raw input
- [ ] Build prompt: built-in system instructions + raw content
- [ ] Call `generateObject()` from the `ai` package (via resolved model from `ai/config.ts`); expect back: `{ title, tags, body }` (structured Zettel)
- [ ] Define a **Zod** schema for the structured object and pass it to `generateObject` so validation and TypeScript types stay aligned
- [ ] Return typed `ZettelDraft`

#### P1-3: `search/embed.ts` + `search/index.ts` (consumption in capture)
- [ ] Consume the **shared** modules from P0-4 (implement there first; no parallel embed stack)
- [ ] `embed(text: string): Promise<number[]>` — POST to local ollama endpoint
- [ ] `query(vector: number[], topN: number): Promise<{ id, title, summary, score }[]>` — cosine search vectra
- [ ] `upsert(id, vector, metadata)` — add/update note in index

#### P1-4: `ai/link.ts` — weave wikilinks
- [ ] **Depends on P1-3:** embed/query the draft (or its title) to retrieve top-N candidates before linking
- [ ] Input: `ZettelDraft` + top-N related note titles/summaries
- [ ] Also fetch `backlinks` of each candidate note — notes that already link to a candidate are stronger signals
- [ ] Call `generateText()` from the `ai` package (via resolved model from `ai/config.ts`) to naturally insert `[[wikilinks]]` where appropriate
- [ ] Return updated draft body; do not invent links not in the candidate list

#### P1-5: `ui/ReviewScreen.tsx` — Ink review UI
- [ ] Display: title (editable), tags, body with links highlighted
- [ ] `ui/LinkPicker.tsx`: list of suggested links with toggle (on/off)
- [ ] Actions: `[A]ccept`, `[E]dit` (re-open `$EDITOR`), `[D]iscard`
- [ ] On accept: call `vault/client.ts create`

#### P1-6: Wire `commands/new.tsx`
- [ ] Compose in order: **P1-1** ingest → **P1-2** structure → **P1-3** retrieve related notes (embed + query) → **P1-4** weave links → **P1-5** review UI
- [ ] Respect `--dry-run`: print formatted dry-run block instead of writing
- [ ] Dry-run format matches Vision.md example exactly

---

## Phase 2 — Source Pipeline (`sam source`)

**Goal:** URL/PDF sources with deduplication and canonical note management.

### Tasks

#### P2-1: `scripts/dedup.ts` — duplicate detection
- [ ] For URLs: normalize URL, search vault front matter for matching `source:` field
- [ ] For files: SHA-256 hash, search vault front matter for matching `file-hash:` field
- [ ] Return `{ isDuplicate: boolean, existingNote?: string }`
- [ ] Pure script — no AI

#### P2-2: `scripts/canonicalize.ts` — canonical note management
- [ ] Given `oldNote` and `canonicalNote` paths:
  1. Create or update canonical note with links to both versions
  2. Append `canonical: [[Canonical Note Title]]` to old note front matter
  3. Delegate link rewriting to `scripts/link-rewrite.ts`
- [ ] `--dry-run`: show all changes without applying
- [ ] Supports `--source` and `--canonical` flags as described in Vision.md

#### P2-3: `scripts/link-rewrite.ts` — bulk wikilink rewrite
- [ ] Walk all vault `.md` files
- [ ] Replace `[[old-title]]` with `[[new-title]]` everywhere
- [ ] Use `vault/client.ts unresolved()` after rewrite to verify no new broken links were introduced
- [ ] Pure regex/AST script; no AI

#### P2-4: Wire `commands/source.ts`
- [ ] Run dedup check first
- [ ] If duplicate → run canonicalize flow
- [ ] If new → run standard capture pipeline (reuse Phase 1 modules)
- [ ] `--relates-to` flag: inject context into structure prompt

---

## Phase 3 — Intake Queues (`sam inbox`)

**Goal:** Batch processing of captured fragments from multiple queue sources.

### Tasks

#### P3-1: Queue abstraction
- [ ] `QueueSource` interface: `{ list(): Promise<QueueItem[]>, markDone(id): Promise<void> }`
- [ ] Implementations:
  - `FolderQueue`: reads `.md` files from one or more vault folders
  - `SingleNoteQueue`: splits one rolling note into fragments
  - `ExternalQueue`: reads from a synced local file/folder (Discord export, etc.)

#### P3-2: Fragment splitting (AI)
- [ ] For `SingleNoteQueue`: call `generateObject()` from the `ai` package with a **Zod** schema (via resolved model from `ai/config.ts`), request split points and candidate titles
- [ ] Return `Fragment[]`; human reviews splits in Ink before proceeding

#### P3-3: `commands/process.tsx` — inbox processor
- [ ] `--queue <name>`: select queue
- [ ] `--all`: step through all items; default is oldest-first single item
- [ ] `--batch`: non-interactive; write AI suggestions as comments (`%% sam: ... %%`) directly in note
- [ ] Per item: run capture pipeline (Phase 1), on accept call `obsidian move` out of queue folder

#### P3-4: External queue sync (`--external discord`)
- [ ] Adapter pattern: `DiscordAdapter` reads from exported JSON or webhook file
- [ ] Normalizes messages into `QueueItem[]`
- [ ] `--sync` flag refreshes from source before processing

---

## Future Direction — Skill Packaging (Out of Scope for v1)

We are explicitly not building skill loading or skill export in the first implementation. The near-term product is a CLI with built-in prompting and a stable internal pipeline.

If we later package `sam` as a skill or skill-building tool, use these constraints:

- Start from real usage traces and working operator behavior, not generic LLM advice
- Keep the core `SKILL.md` concise; move large references behind progressive disclosure
- Encode concrete gotchas, templates, and validation loops instead of vague "best practices"
- Provide defaults rather than menus when a canonical path exists
- Treat skill packaging as a thin wrapper over a proven pipeline, not the primary architecture

---

## Cross-Cutting Concerns

### `--dry-run` contract
Every command that modifies the vault must:
1. Accept `--dry-run` at the global CLI level
2. Format output as the canonical dry-run block (see Vision.md)
3. Exit 0 without touching the vault

### Error handling
- Obsidian CLI not found → clear install instructions (see [Obsidian CLI docs](./external-docs/Obsidian-cli-docs.md) — install, PATH, Obsidian must be running)
- ollama not running → explain how to start; suggest `sam index --skip-embed` when embeddings are optional
- AI provider not reachable / bad API key → surface message, show which provider is configured, offer retry or `--discard`
- Network fetch failures (`--url`) → clear error with URL; optional timeouts and size limits (see Security)
- Empty or unchanged `$EDITOR` buffer → treat as cancel or validation error with a clear message

### Security (untrusted input)
URL and PDF ingestion processes **untrusted** content. For v1: enforce reasonable **size limits** (response body, PDF bytes), **timeouts** on fetch, and avoid executing or interpreting HTML beyond readability extraction. Prefer failing closed with a readable error over silent truncation where safety is ambiguous.

### Testing strategy
- **Unit tests:** `scripts/` modules (dedup, canonicalize, link-rewrite) — pure functions
- **Contract / integration tests:** `vault/client.ts` — parse JSON output from recorded `obsidian` invocations (or a test double) for `backlinks`, `links`, `unresolved`, etc.
- **Integration tests:** `ai/structure.ts` and `ai/link.ts` with **mocked** provider responses (golden outputs) so prompts and schema stay stable
- **Integration tests:** capture pipeline end-to-end with fixture vault and mocked AI + ollama
- **Manual smoke test** checklist per phase before moving to next

### CI
Run `deno task test` and `deno check` on every push/PR (exact CI product optional; minimum bar is scripted locally or in CI).

---

## Phase acceptance criteria (maps to [Vision.md](./Vision.md) success criteria)

| Phase | Done when |
| ----- | --------- |
| **P0** | `sam index` runs from a vault cwd; Obsidian commands succeed with resolved `vault=` when configured; AI model resolves from flag/env/config; `deno check` clean |
| **P1** | Raw input → structured draft → related notes → wikilink suggestions → user accept creates a note in the vault; dry-run matches Vision |
| **P2** | Duplicate source/file routes to canonicalize + link rewrite without breaking links; new sources reuse capture pipeline |
| **P3** | At least one queue type processes items through the Phase 1 pipeline and moves completed work out of the queue |

---

## Performance and scale

For large vaults, full embedding on every change is expensive. **`--watch`** should debounce file events. Longer term, incremental or dirty-only re-indexing may be needed; not required for v1 beyond debouncing and clear progress reporting.

---

## Build Order Summary

```
P0-1 → P0-2 → P0-3a → P0-3b → P0-4   (Foundation — unblock all phases)
         ↓
P1-1 → P1-2 → P1-3 → P1-4 → P1-5 → P1-6   (Capture — core daily-use command)
         ↓
P2-1 → P2-2 → P2-3 → P2-4   (Source — dedup + canonicalize)
         ↓
P3-1 → P3-2 → P3-3 → P3-4   (Intake queues)
```

Each phase is independently shippable. Phase 1 (`sam new`) provides the most immediate value and should be the first usable milestone.
