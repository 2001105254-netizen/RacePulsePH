---
name: racepulse-feedback
description: Add consistent RacePulsePH in-app confirmations, success and error notifications, and unsaved-change handling using the shared accessible feedback components.
---

# RacePulse feedback

Use `useFeedback()` inside `FeedbackProvider` for decisions and status messages. Read [integration and interaction rules](references/integration.md) when integrating a new flow.

Decisions use an awaited confirmation with explicit action labels. Completed outcomes use a notification; errors needing correction stay visible beside the relevant form. Preserve drafts on failure or cancellation. Do not replace an existing confirmation while a decision is pending.

Reuse `src/components/ui/DialogSurface.tsx` and `FeedbackProvider.tsx`, with `src/access-ui.css`. Keep dialogs independent of constrained or transformed panels. A new UI flow should not introduce native `window.confirm` or `window.alert` prompts.

This skill governs presentation and interaction, not whether an action is authorized. Continue enforcing the actual role and server permissions.
