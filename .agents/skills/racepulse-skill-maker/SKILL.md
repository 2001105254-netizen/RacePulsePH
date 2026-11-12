---
name: racepulse-skill-maker
description: Create, extend, register and validate RacePulsePH agent skills so they follow AGENTS.md, the frontend rule file, the antislop R-01 to R-40 rules and the skills-library.json registry. Use when adding or revising a skill, or turning a checklist or screenshot into one.
allowed-tools: Bash(node *) Read Write Edit Glob Grep
---

# RacePulse skill maker

Every skill in this repository is registered in `.agents/skills/skills-library.json` and checked by a read-only validator. Author skills through this workflow so they inherit the project rules instead of drifting from them.

Rule precedence: `AGENTS.md`, then `.agents/rules/frontend.md`, then the `antislop` core (R-01 to R-40, C-1 to C-5), then repo skills. Details and consequences for skill content: [rules and implications](references/rules-and-implications.md).

## Before writing

1. Read `skills-library.json`. Search `skills` and `backlog` for the topic. Extend an existing repo skill or promote a backlog entry instead of adding a near duplicate.
2. Treat entries with `origin: "vendor"` (the `antislop` family) as read-only. Put repo-specific additions in a `racepulse-` skill that lists the vendor skill in `dependsOn`.
3. Decide the single concern the skill owns and write down what it does not cover.

## Author

- Folder `.agents/skills/<name>/`. The name is lowercase, hyphenated, starts with `racepulse-`, and equals the frontmatter `name`.
- Frontmatter holds `name`, `description`, and `allowed-tools` only when the skill runs scripts. The description states what the skill does, then "Use when ...", in 20 to 400 characters.
- Keep `SKILL.md` under 120 lines. Move detail into `references/*.md`, one level deep, linked with relative paths.
- Write imperatives. Cite real repo paths and confirm each exists with Glob before naming it.
- Give every checklist item an action, a one-line reason (C-1) and the evidence that proves it (R-35). When a check cannot be automated, say what to inspect by hand.
- State thresholds and claims only with a source in the repo or its docs. Otherwise write "verify against current vendor docs" (R-36, C-5).
- Cite core rules as `R-XX` or `C-X`. Do not copy, renumber or reword them.
- Never use the em dash character (U+2014) in any skill text (R-02).
- Instruct agents to edit source files directly. Scripts shipped inside a skill read and report only (R-33).
- A UI-touching skill loads with the `antislop` core, follows its resolved mode, and requires design direction before building (R-37).
- A security or permission skill describes checks. It never relaxes the enforcement defined in `racepulse-access`.

Start from [skill template](references/skill-template.md).

## Harvesting from lists, screenshots or articles

1. Transcribe items verbatim with their numbers. Mark unreadable or cut-off items as gaps. Do not guess them.
2. Remove duplicates and compare against existing skills for overlap.
3. Cluster by concern. One skill holds one concern, usually 8 to 20 items.
4. Map each item to this stack: Firebase Hosting, Firestore and rules, Cloud Functions, Storage, PayMongo, the RFID bridge and station. Items that do not apply, such as Kubernetes or Helm, go to `deferredTopics` with a reason.
5. Turn each kept item into a check: action, reason, evidence.
6. Record the cluster in `backlog` with its sources, then author it as a skill when promoted.

## Register and mirror

1. Add or update the entry in `skills-library.json`. Field rules: [library schema](references/skill-library.md). Copy the `description` text exactly from the frontmatter.
2. Remove the matching `backlog` entry when a skill is promoted.
3. Copy the whole skill folder to `skills/<name>/` so both trees stay identical, and set `mirror` to that path.

## Validate and deliver

Run from the repository root:

```
node .agents/skills/racepulse-skill-maker/scripts/validate-skill-library.cjs
```

Exit `0` is clean, `1` means a check failed, `2` means a usage or registry load error. Add `--json` for machine output. Fix failures and re-run until the exit code is `0`.

Deliver with a PASS/FAIL report:

- **Interactive verification:** every link opened, every documented command run once, results listed.
- **CLI/AST guard contract:** validator exit code.
- **Purpose log:** one line of functional justification for each section and structural choice.
