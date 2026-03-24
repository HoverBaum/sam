# sam

`sam` is a terminal-first personal knowledge companion for Obsidian vaults.

Phase 0 foundation currently includes:
- Deno CLI scaffold with typed config resolution
- Obsidian CLI wrapper (`vault/client.ts`)
- Embedding provider adapters (`search/embed.ts`)
- Profile-isolated index + manifest engine (`search/index.ts`)
- `sam index` command
- Ink home shell (default `sam` entrypoint)

## Usage

```bash
sam
sam index
sam --dry-run index --skip-embed
```

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
- Profile mismatch guard prevents querying a dimension/provider-incompatible index.

## Development

```bash
deno task check
deno task test
deno task dev
```

