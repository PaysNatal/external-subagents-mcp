# Documentation Refresh Design

## Goal

Reframe `external-subagents-mcp` as a compelling Codex-led worker pool:
inexpensive external models perform high-context reading labor while Codex
retains judgment, implementation, verification, and final acceptance.

The documentation must attract cost-conscious Codex users without making
unverifiable token-savings claims or weakening the project's read-only safety
boundary.

## Audience And Positioning

Primary audience:

- Heavy Codex users working on complex or unfamiliar repositories.
- Users who want to spend lower-cost provider tokens on repetitive reading,
  search, summarization, log analysis, and initial review.

Core message:

> Spend inexpensive model tokens on reading; keep Codex focused on judgment,
> implementation, and verification.

The project is not presented as a replacement for Codex or as an autonomous
implementer. External delegates are a bounded, read-only labor pool.

## README Structure

`README.md` becomes a concise English project homepage rather than a complete
bilingual reference manual.

Recommended reading order:

1. Product name, one-line value proposition, and language link.
2. Short explanation of the problem and the Codex-led solution.
3. Responsibility table: Codex versus external workers.
4. Mermaid workflow showing early delegation, read-only labor, Codex
   verification, and Codex implementation.
5. Key reasons to use the project:
   - reduce expensive main-model context consumption
   - delegate early instead of only reviewing late
   - keep external workers bounded and read-only
   - use provider-neutral routing and profiles
   - inspect usage, cache, recovery, and exploration telemetry
6. Five-minute quick start.
7. Tool-selection guide, emphasizing explorer versus known-path tools.
8. Profiles and provider routing overview.
9. Safety and trust model.
10. Documentation links, project status, and license.

The README must not repeat the complete configuration reference. Its Quick
Start and configuration overview must prominently link to the complete
configuration guide.

## Supporting Guides

### `docs/configuration.md`

The complete English configuration reference:

- config lookup and project authorization
- provider configuration and endpoint compatibility
- API-key environment variables
- Codex MCP configuration
- roles, profiles, automatic routing, and dynamic budgets
- workspace allow/deny and size limits
- cache and concurrency
- cross-project path delegation
- diagnostics and troubleshooting
- explorer requirements and limits

The README must link to this guide from both Quick Start and the configuration
overview.

### `docs/README.zh-CN.md`

A complete Chinese user guide, not a line-by-line translation burden inside
the English README. It covers:

- product positioning and responsibility boundary
- installation and Quick Start
- API-key setup
- Codex connection
- tool selection and profiles
- safety and telemetry
- links to the complete configuration guide

The Chinese guide should link to `configuration.md` for exhaustive field-level
reference while explaining that the reference is currently maintained in
English.

## CHANGELOG Structure

Rewrite `CHANGELOG.md` as a concise user-facing release history using a
Keep-a-Changelog-style structure.

Top sections:

- `0.3.0 - Unreleased`
- `0.2.1`
- `0.2.0`
- `0.1.2`
- `0.1.1`
- `0.1.0`

`0.3.0 - Unreleased` is titled around the Codex-led worker pool and highlights:

- installable early-delegation guidance
- bounded read-only workspace explorer
- OpenAI-compatible tool-calling support
- explorer routing compatibility
- exploration telemetry and compact summaries
- clarified Codex/external-worker responsibility boundary

Historical entries are compressed into `Added`, `Changed`, `Fixed`, and
`Security` sections. Internal implementation narration and rejected review
suggestions are removed unless they materially affect users.

The package version remains `0.2.1` until an explicit release task.

## Package Metadata

Improve `package.json` discovery metadata without publishing:

- Rewrite `description` around the Codex-led read-only worker pool.
- Add keywords for read-only agents, workspace exploration, model routing,
  token efficiency, and external workers.
- Include `CHANGELOG.md` and the new `docs` guides in the npm package files.

Do not change the package version or publish npm as part of this work.

## Quality Requirements

- Fix existing README syntax or consistency errors encountered during rewrite.
- Avoid exact token-savings claims.
- Clearly distinguish external provider usage from unavailable Codex
  main-model token accounting.
- Preserve the statement that external models receive authorized source
  content and are subject to their provider's data policy.
- Keep commands and config examples consistent with current behavior.
- Verify all internal documentation links.
- Run tests, typecheck, build, stdio smoke, npm pack dry-run, and diff checks.

## Success Criteria

- A new visitor understands the product and responsibility boundary before
  reaching installation instructions.
- The README is substantially shorter and easier to scan.
- Chinese users have a complete dedicated guide.
- Users can quickly find the complete configuration guide from both the README
  and Chinese guide.
- CHANGELOG accurately describes `0.3.0 - Unreleased` and prior releases.
- npm metadata reflects the current product without changing its version.
