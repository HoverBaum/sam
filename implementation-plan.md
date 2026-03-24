# sam — Implementation Plan

> Derived from [Vision.md](./Vision.md). This document translates the vision into a concrete, ordered build sequence.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Deno** | First-class TypeScript, no `node_modules`, built-in permissions model |
| Terminal UI | **Ink** (React for CLIs) | Interactive review screens, link pickers |
| AI | **Pluggable provider** (`ai/provider.ts`) | Claude, OpenAI, Gemini, or any local model via OpenAI-compatible endpoint; selected by config or `--model` flag |
| Embeddings | **ollama + nomic-embed-text** | Local, free, fast |
| Vector index | **vectra** (JSON-backed) | Simple local index, no server needed |
| Vault I/O | **obsidian CLI v1.12+** | Official interface; keeps sync/conflict handling in Obsidian |
| Source fetching | **fetch + pdf-parse** | URL content and PDF text extraction |

---

## Repository Layout

```
sam/
├── cli.tsx                   # Entry point, command routing
├── commands/
│   ├── new.tsx               # Capture pipeline
│   ├── index.ts              # Vault indexer + watch mode
│   ├── process.tsx           # Inbox processor
│   └── source.ts             # Source pipeline (URL / PDF)
├── ai/
│   ├── provider.ts           # Provider abstraction (Claude / OpenAI / Gemini / local)
│   ├── structure.ts          # AI: raw input → Zettel draft
│   ├── link.ts               # AI: draft + candidates → wikilinks
│   └── skill.ts              # Load skill file → system prompt
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
├── skill/
│   └── index.ts              # Headless skill interface (no Ink)
├── deno.json                 # Tasks, import map, permissions
└── default-skill.md          # Bundled default Zettelkasten style prompt
```

---

## Phase 0 — Foundation

**Goal:** Runnable scaffold. Every downstream phase builds on this.

### Tasks

#### P0-1: Project scaffold
- [ ] `deno.json` with tasks: `dev`, `build`, `test`
- [ ] Import map pointing to npm specifiers for Ink, and AI provider SDKs as needed
- [ ] `cli.tsx` entry with `--dry-run` and `--skill` global flags wired
- [ ] Compile check passes (`deno check`)

#### P0-2: `vault/client.ts` — obsidian CLI wrapper
- [ ] Shell out to `obsidian` CLI for: `create`, `open`, `move`, `list`, `read`
- [ ] **Backlinks & link graph:**
  - `backlinks(file): Promise<BacklinkEntry[]>` — who links to a note (`file=` or `path=`, `format=json`)
  - `links(file): Promise<LinkEntry[]>` — outgoing links from a note
  - `unresolved(): Promise<UnresolvedLink[]>` — vault-wide unresolved links
  - `orphans(): Promise<string[]>` — notes with no incoming links
  - `deadends(): Promise<string[]>` — notes with no outgoing links
- [ ] Accept `--dry-run`: log intended command, skip execution
- [ ] Typed return values; throw on non-zero exit

#### P0-3a: `ai/provider.ts` — provider abstraction
- [ ] Define `AIProvider` interface: `{ complete(messages, options): Promise<string> }`
- [ ] Implementations: `ClaudeProvider`, `OpenAIProvider`, `GeminiProvider`, `OllamaProvider` (OpenAI-compatible local endpoint)
- [ ] Selection order: `--model` flag → `SAM_AI_PROVIDER` env var → `~/.sam/config.json` → default (`claude`)
- [ ] Config shape: `{ provider: string, model?: string, apiKey?: string, baseUrl?: string }`
- [ ] All `ai/` modules receive a provider instance; never import an SDK directly

#### P0-3b: `ai/skill.ts` — skill file loader
- [ ] Read a `.md` skill file from disk
- [ ] Parse optional YAML front matter (name, version, model overrides)
- [ ] Return `{ systemPrompt: string, modelOverrides?: {...} }`
- [ ] Fall back to bundled `default-skill.md` when no `--skill` flag

#### P0-4: `sam index` command (`commands/index.ts`)
- [ ] Walk vault directory via `vault/read.ts`
- [ ] Embed each note with `search/embed.ts` (ollama `nomic-embed-text`)
- [ ] Upsert into `search/index.ts` (vectra JSON index, stored in `~/.sam/index/`)
- [ ] `--watch` flag: file-system watcher re-indexes on change
- [ ] Progress bar via Ink; respect `--dry-run` (report what would be indexed)

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
- [ ] Build prompt: skill system prompt + raw content
- [ ] Call provider via `ai/provider.ts`; expect back: `{ title, tags, body }` (structured Zettel)
- [ ] Parse and validate response
- [ ] Return typed `ZettelDraft`

#### P1-3: `search/embed.ts` + `search/index.ts`
- [ ] `embed(text: string): Promise<number[]>` — POST to local ollama endpoint
- [ ] `query(vector: number[], topN: number): Promise<{ id, title, summary, score }[]>` — cosine search vectra
- [ ] `upsert(id, vector, metadata)` — add/update note in index

#### P1-4: `ai/link.ts` — weave wikilinks
- [ ] Input: `ZettelDraft` + top-N related note titles/summaries
- [ ] Also fetch `backlinks` of each candidate note — notes that already link to a candidate are stronger signals
- [ ] Call provider via `ai/provider.ts` to naturally insert `[[wikilinks]]` where appropriate
- [ ] Return updated draft body; do not invent links not in the candidate list

#### P1-5: `ui/ReviewScreen.tsx` — Ink review UI
- [ ] Display: title (editable), tags, body with links highlighted
- [ ] `ui/LinkPicker.tsx`: list of suggested links with toggle (on/off)
- [ ] Actions: `[A]ccept`, `[E]dit` (re-open `$EDITOR`), `[D]iscard`
- [ ] On accept: call `vault/client.ts create`

#### P1-6: Wire `commands/new.tsx`
- [ ] Compose P1-1 → P1-2 → P1-3 → P1-4 → P1-5 in sequence
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
- [ ] For `SingleNoteQueue`: AI reads the note via `ai/provider.ts`, suggests split points and candidate titles
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

## Phase 4 — Skill Interface (Agent Composition)

**Goal:** Expose core pipeline as a headless, importable skill.

### Tasks

#### P4-1: `skill/index.ts` — headless API
- [ ] Export `captureNote({ input, skill, dryRun, provider? })` → `{ draft, suggestedLinks, filename }`
- [ ] Export `indexVault({ vaultPath })` → `void`
- [ ] Export `queryRelated({ text, topN })` → `RelatedNote[]`
- [ ] Zero Ink imports; pure async functions

#### P4-2: Shared pipeline refactor
- [ ] Ensure `commands/new.tsx` delegates to the same functions exported by `skill/index.ts`
- [ ] CLI = skill interface + Ink review layer
- [ ] Validate: all Phase 1 unit tests pass against skill interface directly

#### P4-3: Skill documentation
- [ ] `skill/README.md`: usage examples, return types, environment requirements
- [ ] JSDoc on all exported functions

---

## Cross-Cutting Concerns

### `--dry-run` contract
Every command that modifies the vault must:
1. Accept `--dry-run` at the global CLI level
2. Format output as the canonical dry-run block (see Vision.md)
3. Exit 0 without touching the vault

### Error handling
- Obsidian CLI not found → clear install instructions
- ollama not running → explain how to start, suggest `sam index --skip-embed` fallback
- AI provider not reachable / bad API key → surface message, show which provider is configured, offer retry or `--discard`

### Testing strategy
- Unit tests: all `scripts/` modules (dedup, canonicalize, link-rewrite) — pure functions, easy to test
- Integration tests: capture pipeline with fixture vault and mocked AI provider/ollama responses
- Manual smoke test checklist per phase before moving to next

---

## Build Order Summary

```
P0-1 → P0-2 → P0-3 → P0-4   (Foundation — unblock all phases)
         ↓
P1-1 → P1-2 → P1-3 → P1-4 → P1-5 → P1-6   (Capture — core daily-use command)
         ↓
P2-1 → P2-2 → P2-3 → P2-4   (Source — dedup + canonicalize)
         ↓
P3-1 → P3-2 → P3-3 → P3-4   (Intake queues)
         ↓
P4-1 → P4-2 → P4-3           (Skill interface)
```

Each phase is independently shippable. Phase 1 (`sam new`) provides the most immediate value and should be the first usable milestone.
