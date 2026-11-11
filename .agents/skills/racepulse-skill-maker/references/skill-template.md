# Skill template

Copy the block below into `.agents/skills/<name>/SKILL.md`, replace every bracketed part, and delete sections that do not apply.

````markdown
---
name: racepulse-[topic]
description: [What the skill does in one sentence.] Use when [trigger conditions].
---

# [Title]

[One or two sentences: the single concern this skill owns and the files or systems it touches.]

Load with: [skill names, if any]. Rules upheld: [R-XX, C-X]. Detail: [reference](references/[topic].md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| [Action in the imperative] | [One line: what breaks without it] | [Command and expected exit code, file to inspect, or click path] |

## Stack mapping

- [Generic term] becomes [Firebase, PayMongo or RFID equivalent in this repo, with a real path].

## Not covered

- [Neighbouring concern] belongs to [other skill].

## Verify

1. [Command or interaction] and the result that counts as PASS.
2. Report PASS/FAIL per check with the evidence, then the purpose log.
````

Authoring reminders:

- Paths in the stack mapping must exist. Check them before writing.
- No em dash (U+2014), no invented numbers, no feature described as available when it is only planned.
- Register in `skills-library.json`, mirror to `skills/<name>/`, run the validator.
