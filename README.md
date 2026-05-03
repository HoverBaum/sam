# sam

`sam` is a terminal-first personal knowledge companion for Obsidian vaults.

Phase 0 foundation currently includes:

- Deno CLI scaffold with typed config resolution
- Obsidian CLI wrapper (`vault/client.ts`)
- Embedding provider adapters (`search/embed.ts`)
- Profile-isolated index + manifest engine (`search/index.ts`)
- `sam index` command
- `sam connect` — similar notes via the vector index (shell route `/connect`)
- `sam backlinks` — inbound + outbound links for a note (optional `--context`)
- Ink home shell (default `sam` entrypoint)

## Usage

```bash
sam
sam index
sam connect
sam connect "Projects/Some note.md"
sam backlinks "Projects/Some note.md"
sam backlinks "Projects/Some note.md" --context
sam --dry-run index --skip-embed
```

### Similar notes (`sam connect` / `/connect`)

After `sam index`, find the five closest **other** notes by embedding cosine
similarity. In the home shell, run `/connect` to move to the dedicated connect
route and use **Tab** to cycle name matches, **Enter** to search, **Esc** to go
back. Settings now live at `/config` with per-field routes under
`/config/<field>`, and the shell footer shows the current route plus actions for
that screen. Non-interactive: `sam connect "<vault path>"` prints
`path<TAB>score` lines for scripting. Re-run `sam index` when the shell warns
that notes changed so results stay fresh.

### Link graph view (`sam backlinks` / `/backlinks`)

Show both outbound and inbound links for a note:

- `sam backlinks "<vault path>"`
- `sam backlinks "<vault path>" --context`

With `--context`, each link includes a best-effort snippet from markdown:
paragraph containing the link when available, otherwise the nearest heading.
In the shell, use `/backlinks <path>` (or `/backlinks <path> --context`).

Global flags:

- `--dry-run`
- `--model <provider/model-id>`
- `--vault <vault-name-or-id>`
- `--embed-model <embedding-model>`

## Config

`~/.sam/config.json` (all fields optional):

```json
{
  "vault": "Notes",
  "model": "anthropic/claude-3-5-sonnet-20241022",
  "embeddingProvider": "ollama",
  "embeddingModel": "nomic-embed-text",
  "embeddingBaseUrl": "http://127.0.0.1:11434"
}
```

Resolution order:

- Chat model: CLI flag -> `SAM_AI_MODEL` -> config -> default
- Vault: CLI flag -> `SAM_VAULT` -> config -> Obsidian cwd/active vault behavior
- Embeddings: CLI flags -> `SAM_EMBED_*` -> config -> Ollama defaults

## Index behavior

- Index data is written under `~/.sam/index/<embedding-profile>/`.
- Each profile keeps:
  - `index.json` vectors + metadata
  - `manifest.json` with `{ profile, files[path] = { contentHash, indexedAt } }`
- Incremental updates:
  - New/modified files are reprocessed
  - Deleted files are removed from index/manifest
- Profile mismatch guard prevents querying a dimension/provider-incompatible
  index.
- Query behavior now surfaces an explicit error if no index exists
  (`run sam index`), instead of returning silent empty results.
- `sam index --dry-run` is manifest-only and performs no Obsidian calls.

## Development

```bash
deno task check
deno task test
deno task dev
```
