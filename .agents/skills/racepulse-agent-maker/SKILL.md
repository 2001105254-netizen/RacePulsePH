---
name: racepulse-agent-maker
description: Create, extend, register and validate RacePulsePH workspace specialist agents so they follow AGENTS.md, the frontend rule file, the antislop R-01 to R-40 rules and the agents-library.json registry. Use when adding or revising a custom agent role or persona.
---

# RacePulse agent maker

Author, register and validate RacePulsePH workspace specialist agents so every persona binds verified skills, obeys `AGENTS.md`, `.agents/rules/frontend.md`, `antislop` `R-01` to `R-40` and `.agents/agents/agents-library.json`.

Load with: `antislop`. Related: `racepulse-skill-maker`. Rules upheld: `C-1`, `C-2`, `C-5`, `R-02`, `R-26`, `R-31`, `R-33`, `R-35`, `R-36`.

Start by reading [rules and implications](references/rules-and-implications.md) and the registry schema in [agent library](references/agent-library.md).

## Core idea

A workspace agent sits downstream of `AGENTS.md`, `.agents/rules/frontend.md`, `antislop` and `.agents/skills/`. It sets a single specialist role, binds the repo skills it must enforce, names its scope boundaries and declares a checkable delivery gate.

- Author once in `.agents/agents/<name>.md` and mirror byte-identically to `agents/<name>.md`.
- Keep agent prompts focused and under `120` lines; move longer reference notes into `.agents/agents/<name>/references/`.
- Bind registered active skills from `.agents/skills/skills-library.json` instead of duplicating rule walls inside agent prompts (`R-03`, `R-31`).
- Never invent file paths, commands, metrics, or verification outcomes (`R-36`, `C-5`).
- Ship only read-only validators; never mutate source files via patch scripts (`R-33`).

## Authoring workflow

1. Check `.agents/agents/agents-library.json` and `.agents/skills/skills-library.json` so the new role does not duplicate an existing agent or skill.
2. Pick a lowercase kebab-case name ending in `-agent` (unless covered by `namingConvention.allowedExceptions`) that does not collide with any skill name.
3. Draft `.agents/agents/<name>.md` from [agent template](references/agent-template.md) with matching `name` and `description` (`20` to `400` characters).
4. Verify every repo file path and skill name cited in the agent body exists on disk and in `skills-library.json` (`R-26`, `R-36`).
5. Strip em dash characters (`U+2014`) (`R-02`), generic tropes and uncheckable claims.
6. Register the agent under `agents[]` in `.agents/agents/agents-library.json` (and remove any promoted `backlog[]` entry).
7. Mirror `.agents/agents/<name>.md` (and any `<name>/references/` files) identically to `agents/<name>.md`.
8. Run [validate-agent-library.cjs](scripts/validate-agent-library.cjs) (`--strict`) and iterate until it reports zero failures, zero warnings and `Exit 0` (`R-35`).

## Verification contract

Run the read-only validator from the repository root:

```text
node .agents/skills/racepulse-agent-maker/scripts/validate-agent-library.cjs
node .agents/skills/racepulse-agent-maker/scripts/validate-agent-library.cjs --strict
```

Exit codes: `0` pass, `1` fail (or warning with `--strict`), `2` bad arguments. When changing this skill itself, also run `node .agents/skills/racepulse-skill-maker/scripts/validate-skill-library.cjs` (`Exit 0`).

## Report format

End work with the `AGENTS.md` PASS/FAIL report covering interactive or workflow checks, guard exit codes and a one-line purpose log for every architectural choice.
