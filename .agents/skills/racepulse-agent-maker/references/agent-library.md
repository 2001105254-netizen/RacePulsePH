# agents-library.json schema

Location: `.agents/agents/agents-library.json`. Version `1`. The read-only validator in `scripts/validate-agent-library.cjs` enforces every rule below.

## Top level

| Field | Type | Purpose |
| --- | --- | --- |
| `version` | number | Schema version (`1`). |
| `updated` | string | ISO date (`YYYY-MM-DD`) of the last registry edit. |
| `canonicalRoot` | string | Canonical workspace directory for agent specs (`.agents/agents`). |
| `mirrorRoot` | string | Mirror directory holding identical copies for repo agents (`agents`). |
| `skillsRegistry` | string | Path to the active skill registry (`.agents/skills/skills-library.json`). |
| `namingConvention` | object | `pattern`, `requiredSuffix` (`-agent`), `allowedExceptions`, `descriptionLength` (`[20, 400]`), and `maxLines` (`120`). |
| `rulesSources` | string[] | Rule files that must exist (`AGENTS.md`, `.agents/rules/frontend.md`, `.agents/skills/antislop/SKILL.md`). |
| `coreRules` | object | `skill`, `version`, `criteria`, and `tiers` (`hardGate`, `purposeGate`, `qualityLocks`) verified against live `antislop`. |
| `projectGates` | object[] | `id`, `summary`, and `rule` mirroring the `AGENTS.md` hard gates. |
| `agents` | object[] | Registered workspace agents. |
| `backlog` | object[] | Planned specialist agents not yet authored. |
| `knownGaps` | string[] | Explicit open gaps or deferred tooling notes. |

## `agents[]` entry

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Lowercase kebab-case ID ending in `-agent` (unless in `allowedExceptions`). Matches frontmatter `name`. |
| `path` | yes | `.agents/agents/<name>.md`. |
| `origin` | yes | `repo` (full lint, mirror, and link checks) or `vendor`. |
| `status` | yes | `active` or `deprecated`. |
| `role` | yes | Concise 2-5 word role title (for example, `Mobile Runner UI Architect`). |
| `description` | yes | Identical to frontmatter `description`, `20` to `400` characters. |
| `skills` | yes | Array of active skill names in `.agents/skills/skills-library.json`. |
| `dependsOnAgents` | yes | Names of other registered agents in `agents[]`. May be empty. |
| `tools` | yes | Expected tool capabilities or constraints (informational; may be empty). |
| `rules` | yes | `R-XX` and `C-X` IDs enforced by this agent. |
| `references` | yes | Optional markdown filenames under `.agents/agents/<name>/references/`. May be empty. |
| `mirror` | yes | Mirror path `agents/<name>.md` for `origin: "repo"`, or `null` for `vendor`. |

## Checks enforced on `origin: "repo"`

- File exists at `.agents/agents/<name>.md` and contains at most `120` lines.
- Zero `U+2014` em dashes across the agent file and all files in `references[]` (`R-02`).
- Every relative markdown link resolves cleanly from the file location (`R-26`, `C-2`).
- Every entry in `skills[]` exists with `status: "active"` in `.agents/skills/skills-library.json`.
- Mirror file at `agents/<name>.md` (and any mirrored `<name>/references/` files) matches canonical SHA-256 bytes.

## `backlog[]` entry

| Field | Notes |
| --- | --- |
| `name` | Future agent ID matching `namingConvention` and not colliding with `agents[]`. |
| `status` | `planned`. |
| `priority` | `high`, `medium`, or `low`. |
| `summary` | One line describing the specialist role. |
| `targetSkills` | Existing or planned skills the agent will bind. |
