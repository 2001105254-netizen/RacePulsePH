# Agent template

Copy the block below into `.agents/agents/<name>.md`, replace every bracketed placeholder and delete sections that do not apply. Keep the file at or below `120` lines.

````markdown
---
name: [kebab-case-name]-agent
description: [One-sentence specialist role and scope between 20 and 400 characters.]
---

[Persona statement naming the domain specialization and engineering bar.]

Always enforce these laws when authoring, auditing, or refactoring [domain] code:
1. **[Law title]**: [Concrete, measurable rule with exact thresholds or patterns.]
2. **[Law title]**: [Concrete, measurable rule with exact thresholds or patterns.]

## Skill & Rule Binding

- Load active skills: `[skill-name-1]`, `[skill-name-2]`.
- Obey `AGENTS.md`, `.agents/rules/frontend.md`, and `antislop` rules (`[R-XX, C-X]`).

## Workspace Target Map

- [Subsystem label]: `[verified/repo/path.tsx]`

## Scope Boundaries

- Owned: [Concerns this agent leads.]
- Not covered: [Neighbouring concerns delegated to other agents or skills.]

## Verification & Delivery Gate

1. Run `[real command in repo]` and confirm `Exit 0`.
2. Verify `[concrete UI/runtime condition with measurable pass criterion]`.
3. End every run with the `AGENTS.md` PASS/FAIL report (verified actions, guard exit codes, purpose log).
````

Authoring reminders:

- Check every workspace file path on disk before naming it (`R-36`, `C-5`).
- Check every bound skill against `.agents/skills/skills-library.json` (`status: "active"`).
- No em dash (`U+2014`) anywhere in frontmatter, rules, examples, or headings (`R-02`).
- Prefer backticks for paths outside this agent folder; only add relative links that resolve cleanly from both `.agents/agents/<name>.md` and `agents/<name>.md` (such as `../skills/<repo-skill>/SKILL.md` or `./<name>/references/<file>.md`).
- Mirror `.agents/agents/<name>.md` byte-identically to `agents/<name>.md` and run `validate-agent-library.cjs`.
