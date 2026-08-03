# Desktop Instructions

These rules apply to `desktop/` changes in addition to the root instructions.

- Before adding or editing anything under `desktop/src/components/`, read `desktop/src/components/AGENTS.md`. It is the authoritative index of reusable components, the placement rules for new ones, and the required style/i18n/a11y/test conventions. Do not add a component that duplicates one listed there, and do not add new files to `components/shared/` or `components/common/`.
- Reuse the existing desktop store/API patterns. Use `lucide-react` for common icons and keep operational UI dense, stable, and readable.
- Add focused Vitest or Testing Library coverage for UI, store, or API behavior. Run it first, then follow `bun run check:impact`; desktop product changes normally select `bun run check:desktop`.
- Chat transport, WebSocket lifecycle, first-turn runtime selection, reconnect, or session changes also require the offline `bun run check:chat-contract` when selected, plus `bun run check:agent-flow` for the end-to-end session/tool/permission/reconnect protocol.
- Permission dialog, tool-call rendering, or approval-flow changes should also run `bun run check:desktop-ui-smoke`: it exercises the real dialog in a real browser against the mock runtime, with no provider.
- `desktop/electron/**` is not covered by `desktop/tsconfig.json`, so `check:desktop` cannot prove it still compiles. Changing a `desktop/src/**` module that the Electron host imports selects `bun run check:native` through the import graph — run it.
- Electron host, sidecar, packaging, or version changes require `bun run check:native` when selected.
- Validate user-visible flows in a real browser/desktop session when unit tests cannot prove layout or cross-process behavior, and record the path exercised.
- `localStorage` or native settings shape changes require a migration, an old fixture, and `bun run check:persistence-upgrade`.
