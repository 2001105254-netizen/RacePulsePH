# Rules and implications for agent authors

The machine-readable copy of this map lives in `.agents/agents/agents-library.json` under `rulesSources`, `coreRules`, and `projectGates`. `scripts/validate-agent-library.cjs` verifies it against `.agents/skills/antislop/SKILL.md`, `antislop/VERSION`, and `.agents/skills/skills-library.json`.

## Precedence order

| Priority | Source | Authority |
| --- | --- | --- |
| 1 | `AGENTS.md` | Top-level workspace rules: `C-1` to `C-5`, 4-size/2-weight typography, 4px/8px spacing, OKLCH 60/30/10 color, `< 300ms` GPU motion, hard prohibitions, 4-stage text audit, and PASS/FAIL delivery gate. |
| 2 | `.agents/rules/frontend.md` | Concrete Tailwind v4 token classes (`--surface-page`, `--surface-card`, `--border-default`) and interactive proof report requirements. |
| 3 | `.agents/skills/antislop/SKILL.md` | Core filter rules `R-01` to `R-40` across Hard Gate (19), Purpose-Gate (12), and Quality Locks (9). |
| 4 | `.agents/skills/*` | Domain procedures (`racepulse-*` and specialized vendor/repo skills in `skills-library.json`). |
| 5 | `.agents/agents/*.md` | Specialist role personas that orchestrate skills and domain laws for targeted tasks without overriding tiers 1 to 3. |

## What each rule implies when writing an agent

| Rule | Implication for `.agents/agents/<name>.md` |
| --- | --- |
| `R-02` no em dash | Zero `U+2014` characters in frontmatter, role description, numbered laws, tables, or references. Describe the character by name (`U+2014`) if ever referenced. |
| `R-03`, `R-25`, `R-32`, `R-39` | Never duplicate `antislop` core tables inside an agent file. Bind active skills (`antislop`, `antislop-layoutmobile`, `antislop-human`, domain skills) in `agents-library.json` and state only role-specific operational laws. |
| `R-26`, `C-2` no dead controls | Every relative link in an agent markdown file must resolve on disk in both `.agents/agents/` and the `agents/` mirror. Every stated verification step must be runnable. |
| `R-27` UI state coverage | UI specialist agents must require complete state coverage (loading skeletons, empty states, offline/error banners, keyboard/IME reflow, interactive states). |
| `R-31`, `C-1` reasons | Non-obvious architectural mandates must carry concise intent and stay verifiable. |
| `R-33` no patching scripts | Agents modify real source files directly; helper scripts in skills/agents stay strictly read-only validators or auditors. |
| `R-35` delivery gate | Agent instructions must end in measurable verification (lint/build exit codes, Playwright viewport assertions, validator exit `0`) plus the `AGENTS.md` PASS/FAIL report. |
| `R-36`, `C-5` evidence over claims | Verify every file path (`src/components/...`, `.agents/skills/...`), token name, and metric threshold cited in an agent spec before committing it. |

## Agent vs Skill split

- Use a **skill** (`.agents/skills/`) for a single repeatable workflow, checklist, or script-backed gate (registered via `racepulse-skill-maker`).
- Use an **agent** (`.agents/agents/`) for a cross-cutting specialist persona that binds multiple skills, applies domain invariants across an entire subsystem (for example, mobile Runner UI or RFID timing diagnostics), and enforces scoped verification.
- Never register a duplicate agent name that collides with an existing skill directory in `skills-library.json`.
