---
name: racepulse-responsive-ui
description: Build or revise RacePulsePH operational screens with spacious responsive layouts, clear section navigation and reachable actions across desktop, tablet and phone.
---

# RacePulse responsive workspaces

Follow the repository's `.impeccable.md` for brand context. Preserve the charcoal/red identity, existing fonts and semantic light/dark tokens. The user prefers large, readable operational screens that use the available viewport.

For a complex editor, prefer a viewport-level workspace with a persistent identity header, section navigation, independently scrolling content and a persistent review/save footer. Use desktop side navigation and a horizontally scrollable section bar on phones. Keep simple tasks compact; do not make every confirmation full-screen.

Read [layout and verification contract](references/layout.md) when implementing or reviewing a workspace. The current reference implementation is `src/components/AccessWorkspace.tsx`, styled in `src/access-ui.css`. Reuse these patterns rather than duplicating a new design system.

Keep permission checks, dependency handling and server validation intact during presentation changes. Test with synthetic fixtures rather than modifying real user roles. UI work alone does not authorize deployments or account changes.
