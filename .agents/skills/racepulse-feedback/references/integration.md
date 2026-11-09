# Integration and interaction rules

## Decisions

Call `await confirm({ title, message, confirmLabel, cancelLabel, destructive })` before the dependent action. For unsaved access edits, use “Discard changes” and “Keep editing.” Explain what will be lost. Avoid generic OK labels.

Use a native modal dialog through the shared portal surface: accessible title and description, background inertness, contained focus, safe initial focus, Escape cancellation and focus restoration. The cancel button receives initial focus for destructive decisions. Nested confirmations must retain the editor's scroll lock after closing. Busy save operations prevent duplicate saves and accidental close.

Keep confirmation content readable on phones and short screens. Allow dialog scrolling, stack actions on phones, and retain 44px minimum touch targets. Respect reduced motion and theme tokens.

## Outcomes

Call `notify({title, message, tone})` after a successful action. Supported tones are `success`, `error` and `info`. Notifications have a dismiss button and appropriate status/alert announcements; errors persist until dismissed, while routine success/info notices expire and pause while hovered or focused. Do not put a decision that must be answered in a toast.

Save errors belong in the editor so the draft stays available for retry. Position notices clear of the application's bottom navigation and safe areas. Avoid sensitive user data in notifications.

## Verification

With synthetic data, check cancel, Escape, keyboard focus containment and restoration, repeated close requests, nested-dialog scroll lock, explicit discard, successful save, failed-save draft retention and toast dismissal. Verify mobile and desktop, light/dark themes, long messages and reduced motion. Reference preview: `tests/fixtures/access-ui.html`.
