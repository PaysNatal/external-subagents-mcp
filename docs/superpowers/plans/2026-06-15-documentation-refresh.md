# Documentation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the repository documentation into an attractive, accurate Codex-led worker-pool homepage, complete configuration reference, Chinese guide, and concise release history.

**Architecture:** `README.md` becomes the short English product homepage and routes readers to focused guides. `docs/configuration.md` owns exhaustive configuration details, `docs/README.zh-CN.md` owns the complete Chinese onboarding experience, and `CHANGELOG.md` owns user-facing release history. Package metadata and npm file inclusion are updated without changing the package version or publishing.

**Tech Stack:** Markdown, Mermaid, JSON package metadata, npm, TypeScript/Vitest verification.

---

### Task 1: Rewrite The English Project Homepage

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the bilingual manual with a concise English homepage**

The new README must include, in this order:

```markdown
# external-subagents-mcp

> Spend inexpensive model tokens on reading; keep Codex focused on judgment,
> implementation, and verification.

[中文指南](docs/README.zh-CN.md) · [Complete configuration](docs/configuration.md) · [Changelog](CHANGELOG.md)
```

Then add:

- the problem and solution in two short paragraphs
- a Codex versus external-workers responsibility table
- a Mermaid flow showing early delegation and Codex verification
- a short “Why use it?” section
- a five-minute Quick Start
- a tool-selection table
- a profiles overview
- safety, observability, documentation links, project status, and license

The Quick Start and configuration overview must link to
`docs/configuration.md`. Remove the full Chinese duplicate and fix the malformed
cross-project JSON example.

- [ ] **Step 2: Check the README structure and links**

Run:

```bash
rg -n '^#|docs/configuration.md|docs/README.zh-CN.md|CHANGELOG.md|delegate_explore_workspace|Codex remains' README.md
```

Expected: the product story appears before installation, all three guide links
are present, and the explorer/responsibility boundary remains explicit.

- [ ] **Step 3: Commit the homepage**

```bash
git add README.md
git commit -m "docs: rewrite project homepage"
```

### Task 2: Create The Complete Configuration Reference

**Files:**
- Create: `docs/configuration.md`
- Reference: `.external-subagents-mcp.example.json`
- Reference: `src/config.ts`
- Reference: `src/cli.ts`
- Reference: `src/server.ts`

- [ ] **Step 1: Write the exhaustive configuration guide**

Create `docs/configuration.md` with these sections:

```markdown
# Complete Configuration Guide

## Configuration Lookup
## Initialize A Project
## Providers
## API Key Environment Variables
## Connect To Codex
## Roles And Profiles
## Automatic Provider Routing
## Dynamic Output Budgets
## Workspace Authorization
## Cross-Project Delegation
## Cache And Concurrency
## Explorer Requirements And Limits
## Diagnostics And Troubleshooting
## Full Example
```

Document exact current behavior:

- config lookup order
- `init`, `doctor`, `smoke`, and Codex-instruction CLI commands
- API keys only in environment variables and lazy provider-key requirements
- all provider, workspace, cache, concurrency, routing, role, and profile fields
- `explorer` role compatibility fallback
- direct `.external-subagents-mcp.json` authorization requirement for
  cross-project roots
- explorer default and hard limits
- provider tool-calling requirement
- full example matching `.external-subagents-mcp.example.json`

- [ ] **Step 2: Verify guide field names against source**

Run:

```bash
rg -n 'base_url|chat_completions_path|api_key_env|timeout_ms|auto_rules|budget_rules|max_file_bytes|max_total_bytes|ttl_hours|per_provider|max_turns|max_files|max_total_bytes' docs/configuration.md
```

Expected: every major configuration and explorer-limit field is documented.

- [ ] **Step 3: Commit the configuration guide**

```bash
git add docs/configuration.md
git commit -m "docs: add complete configuration guide"
```

### Task 3: Create The Dedicated Chinese User Guide

**Files:**
- Create: `docs/README.zh-CN.md`
- Reference: `README.md`
- Reference: `docs/configuration.md`

- [ ] **Step 1: Write the complete Chinese guide**

Create `docs/README.zh-CN.md` with:

- Chinese product positioning and responsibility boundary
- “为什么使用” and workflow explanation
- installation, initialization, provider setup, API-key setup, and Codex MCP
  connection
- early-delegation instruction installation
- tool-selection and profile overview
- safety and telemetry
- prominent links to the English homepage, complete configuration guide, and
  changelog

The guide must explicitly say the complete field-level configuration reference
is maintained in `configuration.md`.

- [ ] **Step 2: Verify the Chinese guide contains onboarding and reference links**

Run:

```bash
rg -n '完整配置|docs/configuration.md|API Key|install-codex-instructions|delegate_explore_workspace|Codex' docs/README.zh-CN.md
```

Expected: users can complete setup and find the exhaustive configuration
reference.

- [ ] **Step 3: Commit the Chinese guide**

```bash
git add docs/README.zh-CN.md
git commit -m "docs: add dedicated Chinese guide"
```

### Task 4: Rewrite The Changelog And Package Metadata

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Rewrite CHANGELOG as a user-facing release history**

Use concise Keep-a-Changelog sections:

```markdown
## [0.3.0] - Unreleased
### Added
### Changed

## [0.2.1] - 2026-06-13
### Fixed

## [0.2.0] - 2026-06-13
### Added
### Changed
```

Retain `0.1.2`, `0.1.1`, and `0.1.0`, but compress internal narration into
user-visible `Added`, `Changed`, `Fixed`, and `Security` bullets. Do not claim
that `0.3.0` has been released.

- [ ] **Step 2: Improve npm discovery metadata**

Update `package.json` without changing `"version": "0.2.1"`:

```json
{
  "description": "A Codex-led read-only worker pool that delegates workspace exploration and high-context analysis to OpenAI-compatible models.",
  "files": [
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "README.md",
    "CHANGELOG.md",
    "docs/configuration.md",
    "docs/README.zh-CN.md",
    "LICENSE",
    ".external-subagents-mcp.example.json"
  ]
}
```

Add keywords for `read-only`, `workspace-exploration`, `model-routing`,
`token-efficiency`, and `external-workers`. Run `npm install --package-lock-only
--ignore-scripts` to synchronize `package-lock.json`.

- [ ] **Step 3: Verify version and package metadata**

Run:

```bash
node -e 'const p=require("./package.json"); console.log(p.version, p.description, p.files, p.keywords)'
```

Expected: version remains `0.2.1`; new description, docs files, and keywords
are present.

- [ ] **Step 4: Commit changelog and metadata**

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "docs: refresh changelog and package metadata"
```

### Task 5: Documentation And Release-Artifact Verification

**Files:**
- Review: `README.md`
- Review: `docs/configuration.md`
- Review: `docs/README.zh-CN.md`
- Review: `CHANGELOG.md`
- Review: `package.json`

- [ ] **Step 1: Check internal Markdown links**

Run:

```bash
node -e 'const fs=require("fs"),path=require("path"); for(const f of ["README.md","docs/configuration.md","docs/README.zh-CN.md","CHANGELOG.md"]){const s=fs.readFileSync(f,"utf8"); for(const m of s.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)){const t=path.resolve(path.dirname(f),m[1]); if(!fs.existsSync(t)) throw new Error(`${f}: missing ${m[1]}`)}} console.log("documentation links ok")'
```

Expected: `documentation links ok`.

- [ ] **Step 2: Run project verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:stdio
npm pack --dry-run
git diff --check
```

Expected: all commands pass; npm pack includes README, CHANGELOG, configuration
guide, and Chinese guide.

- [ ] **Step 3: Review final documentation for product clarity**

Confirm:

- the README explains the product before setup
- no exact main-model token-savings claim appears
- Codex remains the owner and external workers remain read-only
- both README and Chinese guide link to complete configuration
- CHANGELOG labels `0.3.0` as unreleased
- package version remains `0.2.1`

- [ ] **Step 4: Commit any verification corrections**

```bash
git add README.md docs/configuration.md docs/README.zh-CN.md CHANGELOG.md package.json package-lock.json
git commit -m "docs: polish documentation refresh"
```
