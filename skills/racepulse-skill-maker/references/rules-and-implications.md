# Rules and implications for skill authors

The machine-readable copy of this map lives in `skills-library.json` under `rulesSources`, `coreRules` and `projectGates`. The validator compares it against `antislop/SKILL.md` and `antislop/VERSION`, so update the JSON when the core changes.

## Sources and precedence

| Order | Source | Role |
| --- | --- | --- |
| 1 | `AGENTS.md` | User rules. Always apply. Defines C-1 to C-5, typography, spacing, color, motion, prohibitions, the 4-stage text audit and the delivery gate. |
| 2 | `.agents/rules/frontend.md` | Expanded frontend rule with concrete Tailwind tokens and the gate report format. |
| 3 | `.agents/skills/antislop/SKILL.md` | Core filter. R-01 to R-40 in three tiers, plus the Delivery Gate. Sibling skills add depth and cite rules by number. |
| 4 | Repo skills (`racepulse-*`) | Project concerns: access, feedback, responsive layout, skill authoring. |

## Rule tiers

| Tier | Meaning | Rule IDs |
| --- | --- | --- |
| Hard Gate | Absolute. A violation is a FAIL. | R-02, R-03, R-17, R-18, R-23, R-24, R-25, R-26, R-27, R-28, R-32, R-33, R-34, R-35, R-36, R-37, R-38, R-39, R-40 |
| Purpose-Gate | Allowed with a written reason. | R-01, R-04, R-06, R-07, R-08, R-09, R-10, R-12, R-13, R-14, R-19, R-22 |
| Quality Locks | Consistency across the product. | R-05, R-11, R-15, R-16, R-20, R-21, R-29, R-30, R-31 |

Craftsmanship criteria: C-1 Intentionality, C-2 Functional Completeness, C-3 Content-Driven Composition, C-4 Resilience, C-5 Evidence Over Claims.

## What each rule means for a skill

| Rule | Implication when writing a skill |
| --- | --- |
| R-02 em dash | No U+2014 anywhere in skill prose, templates or examples. Skill text is often copied into UI copy. Describe the character by name when you must mention it. |
| R-33 no patching scripts | Skills tell agents to edit source directly. A bundled script may validate, audit or report. It must not rewrite source or CSS with string replacement. |
| R-35 verify before delivery | Every skill ends in a verification step with observable evidence: a command and its exit code, or a click path. |
| R-36 and C-5 no fabricated claims | No invented benchmarks, percentages, limits or compliance statements. Cite a repo file or official doc, or mark the value "verify against current vendor docs". |
| R-26, C-2 no dead controls | Applies to skills as well: no link to a missing file, no command that cannot run, no checklist item without a way to check it. The validator resolves links. |
| R-31, C-1 reasons | Each checklist item carries a one-line reason. |
| R-37, R-23 | UI skills require design direction first and ask before creating visual assets. They do not skip these steps because another workflow leads. |
| R-27 UI states | A skill that covers a flow lists empty, loading, error and success states. |
| R-03, R-32, R-25, R-39 | A UI skill does not duplicate responsive, keyboard or contrast rules. It loads `antislop-layoutmobile` and `antislop-human` and cites the rule. |
| Typography, spacing, OKLCH, motion | Cited from `AGENTS.md` and `frontend.md`. Never restated with different numbers. |
| Deslopification | Skill prose passes the 4-stage text audit: no magic adverbs, no pompous vocabulary, no negative parallelism, active verbs, varied sentence length. |
| antislop mode | `during` or `after` is resolved once by the core. Skills reuse it and never ask again. |
| Delivery Gate | A skill's own wrap-up does not replace the PASS/FAIL report. Work is not done without it. |

## Implications for registry decisions

- A new skill that restates a core rule is a duplicate. Extend the core's sibling skill or cite the rule.
- A vendor skill edit is lost on the next antislop update. Put local changes in a `racepulse-` skill.
- Security and launch checklists are advisory for design review and never grant or widen access. Enforcement stays in `racepulse-access` and the Firestore, Storage and Functions rules.
- Platform translation is part of authoring. A generic term such as "row-level security" becomes the Firebase equivalent (Firestore and Storage rules, App Check, Functions authorization) before it enters a skill.
- Backlog entries are plans, not capabilities. Do not describe a planned skill as available.
