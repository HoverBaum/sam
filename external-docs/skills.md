> ## Documentation Index
> Fetch the complete documentation index at: https://agentskills.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Best practices for skill creators

> How to write skills that are well-scoped and calibrated to the task.

## Start from real expertise

A common pitfall in skill creation is asking an LLM to generate a skill without providing domain-specific context — relying solely on the LLM's general training knowledge. The result is vague, generic procedures ("handle errors appropriately," "follow best practices for authentication") rather than the specific API patterns, edge cases, and project conventions that make a skill valuable.

Effective skills are grounded in real expertise. The key is feeding domain-specific context into the creation process.

### Extract from a hands-on task

Complete a real task in conversation with an agent, providing context, corrections, and preferences along the way. Then extract the reusable pattern into a skill. Pay attention to:

* **Steps that worked** — the sequence of actions that led to success
* **Corrections you made** — places where you steered the agent's approach (e.g., "use library X instead of Y," "check for edge case Z")
* **Input/output formats** — what the data looked like going in and coming out
* **Context you provided** — project-specific facts, conventions, or constraints the agent didn't already know

### Synthesize from existing project artifacts

When you have a body of existing knowledge, you can feed it into an LLM and ask it to synthesize a skill. A data-pipeline skill synthesized from your team's actual incident reports and runbooks will outperform one synthesized from a generic "data engineering best practices" article, because it captures *your* schemas, failure modes, and recovery procedures. The key is project-specific material, not generic references.

Good source material includes:

* Internal documentation, runbooks, and style guides
* API specifications, schemas, and configuration files
* Code review comments and issue trackers (captures recurring concerns and reviewer expectations)
* Version control history, especially patches and fixes (reveals patterns through what actually changed)
* Real-world failure cases and their resolutions

## Refine with real execution

The first draft of a skill usually needs refinement. Run the skill against real tasks, then feed the results — all of them, not just failures — back into the creation process. Ask: what triggered false positives? What was missed? What could be cut?

Even a single pass of execute-then-revise noticeably improves quality, and complex domains often benefit from several.

<Tip>
  Read agent execution traces, not just final outputs. If the agent wastes time on unproductive steps, common causes include instructions that are too vague (the agent tries several approaches before finding one that works), instructions that don't apply to the current task (the agent follows them anyway), or too many options presented without a clear default.
</Tip>

For a more structured approach to iteration, including test cases, assertions, and grading, see [Evaluating skill output quality](/skill-creation/evaluating-skills).

## Spending context wisely

Once a skill activates, its full `SKILL.md` body loads into the agent's context window alongside conversation history, system context, and other active skills. Every token in your skill competes for the agent's attention with everything else in that window.

### Add what the agent lacks, omit what it knows

Focus on what the agent *wouldn't* know without your skill: project-specific conventions, domain-specific procedures, non-obvious edge cases, and the particular tools or APIs to use. You don't need to explain what a PDF is, how HTTP works, or what a database migration does.

````markdown  theme={null}
<!-- Too verbose — the agent already knows what PDFs are -->
## Extract PDF text

PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need to
use a library. pdfplumber is recommended because it handles most cases well.

<!-- Better — jumps straight to what the agent wouldn't know on its own -->
## Extract PDF text

Use pdfplumber for text extraction. For scanned documents, fall back to
pdf2image with pytesseract.

```python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```
````

Ask yourself about each piece of content: "Would the agent get this wrong without this instruction?" If the answer is no, cut it. If you're unsure, test it. And if the agent already handles the entire task well without the skill, the skill may not be adding value. See [Evaluating skill output quality](/skill-creation/evaluating-skills) for how to test this systematically.

### Design coherent units

Deciding what a skill should cover is like deciding what a function should do: you want it to encapsulate a coherent unit of work that composes well with other skills. Skills scoped too narrowly force multiple skills to load for a single task, risking overhead and conflicting instructions. Skills scoped too broadly become hard to activate precisely. A skill for querying a database and formatting the results may be one coherent unit, while a skill that also covers database administration is probably trying to do too much.

### Aim for moderate detail

Overly comprehensive skills can hurt more than they help — the agent struggles to extract what's relevant and may pursue unproductive paths triggered by instructions that don't apply to the current task. Concise, stepwise guidance with a working example tends to outperform exhaustive documentation. When you find yourself covering every edge case, consider whether most are better handled by the agent's own judgment.

### Structure large skills with progressive disclosure

The [specification](/specification#progressive-disclosure) recommends keeping `SKILL.md` under 500 lines and 5,000 tokens — just the core instructions the agent needs on every run. When a skill legitimately needs more content, move detailed reference material to separate files in `references/` or similar directories.

The key is telling the agent *when* to load each file. "Read `references/api-errors.md` if the API returns a non-200 status code" is more useful than a generic "see references/ for details." This lets the agent load context on demand rather than up front, which is how [progressive disclosure](/what-are-skills#how-skills-work) is designed to work.

## Calibrating control

Not every part of a skill needs the same level of prescriptiveness. Match the specificity of your instructions to the fragility of the task.

### Match specificity to fragility

**Give the agent freedom** when multiple approaches are valid and the task tolerates variation. For flexible instructions, explaining *why* can be more effective than rigid directives — an agent that understands the purpose behind an instruction makes better context-dependent decisions. A code review skill can describe what to look for without prescribing exact steps:

```markdown  theme={null}
## Code review process

1. Check all database queries for SQL injection (use parameterized queries)
2. Verify authentication checks on every endpoint
3. Look for race conditions in concurrent code paths
4. Confirm error messages don't leak internal details
```

**Be prescriptive** when operations are fragile, consistency matters, or a specific sequence must be followed:

````markdown  theme={null}
## Database migration

Run exactly this sequence:

```bash
python scripts/migrate.py --verify --backup
```

Do not modify the command or add additional flags.
````

Most skills have a mix. Calibrate each part independently.

### Provide defaults, not menus

When multiple tools or approaches could work, pick a default and mention alternatives briefly rather than presenting them as equal options.

````markdown  theme={null}
<!-- Too many options -->
You can use pypdf, pdfplumber, PyMuPDF, or pdf2image...

<!-- Clear default with escape hatch -->
Use pdfplumber for text extraction:

```python
import pdfplumber
```

For scanned PDFs requiring OCR, use pdf2image with pytesseract instead.
````

### Favor procedures over declarations

A skill should teach the agent *how to approach* a class of problems, not *what to produce* for a specific instance. Compare:

```markdown  theme={null}
<!-- Specific answer — only useful for this exact task -->
Join the `orders` table to `customers` on `customer_id`, filter where
`region = 'EMEA'`, and sum the `amount` column.

<!-- Reusable method — works for any analytical query -->
1. Read the schema from `references/schema.yaml` to find relevant tables
2. Join tables using the `_id` foreign key convention
3. Apply any filters from the user's request as WHERE clauses
4. Aggregate numeric columns as needed and format as a markdown table
```

This doesn't mean skills can't include specific details — output format templates (see [Templates for output format](#templates-for-output-format)), constraints like "never output PII," and tool-specific instructions are all valuable. The point is that the *approach* should generalize even when individual details are specific.

## Patterns for effective instructions

These are reusable techniques for structuring skill content. Not every skill needs all of them — use the ones that fit your task.

### Gotchas sections

The highest-value content in many skills is a list of gotchas — environment-specific facts that defy reasonable assumptions. These aren't general advice ("handle errors appropriately") but concrete corrections to mistakes the agent will make without being told otherwise:

```markdown  theme={null}
## Gotchas

- The `users` table uses soft deletes. Queries must include
  `WHERE deleted_at IS NULL` or results will include deactivated accounts.
- The user ID is `user_id` in the database, `uid` in the auth service,
  and `accountId` in the billing API. All three refer to the same value.
- The `/health` endpoint returns 200 as long as the web server is running,
  even if the database connection is down. Use `/ready` to check full
  service health.
```

Keep gotchas in `SKILL.md` where the agent reads them before encountering the situation. A separate reference file works if you tell the agent when to load it, but for non-obvious issues, the agent may not recognize the trigger.

<Tip>
  When an agent makes a mistake you have to correct, add the correction to the gotchas section. This is one of the most direct ways to improve a skill iteratively (see [Refine with real execution](#refine-with-real-execution)).
</Tip>

### Templates for output format

When you need the agent to produce output in a specific format, provide a template. This is more reliable than describing the format in prose, because agents pattern-match well against concrete structures. Short templates can live inline in `SKILL.md`; for longer templates, or templates only needed in certain cases, store them in `assets/` and reference them from `SKILL.md` so they only load when needed.

````markdown  theme={null}
## Report structure

Use this template, adapting sections as needed for the specific analysis:

```markdown
# [Analysis Title]

## Executive summary
[One-paragraph overview of key findings]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data

## Recommendations
1. Specific actionable recommendation
2. Specific actionable recommendation
```
````

### Checklists for multi-step workflows

An explicit checklist helps the agent track progress and avoid skipping steps, especially when steps have dependencies or validation gates.

```markdown  theme={null}
## Form processing workflow

Progress:
- [ ] Step 1: Analyze the form (run `scripts/analyze_form.py`)
- [ ] Step 2: Create field mapping (edit `fields.json`)
- [ ] Step 3: Validate mapping (run `scripts/validate_fields.py`)
- [ ] Step 4: Fill the form (run `scripts/fill_form.py`)
- [ ] Step 5: Verify output (run `scripts/verify_output.py`)
```

### Validation loops

Instruct the agent to validate its own work before moving on. The pattern is: do the work, run a validator (a script, a reference checklist, or a self-check), fix any issues, and repeat until validation passes.

```markdown  theme={null}
## Editing workflow

1. Make your edits
2. Run validation: `python scripts/validate.py output/`
3. If validation fails:
   - Review the error message
   - Fix the issues
   - Run validation again
4. Only proceed when validation passes
```

A reference document can also serve as the "validator" — instruct the agent to check its work against the reference before finalizing.

### Plan-validate-execute

For batch or destructive operations, have the agent create an intermediate plan in a structured format, validate it against a source of truth, and only then execute.

```markdown  theme={null}
## PDF form filling

1. Extract form fields: `python scripts/analyze_form.py input.pdf` → `form_fields.json`
   (lists every field name, type, and whether it's required)
2. Create `field_values.json` mapping each field name to its intended value
3. Validate: `python scripts/validate_fields.py form_fields.json field_values.json`
   (checks that every field name exists in the form, types are compatible, and
   required fields aren't missing)
4. If validation fails, revise `field_values.json` and re-validate
5. Fill the form: `python scripts/fill_form.py input.pdf field_values.json output.pdf`
```

The key ingredient is step 3: a validation script that checks the plan (`field_values.json`) against the source of truth (`form_fields.json`). Errors like "Field 'signature\_date' not found — available fields: customer\_name, order\_total, signature\_date\_signed" give the agent enough information to self-correct.

### Bundling reusable scripts

When [iterating on a skill](/skill-creation/evaluating-skills), compare the agent's execution traces across test cases. If you notice the agent independently reinventing the same logic each run — building charts, parsing a specific format, validating output — that's a signal to write a tested script once and bundle it in `scripts/`.

For more on designing and bundling scripts, see [Using scripts in skills](/skill-creation/using-scripts).

## Next steps

Once you have a working skill, two guides can help you refine it further:

* **[Evaluating skill output quality](/skill-creation/evaluating-skills)** — Set up test cases, grade results, and iterate systematically.
* **[Optimizing skill descriptions](/skill-creation/optimizing-descriptions)** — Test and improve your skill's `description` field so it triggers on the right prompts.


Built with [Mintlify](https://mintlify.com).


> ## Documentation Index
> Fetch the complete documentation index at: https://agentskills.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Using scripts in skills

> How to run commands and bundle executable scripts in your skills.

Skills can instruct agents to run shell commands and bundle reusable scripts in a `scripts/` directory. This guide covers one-off commands, self-contained scripts with their own dependencies, and how to design script interfaces for agentic use.

## One-off commands

When an existing package already does what you need, you can reference it directly in your `SKILL.md` instructions without a `scripts/` directory. Many ecosystems provide tools that auto-resolve dependencies at runtime.

<Tabs sync={false}>
  <Tab title="uvx">
    [uvx](https://docs.astral.sh/uv/guides/tools/) runs Python packages in isolated environments with aggressive caching. It ships with [uv](https://docs.astral.sh/uv/).

    ```bash  theme={null}
    uvx ruff@0.8.0 check .
    uvx black@24.10.0 .
    ```

    * Not bundled with Python — requires a separate install.
    * Fast. Caches aggressively so repeat runs are near-instant.
  </Tab>

  <Tab title="pipx">
    [pipx](https://pipx.pypa.io/) runs Python packages in isolated environments. Available via OS package managers (`apt install pipx`, `brew install pipx`).

    ```bash  theme={null}
    pipx run 'black==24.10.0' .
    pipx run 'ruff==0.8.0' check .
    ```

    * Not bundled with Python — requires a separate install.
    * A mature alternative to `uvx`. While `uvx` has become the standard recommendation, `pipx` remains a reliable option with broader OS package manager availability.
  </Tab>

  <Tab title="npx">
    [npx](https://docs.npmjs.com/cli/commands/npx) runs npm packages, downloading them on demand. It ships with npm (which ships with Node.js).

    ```bash  theme={null}
    npx eslint@9 --fix .
    npx create-vite@6 my-app
    ```

    * Bundled with Node.js — no extra install needed.
    * Downloads the package, runs it, and caches it for future use.
    * Pin versions with `npx package@version` for reproducibility.
  </Tab>

  <Tab title="bunx">
    [bunx](https://bun.sh/docs/cli/bunx) is Bun's equivalent of `npx`. It ships with [Bun](https://bun.sh/).

    ```bash  theme={null}
    bunx eslint@9 --fix .
    bunx create-vite@6 my-app
    ```

    * Drop-in replacement for `npx` in Bun-based environments.
    * Only appropriate when the user's environment has Bun rather than Node.js.
  </Tab>

  <Tab title="deno run">
    [deno run](https://docs.deno.com/runtime/reference/cli/run/) runs scripts directly from URLs or specifiers. It ships with [Deno](https://deno.com/).

    ```bash  theme={null}
    deno run npm:create-vite@6 my-app
    deno run --allow-read npm:eslint@9 -- --fix .
    ```

    * Permission flags (`--allow-read`, etc.) are required for filesystem/network access.
    * Use `--` to separate Deno flags from the tool's own flags.
  </Tab>

  <Tab title="go run">
    [go run](https://pkg.go.dev/cmd/go#hdr-Compile_and_run_Go_program) compiles and runs Go packages directly. It is built into the `go` command.

    ```bash  theme={null}
    go run golang.org/x/tools/cmd/goimports@v0.28.0 .
    go run github.com/golangci/golangci-lint/cmd/golangci-lint@v1.62.0 run
    ```

    * Built into Go — no extra tooling needed.
    * Pin versions or use `@latest` to make the command explicit.
  </Tab>
</Tabs>

**Tips for one-off commands in skills:**

* **Pin versions** (e.g., `npx eslint@9.0.0`) so the command behaves the same over time.
* **State prerequisites** in your `SKILL.md` (e.g., "Requires Node.js 18+") rather than assuming the agent's environment has them. For runtime-level requirements, use the [`compatibility` frontmatter field](/specification#compatibility-field).
* **Move complex commands into scripts.** A one-off command works well when you're invoking a tool with a few flags. When a command grows complex enough that it's hard to get right on the first try, a tested script in `scripts/` is more reliable.

## Referencing scripts from `SKILL.md`

Use **relative paths from the skill directory root** to reference bundled files. The agent resolves these paths automatically — no absolute paths needed.

List available scripts in your `SKILL.md` so the agent knows they exist:

```markdown SKILL.md theme={null}
## Available scripts

- **`scripts/validate.sh`** — Validates configuration files
- **`scripts/process.py`** — Processes input data
```

Then instruct the agent to run them:

````markdown SKILL.md theme={null}
## Workflow

1. Run the validation script:
   ```bash
   bash scripts/validate.sh "$INPUT_FILE"
   ```

2. Process the results:
   ```bash
   python3 scripts/process.py --input results.json
   ```
````

<Note>
  The same relative-path convention works in support files like `references/*.md` — script execution paths (in code blocks) are relative to the **skill directory root**, because the agent runs commands from there.
</Note>

## Self-contained scripts

When you need reusable logic, bundle a script in `scripts/` that declares its own dependencies inline. The agent can run the script with a single command — no separate manifest file or install step required.

Several languages support inline dependency declarations:

<Tabs sync={false}>
  <Tab title="Python">
    [PEP 723](https://peps.python.org/pep-0723/) defines a standard format for inline script metadata. Declare dependencies in a TOML block inside `# ///` markers:

    ```python scripts/extract.py theme={null}
    # /// script
    # dependencies = [
    #   "beautifulsoup4",
    # ]
    # ///

    from bs4 import BeautifulSoup

    html = '<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>'
    print(BeautifulSoup(html, "html.parser").select_one("p.info").get_text())
    ```

    Run with [uv](https://docs.astral.sh/uv/) (recommended):

    ```bash  theme={null}
    uv run scripts/extract.py
    ```

    `uv run` creates an isolated environment, installs the declared dependencies, and runs the script. [pipx](https://pipx.pypa.io/) (`pipx run scripts/extract.py`) also supports PEP 723.

    * Pin versions with [PEP 508](https://peps.python.org/pep-0508/) specifiers: `"beautifulsoup4>=4.12,<5"`.
    * Use `requires-python` to constrain the Python version.
    * Use `uv lock --script` to create a lockfile for full reproducibility.
  </Tab>

  <Tab title="Deno">
    Deno's `npm:` and `jsr:` import specifiers make every script self-contained by default:

    ```typescript scripts/extract.ts theme={null}
    #!/usr/bin/env -S deno run

    import * as cheerio from "npm:cheerio@1.0.0";

    const html = `<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>`;
    const $ = cheerio.load(html);
    console.log($("p.info").text());
    ```

    ```bash  theme={null}
    deno run scripts/extract.ts
    ```

    * Use `npm:` for npm packages, `jsr:` for Deno-native packages.
    * Version specifiers follow semver: `@1.0.0` (exact), `@^1.0.0` (compatible).
    * Dependencies are cached globally. Use `--reload` to force re-fetch.
    * Packages with native addons (node-gyp) may not work — packages that ship pre-built binaries work best.
  </Tab>

  <Tab title="Bun">
    Bun auto-installs missing packages at runtime when no `node_modules` directory is found. Pin versions directly in the import path:

    ```typescript scripts/extract.ts theme={null}
    #!/usr/bin/env bun

    import * as cheerio from "cheerio@1.0.0";

    const html = `<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>`;
    const $ = cheerio.load(html);
    console.log($("p.info").text());
    ```

    ```bash  theme={null}
    bun run scripts/extract.ts
    ```

    * No `package.json` or `node_modules` needed. TypeScript works natively.
    * Packages are cached globally. First run downloads; subsequent runs are near-instant.
    * If a `node_modules` directory exists anywhere up the directory tree, auto-install is disabled and Bun falls back to standard Node.js resolution.
  </Tab>

  <Tab title="Ruby">
    Bundler ships with Ruby since 2.6. Use `bundler/inline` to declare gems directly in the script:

    ```ruby scripts/extract.rb theme={null}
    require 'bundler/inline'

    gemfile do
      source 'https://rubygems.org'
      gem 'nokogiri'
    end

    html = '<html><body><h1>Welcome</h1><p class="info">This is a test.</p></body></html>'
    doc = Nokogiri::HTML(html)
    puts doc.at_css('p.info').text
    ```

    ```bash  theme={null}
    ruby scripts/extract.rb
    ```

    * Pin versions explicitly (`gem 'nokogiri', '~> 1.16'`) — there is no lockfile.
    * An existing `Gemfile` or `BUNDLE_GEMFILE` env var in the working directory can interfere.
  </Tab>
</Tabs>

## Designing scripts for agentic use

When an agent runs your script, it reads stdout and stderr to decide what to do next. A few design choices make scripts dramatically easier for agents to use.

### Avoid interactive prompts

This is a hard requirement of the agent execution environment. Agents operate in non-interactive shells — they cannot respond to TTY prompts, password dialogs, or confirmation menus. A script that blocks on interactive input will hang indefinitely.

Accept all input via command-line flags, environment variables, or stdin:

```
# Bad: hangs waiting for input
$ python scripts/deploy.py
Target environment: _

# Good: clear error with guidance
$ python scripts/deploy.py
Error: --env is required. Options: development, staging, production.
Usage: python scripts/deploy.py --env staging --tag v1.2.3
```

### Document usage with `--help`

`--help` output is the primary way an agent learns your script's interface. Include a brief description, available flags, and usage examples:

```
Usage: scripts/process.py [OPTIONS] INPUT_FILE

Process input data and produce a summary report.

Options:
  --format FORMAT    Output format: json, csv, table (default: json)
  --output FILE      Write output to FILE instead of stdout
  --verbose          Print progress to stderr

Examples:
  scripts/process.py data.csv
  scripts/process.py --format csv --output report.csv data.csv
```

Keep it concise — the output enters the agent's context window alongside everything else it's working with.

### Write helpful error messages

When an agent gets an error, the message directly shapes its next attempt. An opaque "Error: invalid input" wastes a turn. Instead, say what went wrong, what was expected, and what to try:

```
Error: --format must be one of: json, csv, table.
       Received: "xml"
```

### Use structured output

Prefer structured formats — JSON, CSV, TSV — over free-form text. Structured formats can be consumed by both the agent and standard tools (`jq`, `cut`, `awk`), making your script composable in pipelines.

```
# Whitespace-aligned — hard to parse programmatically
NAME          STATUS    CREATED
my-service    running   2025-01-15

# Delimited — unambiguous field boundaries
{"name": "my-service", "status": "running", "created": "2025-01-15"}
```

**Separate data from diagnostics:** send structured data to stdout and progress messages, warnings, and other diagnostics to stderr. This lets the agent capture clean, parseable output while still having access to diagnostic information when needed.

### Further considerations

* **Idempotency.** Agents may retry commands. "Create if not exists" is safer than "create and fail on duplicate."
* **Input constraints.** Reject ambiguous input with a clear error rather than guessing. Use enums and closed sets where possible.
* **Dry-run support.** For destructive or stateful operations, a `--dry-run` flag lets the agent preview what will happen.
* **Meaningful exit codes.** Use distinct exit codes for different failure types (not found, invalid arguments, auth failure) and document them in your `--help` output so the agent knows what each code means.
* **Safe defaults.** Consider whether destructive operations should require explicit confirmation flags (`--confirm`, `--force`) or other safeguards appropriate to the risk level.
* **Predictable output size.** Many agent harnesses automatically truncate tool output beyond a threshold (e.g., 10-30K characters), potentially losing critical information. If your script might produce large output, default to a summary or a reasonable limit, and support flags like `--offset` so the agent can request more information when needed. Alternatively, if output is large and not amenable to pagination, require agents to pass an `--output` flag that specifies either an output file or `-` to explicitly opt in to stdout.


Built with [Mintlify](https://mintlify.com).

> ## Documentation Index
> Fetch the complete documentation index at: https://agentskills.io/llms.txt
> Use this file to discover all available pages before exploring further.

# How to add skills support to your agent

> A guide for adding Agent Skills support to an AI agent or development tool.

This guide walks through how to add Agent Skills support to an AI agent or development tool. It covers the full lifecycle: discovering skills, telling the model about them, loading their content into context, and keeping that content effective over time.

The core integration is the same regardless of your agent's architecture. The implementation details vary based on two factors:

* **Where do skills live?** A locally-running agent can scan the user's filesystem for skill directories. A cloud-hosted or sandboxed agent will need an alternative discovery mechanism — an API, a remote registry, or bundled assets.
* **How does the model access skill content?** If the model has file-reading capabilities, it can read `SKILL.md` files directly. Otherwise, you'll provide a dedicated tool or inject skill content into the prompt programmatically.

The guide notes where these differences matter. You don't need to support every scenario — follow the path that fits your agent.

**Prerequisites**: Familiarity with the [Agent Skills specification](/specification), which defines the `SKILL.md` file format, frontmatter fields, and directory conventions.

## The core principle: progressive disclosure

Every skills-compatible agent follows the same three-tier loading strategy:

| Tier            | What's loaded               | When                                 | Token cost                  |
| --------------- | --------------------------- | ------------------------------------ | --------------------------- |
| 1. Catalog      | Name + description          | Session start                        | \~50-100 tokens per skill   |
| 2. Instructions | Full `SKILL.md` body        | When the skill is activated          | \<5000 tokens (recommended) |
| 3. Resources    | Scripts, references, assets | When the instructions reference them | Varies                      |

The model sees the catalog from the start, so it knows what skills are available. When it decides a skill is relevant, it loads the full instructions. If those instructions reference supporting files, the model loads them individually as needed.

This keeps the base context small while giving the model access to specialized knowledge on demand. An agent with 20 installed skills doesn't pay the token cost of 20 full instruction sets upfront — only the ones actually used in a given conversation.

## Step 1: Discover skills

At session startup, find all available skills and load their metadata.

### Where to scan

Which directories you scan depends on your agent's environment. Most locally-running agents scan at least two scopes:

* **Project-level** (relative to the working directory): Skills specific to a project or repository.
* **User-level** (relative to the home directory): Skills available across all projects for a given user.

Other scopes are possible too — for example, organization-wide skills deployed by an admin, or skills bundled with the agent itself. The right set of scopes depends on your agent's deployment model.

Within each scope, consider scanning both a **client-specific directory** and the **`.agents/skills/` convention**:

| Scope   | Path                               | Purpose                       |
| ------- | ---------------------------------- | ----------------------------- |
| Project | `<project>/.<your-client>/skills/` | Your client's native location |
| Project | `<project>/.agents/skills/`        | Cross-client interoperability |
| User    | `~/.<your-client>/skills/`         | Your client's native location |
| User    | `~/.agents/skills/`                | Cross-client interoperability |

The `.agents/skills/` paths have emerged as a widely-adopted convention for cross-client skill sharing. While the Agent Skills specification does not mandate where skill directories live (it only defines what goes inside them), scanning `.agents/skills/` means skills installed by other compliant clients are automatically visible to yours, and vice versa.

<Note>
  Some implementations also scan `.claude/skills/` (both project-level and user-level) for pragmatic compatibility, since many existing skills are installed there. Other additional locations include ancestor directories up to the git root (useful for monorepos), [XDG](https://specifications.freedesktop.org/basedir-spec/latest/) config directories, and user-configured paths.
</Note>

### What to scan for

Within each skills directory, look for **subdirectories containing a file named exactly `SKILL.md`**:

```
~/.agents/skills/
├── pdf-processing/
│   ├── SKILL.md          ← discovered
│   └── scripts/
│       └── extract.py
├── data-analysis/
│   └── SKILL.md          ← discovered
└── README.md             ← ignored (not a skill directory)
```

Practical scanning rules:

* Skip directories that won't contain skills, such as `.git/` and `node_modules/`
* Optionally respect `.gitignore` to avoid scanning build artifacts
* Set reasonable bounds (e.g., max depth of 4-6 levels, max 2000 directories) to prevent runaway scanning in large directory trees

### Handling name collisions

When two skills share the same `name`, apply a deterministic precedence rule.

The universal convention across existing implementations: **project-level skills override user-level skills.**

Within the same scope (e.g., two skills named `code-review` found under both `<project>/.agents/skills/` and `<project>/.<your-client>/skills/`), either first-found or last-found is acceptable — pick one and be consistent. Log a warning when a collision occurs so the user knows a skill was shadowed.

### Trust considerations

Project-level skills come from the repository being worked on, which may be untrusted (e.g., a freshly cloned open-source project). Consider gating project-level skill loading on a trust check — only load them if the user has marked the project folder as trusted. This prevents untrusted repositories from silently injecting instructions into the agent's context.

### Cloud-hosted and sandboxed agents

If your agent runs in a container or on a remote server, it won't have access to the user's local filesystem. Discovery needs to work differently depending on the skill scope:

* **Project-level skills** are often the easiest case. If the agent operates on a cloned repository (even inside a sandbox), project-level skills travel with the code and can be scanned from the repo's directory tree.
* **User-level and organization-level skills** don't exist in the sandbox. You'll need to provision them from an external source — for example, cloning a configuration repository, accepting skill URLs or packages through your agent's settings, or letting users upload skill directories through a web UI.
* **Built-in skills** can be packaged as static assets within the agent's deployment artifact, making them available in every session without external fetching.

Once skills are available to the agent, the rest of the lifecycle — parsing, disclosure, activation — works the same.

## Step 2: Parse `SKILL.md` files

For each discovered `SKILL.md`, extract the metadata and body content.

### Frontmatter extraction

A `SKILL.md` file has two parts: YAML frontmatter between `---` delimiters, and a markdown body after the closing delimiter. To parse:

1. Find the opening `---` at the start of the file and the closing `---` after it.
2. Parse the YAML block between them. Extract `name` and `description` (required), plus any optional fields.
3. Everything after the closing `---`, trimmed, is the skill's body content.

See the [specification](/specification) for the full set of frontmatter fields and their constraints.

### Handling malformed YAML

Skill files authored for other clients may contain technically invalid YAML that their parsers happen to accept. The most common issue is unquoted values containing colons:

```yaml  theme={null}
# Technically invalid YAML — the colon breaks parsing
description: Use this skill when: the user asks about PDFs
```

Consider a fallback that wraps such values in quotes or converts them to YAML block scalars before retrying. This improves cross-client compatibility at minimal cost.

### Lenient validation

Warn on issues but still load the skill when possible:

* Name doesn't match the parent directory name → warn, load anyway
* Name exceeds 64 characters → warn, load anyway
* Description is missing or empty → skip the skill (a description is essential for disclosure), log the error
* YAML is completely unparseable → skip the skill, log the error

Record diagnostics so they can be surfaced to the user (in a debug command, log file, or UI), but don't block skill loading on cosmetic issues.

<Note>
  The [specification](/specification) defines strict constraints on the `name` field (matching the parent directory, character set, max length). The lenient approach above deliberately relaxes these to improve compatibility with skills authored for other clients.
</Note>

### What to store

At minimum, each skill record needs three fields:

| Field         | Description                          |
| ------------- | ------------------------------------ |
| `name`        | From frontmatter                     |
| `description` | From frontmatter                     |
| `location`    | Absolute path to the `SKILL.md` file |

Store these in an in-memory map keyed by `name` for fast lookup during activation.

You can also store the **body** (the markdown content after the frontmatter) at discovery time, or read it from `location` at activation time. Storing it makes activation faster; reading it at activation time uses less memory in aggregate and picks up changes to skill files between activations.

The skill's **base directory** (the parent directory of `location`) is needed later to resolve relative paths and enumerate bundled resources — derive it from `location` when needed.

## Step 3: Disclose available skills to the model

Tell the model what skills exist without loading their full content. This is [tier 1 of progressive disclosure](#the-core-principle-progressive-disclosure).

### Building the skill catalog

For each discovered skill, include `name`, `description`, and optionally `location` (the path to the `SKILL.md` file) in whatever structured format suits your stack — XML, JSON, or a bulleted list all work:

```xml  theme={null}
<available_skills>
  <skill>
    <name>pdf-processing</name>
    <description>Extract PDF text, fill forms, merge files. Use when handling PDFs.</description>
    <location>/home/user/.agents/skills/pdf-processing/SKILL.md</location>
  </skill>
  <skill>
    <name>data-analysis</name>
    <description>Analyze datasets, generate charts, and create summary reports.</description>
    <location>/home/user/project/.agents/skills/data-analysis/SKILL.md</location>
  </skill>
</available_skills>
```

The `location` field serves two purposes: it enables file-read activation (see [Step 4](#step-4-activate-skills)), and it gives the model a base path for resolving relative references in the skill body (like `scripts/evaluate.py`). If your dedicated activation tool provides the skill directory path in its result (see [Structured wrapping](#structured-wrapping) in Step 4), you can omit `location` from the catalog. Otherwise, include it.

Each skill adds roughly 50-100 tokens to the catalog. Even with dozens of skills installed, the catalog remains compact.

### Where to place the catalog

Two approaches are common:

**System prompt section**: Add the catalog as a labeled section in the system prompt, preceded by brief instructions on how to use skills. This is the simplest approach and works with any model that has access to a file-reading tool.

**Tool description**: Embed the catalog in the description of a dedicated skill-activation tool (see [Step 4](#step-4-activate-skills)). This keeps the system prompt clean and naturally couples discovery with activation.

Both work. System prompt placement is simpler and more broadly compatible; tool description embedding is cleaner when you have a dedicated activation tool.

### Behavioral instructions

Include a short instruction block alongside the catalog telling the model how and when to use skills. The wording depends on which activation mechanism you support (see [Step 4](#step-4-activate-skills)):

**If the model activates skills by reading files:**

```
The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, use your file-read tool to load
the SKILL.md at the listed location before proceeding.
When a skill references relative paths, resolve them against the skill's
directory (the parent of SKILL.md) and use absolute paths in tool calls.
```

**If the model activates skills via a dedicated tool:**

```
The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the activate_skill tool
with the skill's name to load its full instructions.
```

Keep these instructions concise. The goal is to tell the model that skills exist and how to load them — the skill content itself provides the detailed instructions once loaded.

### Filtering

Some skills should be excluded from the catalog. Common reasons:

* The user has disabled the skill in settings
* A permission system denies access to the skill
* The skill has opted out of model-driven activation (e.g., via a `disable-model-invocation` flag)

**Hide filtered skills entirely** from the catalog rather than listing them and blocking at activation time. This prevents the model from wasting turns attempting to load skills it can't use.

### When no skills are available

If no skills are discovered, omit the catalog and behavioral instructions entirely. Don't show an empty `<available_skills/>` block or register a skill tool with no valid options — this would confuse the model.

## Step 4: Activate skills

When the model or user selects a skill, deliver the full instructions into the conversation context. This is [tier 2 of progressive disclosure](#the-core-principle-progressive-disclosure).

### Model-driven activation

Most implementations rely on the model's own judgment as the activation mechanism, rather than implementing harness-side trigger matching or keyword detection. The model reads the catalog (from [Step 3](#step-3-disclose-available-skills-to-the-model)), decides a skill is relevant to the current task, and loads it.

Two implementation patterns:

**File-read activation**: The model calls its standard file-read tool with the `SKILL.md` path from the catalog. No special infrastructure needed — the agent's existing file-reading capability is sufficient. The model receives the file content as a tool result. This is the simplest approach when the model has file access.

**Dedicated tool activation**: Register a tool (e.g., `activate_skill`) that takes a skill name and returns the content. This is required when the model can't read files directly, and optional (but useful) even when it can. Advantages over raw file reads:

* Control what content is returned — e.g., strip YAML frontmatter or preserve it (see [What the model receives](#what-the-model-receives) below)
* Wrap content in structured tags for identification during context management
* List bundled resources (e.g., `references/*`) alongside the instructions
* Enforce permissions or prompt for user consent
* Track activation for analytics

<Tip>
  If you use a dedicated activation tool, constrain the `name` parameter to the set of valid skill names (e.g., as an enum in the tool schema). This prevents the model from hallucinating nonexistent skill names. If no skills are available, don't register the tool at all.
</Tip>

### User-explicit activation

Users should also be able to activate skills directly, without waiting for the model to decide. The most common pattern is a **slash command or mention syntax** (`/skill-name` or `$skill-name`) that the harness intercepts. The specific syntax is up to you — the key idea is that the harness handles the lookup and injection, so the model receives skill content without needing to take an activation action itself.

An autocomplete widget (listing available skills as the user types) can also make this discoverable.

### What the model receives

When a skill is activated, the model receives the skill's instructions. Two options for what exactly that content looks like:

**Full file**: The model sees the entire `SKILL.md` including YAML frontmatter. This is the natural outcome with file-read activation, where the model reads the raw file. It's also a valid choice for dedicated tools. The frontmatter may contain fields useful at activation time — for example, [`compatibility`](/specification#compatibility-field) notes environment requirements that could inform how the model executes the skill's instructions.

**Body only (frontmatter stripped)**: The harness parses and removes the YAML frontmatter, returning only the markdown instructions. Among existing implementations with dedicated activation tools, most take this approach — stripping the frontmatter after extracting `name` and `description` during discovery.

Both approaches work in practice.

### Structured wrapping

If you use a dedicated activation tool, consider wrapping skill content in identifying tags. For example:

```xml  theme={null}
<skill_content name="pdf-processing">
# PDF Processing

## When to use this skill
Use this skill when the user needs to work with PDF files...

[rest of SKILL.md body]

Skill directory: /home/user/.agents/skills/pdf-processing
Relative paths in this skill are relative to the skill directory.

<skill_resources>
  <file>scripts/extract.py</file>
  <file>scripts/merge.py</file>
  <file>references/pdf-spec-summary.md</file>
</skill_resources>
</skill_content>
```

This has practical benefits:

* The model can clearly distinguish skill instructions from other conversation content
* The harness can identify skill content during context compaction ([Step 5](#step-5-manage-skill-context-over-time))
* Bundled resources are surfaced to the model without being eagerly loaded

### Listing bundled resources

When a dedicated activation tool returns skill content, it can also enumerate supporting files (scripts, references, assets) in the skill directory — but it should **not eagerly read them**. The model loads specific files on demand using its file-read tools when the skill's instructions reference them.

For large skill directories, consider capping the listing and noting that it may be incomplete.

### Permission allowlisting

If your agent has a permission system that gates file access, **allowlist skill directories** so the model can read bundled resources without triggering user confirmation prompts. Without this, every reference to a bundled script or reference file results in a permission dialog, breaking the flow for skills that include resources beyond the `SKILL.md` itself.

## Step 5: Manage skill context over time

Once skill instructions are in the conversation context, keep them effective for the duration of the session.

### Protect skill content from context compaction

If your agent truncates or summarizes older messages when the context window fills up, **exempt skill content from pruning**. Skill instructions are durable behavioral guidance — losing them mid-conversation silently degrades the agent's performance without any visible error. The model continues operating but without the specialized instructions the skill provided.

Common approaches:

* Flag skill tool outputs as protected so the pruning algorithm skips them
* Use the [structured tags](#structured-wrapping) from Step 4 to identify skill content and preserve it during compaction

### Deduplicate activations

Consider tracking which skills have been activated in the current session. If the model (or user) attempts to load a skill that's already in context, you can skip the re-injection to avoid the same instructions appearing multiple times in the conversation.

### Subagent delegation (optional)

This is an advanced pattern only supported by some clients. Instead of injecting skill instructions into the main conversation, the skill is run in a **separate subagent session**. The subagent receives the skill instructions, performs the task, and returns a summary of its work to the main conversation.

This pattern is useful when a skill's workflow is complex enough to benefit from a dedicated, focused session.


Built with [Mintlify](https://mintlify.com).