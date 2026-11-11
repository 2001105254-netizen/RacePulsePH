# skills-library.json schema

Location: `.agents/skills/skills-library.json`. Version 1. The validator in `scripts/validate-skill-library.cjs` enforces everything below.

## Top level

| Field | Type | Purpose |
| --- | --- | --- |
| `version` | number | Schema version. |
| `updated` | string | ISO date of the last edit. |
| `canonicalRoot` | string | Folder the agent loads skills from (`.agents/skills`). |
| `mirrorRoot` | string | Folder holding identical copies for repo skills (`skills`). |
| `namingConvention` | object | `repoPrefix` for new skills and the `description` length range. |
| `rulesSources` | string[] | Rule files that must exist. |
| `coreRules` | object | `skill`, `version`, and the rule IDs per tier. Compared to `antislop`. |
| `projectGates` | object[] | `id`, `summary`, `rule` for the AGENTS.md prohibitions. |
| `skills` | object[] | Installed skills. |
| `backlog` | object[] | Planned skills with their sources. |
| `deferredTopics` | object[] | Harvested topics that do not fit this stack, each with a reason. |
| `knownGaps` | string[] | Source material that was cut off or unreadable. |

## `skills[]` entry

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Equals the folder name and frontmatter `name`. |
| `path` | yes | `.agents/skills/<name>`. |
| `origin` | yes | `vendor` (read-only) or `repo` (editable, full checks). |
| `status` | yes | `active` or `deprecated`. |
| `category` | yes | Short topic label. |
| `description` | yes | Identical to the frontmatter description. |
| `dependsOn` | yes | Names of other registered skills. May be empty. |
| `loadWith` | no | Skills that should load alongside. |
| `rules` | yes | R-XX and C-X IDs the skill upholds. May be empty. |
| `references` | yes | Files under `references/`. May be empty. |
| `scripts` | yes | Files under `scripts/`. May be empty. |
| `mirror` | yes | Mirror path for repo skills, `null` for vendor skills. |

Checks applied only to `origin: "repo"`: `racepulse-` prefix, no U+2014 in markdown files, `SKILL.md` under 120 lines, relative links resolve, mirror is byte-identical.

## `backlog[]` entry

| Field | Notes |
| --- | --- |
| `name` | Future skill name. Must start with `racepulse-` and not collide with `skills`. |
| `status` | `planned`. |
| `priority` | `high`, `medium` or `low`. A suggestion for ordering. |
| `summary` | One line on the concern. |
| `sources` | Where the items came from. |
| `items` | Harvested item names, kept close to the source wording. |
| `stackNotes` | How the items map to Firebase, PayMongo, RFID or the existing skills. |

## Promote a backlog entry

1. Author the skill with `references/skill-template.md`.
2. Add the `skills[]` entry and delete the `backlog[]` entry.
3. Mirror the folder, then run the validator.
