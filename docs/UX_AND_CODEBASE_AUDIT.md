# Kora UX and Codebase Improvement Audit

> Scope: static review of the React/TypeScript client, Cloudflare Worker, local server, PWA/Capacitor setup, game components, and documentation. This is a prioritized engineering backlog, not a claim that every item has been reproduced in a live browser. Network-dependent behavior, Android playback, Firestore rules, and multiplayer synchronization still require hands-on testing.

## Executive summary

Kora covers ebooks, PDF conversion, a local library, discovery, audiobooks, news, comics/manga, plugins, sync/transfer, and several games. The highest-return work is to make core flows predictable, establish shared UI/theme primitives, separate large feature components into testable modules, and add repeatable regression tests for network and game state.

### Priority key

- **P0 — release blocker:** broken flow, data-integrity risk, or CI failure.
- **P1 — high:** frequently used flow or major reliability/accessibility issue.
- **P2 — medium:** consistency, maintainability, or polish improvement.
- **P3 — later:** optional capability or advanced enhancement.

---

# Part I — UX and product improvements

## A. Global navigation and design system

1. **P1 — One shared design-token contract.** Route game surfaces, modals, menus, buttons, borders, focus rings, and muted text through active theme tokens. Keep semantic colors only when they communicate game rules.
2. **P1 — Standardize modal behavior.** Full-screen panels should support Escape/back, visible close controls, safe-area insets, predictable scroll locking, and focus restoration.
3. **P1 — Consistent mobile tap targets.** Aim for comfortable 44–48 CSS-pixel controls, especially close buttons, audio controls, rack tiles, chess squares, and card actions.
4. **P1 — Loading, empty, error, and retry states.** Avoid blank content regions when an upstream catalog, feed, or media host is unavailable.
5. **P1 — Shared notification vocabulary.** Distinguish success, progress, warning, and recoverable failure; avoid duplicating errors in toast, modal, and console.
6. **P1 — Respect reduced motion.** Simplify card fly-ins, pulsing hints, page transitions, and animated loading when reduced motion is requested.
7. **P1 — Keyboard access.** Consistent focus styles, tab order, Escape behavior, and arrow-key navigation for grids.
8. **P2 — Appearance preview.** Preview theme, accent, font, contrast, and spacing before applying changes.
9. **P2 — Shared button variants.** Replace one-off class combinations with primary, secondary, quiet, danger, icon, and loading variants.
10. **P2 — Shared card, dialog, empty-state, and skeleton components.** Reduce visual drift between Discover, library, news, and games.
11. **P2 — Typography hierarchy.** Document a scale for titles, section headings, metadata, labels, and helper text.
12. **P2 — Audit themes separately.** Check muted text, disabled controls, overlays, selection rings, board squares, and modal backdrops in every theme.
13. **P2 — Reusable safe-area spacing.** Keep status bar, bottom navigation, keyboard, mini-player, and gesture areas from covering controls.
14. **P2 — Compact-density option.** Useful for large libraries and desktop screens.
15. **P3 — Visual regression gallery.** Show shared components under every installed theme.

## B. Discover and book details

16. **P0 — One book-detail entry point.** Search results, featured lists, categories, recommendations, and shared links should normalize to the same detail model and panel.
17. **P1 — Preserve query text.** Suggestions must never silently replace typed text; only an explicit selection should use a suggested title.
18. **P1 — Debounce and cancel suggestions.** Ignore old responses so a slow request cannot show stale recommendations.
19. **P1 — Touch-safe suggestions.** A suggestion should still work when the input blurs; support Escape and keyboard navigation.
20. **P1 — Predictable search history.** Clearly define whether history is session-only or persisted; offer clear-history and bounded retention.
21. **P1 — Normalize book identity.** Prefer provider IDs and ISBNs, then normalized title/author; do not merge different editions just because titles match.
22. **P1 — Explain metadata provenance.** Label catalog metadata where ratings, descriptions, or covers conflict.
23. **P1 — Distinguish metadata from availability.** A catalog record does not guarantee a downloadable file exists.
24. **P1 — No-results recovery.** Offer spelling correction, title-only search, author-only search, and retry when a source is down.
25. **P1 — Explain grouped editions.** Expose format and edition details instead of hiding meaningful differences.
26. **P2 — Add useful filters.** Author, language, format, year, rating, and availability when source data supports them.
27. **P2 — Selected-book loading state.** Prevent the detail panel from flashing stale metadata during enrichment.
28. **P2 — Source-specific errors.** Distinguish timeout, quota/rate limit, unsupported result, and temporary network failure.
29. **P2 — Cover fallbacks.** Use a consistent placeholder and avoid layout shifts.
30. **P2 — Shareable detail panels.** Use stable IDs when available and title/author as fallback.
31. **P2 — Search keyboard controls.** Up/down, Enter, and Escape without breaking normal text editing.
32. **P3 — Opt-in personalized recommendations.** Keep recommendation logic transparent and reading history local unless users consent.

## C. Download reliability and progress

33. **P0 — Validate before importing.** Reject HTML error pages, zero-byte files, invalid signatures, and known title mismatches before success.
34. **P0 — Never combine bytes from different mirrors.** Clear partial bytes and resume metadata after switching upstream sources.
35. **P1 — Truthful progress.** If content length is unknown, show indeterminate progress rather than a fabricated percentage.
36. **P1 — Name the active stage.** Use resolving, connecting, downloading, verifying, saving, and completed.
37. **P1 — Keep retry visible.** Retry a failed source or choose another result without losing the selected book.
38. **P1 — Separate network and storage failures.** An HTTP response can still fail validation or IndexedDB persistence.
39. **P1 — Add cancellation.** Abort requests and prevent stale callbacks changing a closed dialog.
40. **P1 — Correct resume rules.** Resume only when range requests and validators support it; otherwise restart cleanly.
41. **P1 — Bound concurrency.** Avoid exhausting device memory with multiple large downloads.
42. **P2 — Show actual format and size.** Use headers and file signatures rather than trusting catalog labels alone.
43. **P2 — Download history.** Show completed, failed, cancelled, and pending items with retry/remove controls.
44. **P2 — Storage visibility.** Explain local storage usage and offer safe cache removal.
45. **P2 — Structured diagnostics.** Record stage, source ID, HTTP status, duration, and correlation ID without secrets.
46. **P3 — Sanitized diagnostic export.** Copy useful reports without tokens, personal IDs, or private library content.

## D. Reading, library, and PDF conversion

47. **P1 — Robust reading progress.** Use stable book IDs and prevent duplicate tabs overwriting newer progress.
48. **P1 — Explain PDF-to-EPUB limitations.** Scanned PDFs need OCR; tables, images, footnotes, and layout may not survive reflow.
49. **P1 — Validate converted EPUB metadata and navigation.** Check title, author, language, and package structure before import.
50. **P1 — Actionable conversion failures.** Separate invalid PDF, encrypted file, page limit, no selectable text, and storage/build failures.
51. **P1 — Touch annotation testing.** Long-press selection, dictionary lookup, highlights, and scrolling must not fight each other.
52. **P2 — Annotation management.** Search, filter, edit, export, and jump to the original location.
53. **P2 — Library filters and sorting.** Reading status, recently added, author, title, format, and last-opened.
54. **P2 — Explain local versus synced data.** Say whether file bytes, metadata, or reading progress are stored or synced.
55. **P2 — Safe bulk actions.** Multi-select, export, delete, and tag with clear deletion confirmation.
56. **P2 — Storage quota warning.** Warn before a large import exceeds browser storage.
57. **P3 — Optional OCR pipeline.** Keep OCR separate from selectable-text extraction and explain its cost.

## E. Audiobook player

58. **P0 — Race-safe chapter switching.** A slow URL lookup or play promise from an old chapter must not replace the newest selection.
59. **P1 — Test autoplay failures.** Browser gesture policy, Android WebView decode, CORS, and expired URLs need recovery paths.
60. **P1 — One playback state model.** Keep play/pause, loading, buffering, errors, current chapter, and mini-player synchronized.
61. **P1 — Test rapid chapter taps.** The last selected chapter should win and loading must not get stuck.
62. **P1 — Deliberate progress persistence.** Debounce updates, save on pause/track change/unmount, and avoid remote writes every playback tick.
63. **P1 — Clear sleep timer.** Show remaining time, allow cancel/extend, and stop playback when the mini-player is collapsed.
64. **P1 — Reversible smart skip.** Indicate intro/outro skips and offer quick undo.
65. **P2 — Separate buffering from chapter resolution.**
66. **P2 — Better queue navigation.** Show chapter count, next/previous actions, and unavailable chapters.
67. **P2 — Test TTS voice changes.** Voice, speed, language, and chapter reload should preserve the expected position.
68. **P2 — Adaptive mini-player.** Do not cover bottom navigation or controls when the keyboard is open.
69. **P2 — Safe playback diagnostics.** Copy a useful explanation for track resolution or decode failure.
70. **P3 — Chapter bookmarks and sleep presets.**

## F. Chess, Scrabble, Uno, and word puzzles

71. **P0 — Deterministic CPU tests.** Verify chess responds after legal moves and Scrabble CPU never corrupts the board.
72. **P0 — Test lifecycle.** Open, start, restart, change mode, close mid-turn, and reopen without stale timers/listeners.
73. **P1 — Theme every game surface.** Board, menus, room cards, dialogs, controls, muted labels, and game-over screens should follow the chosen theme.
74. **P1 — Preserve semantic game colors.** Chess highlights and Scrabble premium squares can remain distinct, but contrast must be checked in all themes.
75. **P1 — Chess move feedback.** Distinguish legal moves, captures, check, last move, selection, and promotion without color alone.
76. **P1 — Explicit chess promotion UI.** Make queen/rook/bishop/knight choice accessible to keyboard and touch.
77. **P1 — Harden chess rules.** Test castling, en passant, promotion, checkmate, stalemate, and self-check.
78. **P1 — Stable CPU scheduling.** AI timers must not cancel themselves because transient thinking state changes.
79. **P1 — Useful Scrabble validation.** Explain disconnected words, off-axis placement, overlap conflicts, and dictionary rejection.
80. **P1 — Immutable Scrabble rack/board state.** Avoid mutating player tile arrays in place.
81. **P1 — Correct Scrabble scoring.** Score repeated letters and premium squares by tile coordinate, not letter equality.
82. **P1 — Cancel stale Scrabble CPU callbacks.** Restart/close must invalidate delayed moves.
83. **P1 — Guard multiplayer writes.** Validate turn ownership and handle reconnect/conflict cases.
84. **P2 — First-turn tutorials.** Explain tap, drag, undo, submit, pass, and scoring.
85. **P2 — Accessible Uno cards.** Pair color with symbols/labels and consider color-vision-friendly options.
86. **P2 — Clear Uno action feedback.** Show active player, playable cards, draw requirements, and disabled-action reasons.
87. **P2 — Scrabble score preview.** Explain premium-square contributions before submission.
88. **P2 — Confirm destructive actions.** Restart, leave room, resign, and clear board should be intentional.
89. **P2 — Robust room joining.** Validate room codes and show waiting/connected/disconnected state with retry.
90. **P2 — Per-game sound shortcut.** Respect global sound settings and provide quick mute.
91. **P2 — Puzzle input semantics.** Crossword should show selected/across/down state; Word Search should support drag and tap on touch.
92. **P3 — Difficulty levels.** Make CPU behavior testable and predictable.
93. **P3 — Optional game statistics.** Wins, losses, streaks, and play time stored locally with reset/export.

## G. News, comics, and content

94. **P1 — Feed health and retry.** Identify a failed feed while preserving successful feeds.
95. **P1 — Cancellable manga preloading.** Avoid wasted requests after chapter change or reader close.
96. **P1 — Media fallbacks.** Broken covers, chapter pages, and audio streams should preserve layout and provide retry.
97. **P2 — Reading/listening handoff.** Offer continue-reading/listening with the last saved position.
98. **P2 — Explicit offline status.** Distinguish stored locally, cached, online-only, and not downloaded.
99. **P2 — Explain plugin permissions.** Describe what an installed source can access and how to disable/remove it.
100. **P3 — Optional local activity timeline.** Recent reading, downloads, and listening.

---

# Part II — Codebase and engineering improvements

## A. Component architecture

1. **P0 — Keep type-check green.** The Android workflow exposed duplicate recent-search state declarations in DiscoverView. The duplicate state was consolidated; the latest CI run must confirm the fix.
2. **P1 — Split DiscoverView.** At review time it was roughly 239 KB and combined search, categories, audiobook discovery, details, downloads, and rendering. Extract hooks and view components incrementally.
3. **P1 — Split OnlineScrabbleGame.** Separate pure rules, CPU strategy, state reducer, multiplayer adapter, and presentation.
4. **P1 — Split ChessGame.** Separate rules, move generation, evaluation/search, game controller, and board components.
5. **P1 — Move Uno rules into a pure engine.** Keep renderer and room transport independent of deck/turn/action-card rules.
6. **P1 — Define typed feature contracts.** Book details, downloads, game state, media tracks, and source adapters should use interfaces instead of broad any values.
7. **P1 — Shared modal controller.** Centralize Escape, focus restoration, scroll locking, and close confirmation.
8. **P1 — Shared theme API.** Make active tokens explicit and remove hard-coded surfaces from feature components.
9. **P2 — Reducers/state machines for complex flows.** Download progress, audio loading, and multiplayer turns have multiple stages.
10. **P2 — Separate view rendering from fetching.**
11. **P2 — Normalize the book view model.** Convert Google Books, Open Library, feeds, plugins, and local library records at boundaries.
12. **P2 — Error boundaries by feature.** A failed game or reader should not crash the whole app.
13. **P2 — File-size and naming guidelines.** Decompose components that combine several responsibilities.
14. **P3 — Lazy-load large feature routes.** PDF conversion, comics, games, and advanced discovery are candidates.

## B. Async correctness and data integrity

15. **P0 — Use request generations or AbortController consistently.** Ignore stale discovery, metadata, audio, image, and download results.
16. **P0 — Validate external payloads at runtime.** TypeScript does not validate third-party JSON.
17. **P0 — Do not trust upstream headers alone.** Validate signatures/container structure and compare metadata before import.
18. **P1 — Stage-aware progress.** Do not show completion before validation and persistence succeed.
19. **P1 — Transactional IndexedDB operations where required.** Avoid partial records when metadata and bytes must be saved together.
20. **P1 — Idempotent imports.** Re-importing should not duplicate books or unexpectedly reset progress.
21. **P1 — Avoid stale closure writes.** Use functional state updates or reducers for logs, racks, and track state.
22. **P1 — Cancel timers/listeners.** CPU turns, audio, preloading, and Firestore listeners must be disposed on close/restart/unmount.
23. **P1 — Debounce high-frequency persistence.**
24. **P1 — Central retry policy.** Bound attempts, back off on transient failures, and do not retry validation failures forever.
25. **P2 — Consistent timeouts.**
26. **P2 — Correlation IDs.** Link client errors to Worker logs without exposing secrets.
27. **P2 — Separate cached from authoritative state.**
28. **P2 — Multi-tab/device conflict handling.**

## C. Worker and server

29. **P0 — Test Worker/local-server route contracts together.** The Worker and local server are separate entry points; route parity cannot be assumed.
30. **P1 — Shared security helpers.** URL validation, proxy restrictions, MIME checks, and response normalization should not drift.
31. **P1 — Harden proxy boundaries.** Restrict schemes/destinations, reject private/local targets, limit redirects, cap response sizes, and prevent open-proxy abuse.
32. **P1 — Upstream response-size limits.**
33. **P1 — Validated cache keys.** Include result-changing parameters and avoid public caching of user-specific data.
34. **P1 — Consistent timeout budgets.**
35. **P1 — Isolate source parsing.** An upstream HTML change should fail one adapter, not the whole search pipeline.
36. **P2 — Document every Worker route.** Method, schema, auth, cache policy, limits, and failures.
37. **P2 — Structured/redacted logs.** Record source, stage, status, latency, and request ID.
38. **P2 — Cache hit/miss metrics.**
39. **P2 — Keep secrets server-side.** Ensure deployment docs and Worker configuration remain aligned.
40. **P3 — Circuit breaker for unstable upstreams.**

## D. Tests and CI

41. **P0 — Run lint and build on the latest revision.** Do not call a revision verified until the newest workflow passes.
42. **P1 — Unit tests for pure modules.** Prioritize Scrabble queue, chess move generation, Uno rules, PDF conversion helpers, book normalization, and download validation.
43. **P1 — Regression test every reported bug.**
44. **P1 — Browser smoke tests.** Verify startup, navigation, dialogs, theme switching, Discover details, and no uncaught console errors.
45. **P1 — Game interaction tests.** Chess move/CPU response; Scrabble placement/undo/submit/CPU; Uno legal and illegal actions.
46. **P1 — Audiobook race tests.** Slow URL lookup, rapid switching, rejected play, media errors, unmount, and stale callbacks.
47. **P1 — Mock network dependencies.** Avoid live Google Books, RSS, Firebase, or file hosts in deterministic tests.
48. **P1 — Download fixtures.** Valid EPUB/PDF/ZIP, HTML error page with wrong MIME, zero-byte, corrupt archive, wrong-title result, interrupted stream.
49. **P2 — Theme snapshots.** Include light, dark, black, and custom themes.
50. **P2 — Android WebView smoke tests.** Safe areas, back button, audio, downloads, keyboard, and native/browser storage.
51. **P2 — Test deployment artifacts separately.** Worker, web bundle, APK, and version metadata.
52. **P2 — Run type-check before Android SDK setup.** Fail early and save CI time.
53. **P2 — Cache dependencies in CI.**
54. **P2 — Separate lint, unit, web build, and APK jobs.**
55. **P3 — Scheduled dependency/security checks.**

## E. Performance, accessibility, and maintainability

56. **P1 — Profile Discover rendering.** Virtualize long lists and memoize expensive derivations only when profiling supports it.
57. **P1 — Limit concurrent media/image requests.**
58. **P1 — Audit resource ownership.** Revoke object URLs, destroy PDF/audio/TTS objects, clear timers, and dispose listeners.
59. **P1 — WCAG contrast checks.** Test all installed themes, not only the default.
60. **P2 — Bundle-size budgets.** PDF, EPUB, media, and games are heavy domains; split and measure.
61. **P2 — Virtualize large library/history lists.**
62. **P2 — Reduce any types gradually.** Start at network boundaries and game transitions.
63. **P2 — Document invariants for tricky rules.**
64. **P2 — Standardize logging with production redaction.**
65. **P2 — Semantic HTML and accessible labels.**
66. **P2 — Actionable user-facing errors.** Do not show raw upstream HTML, stack traces, or internal endpoint details.
67. **P3 — Dependency ownership map.**
68. **P3 — Dead-code and stale-route checks.**

---

# Part III — Recommended implementation order

## Release-blocker sequence

1. Fix type-check failures and keep the latest CI green.
2. Verify one shared Discover detail handler for search, categories, featured books, and shared links.
3. Test recommendations on mouse, touch, and keyboard without silently replacing query text.
4. Test audiobook chapter-switch races, play rejection, and unmount cleanup.
5. Test chess CPU responses for both player colors and several consecutive moves.
6. Test Scrabble CPU turns, repeated-letter scoring, pass/exchange, restart, and close.
7. Confirm every game follows light, dark, and custom themes.
8. Run web build and Android APK pipeline, then manually smoke-test a real Android device.

## Next iteration

9. Extract shared theme-aware buttons, dialogs, empty states, and loading states.
10. Extract pure game engines and write deterministic tests.
11. Add download fixture tests and cancellation/resume coverage.
12. Split Discover into hooks and smaller components.
13. Add browser smoke tests and visual theme snapshots.
14. Add structured diagnostic export and upstream health reporting.
15. Use profiling data to prioritize performance work.

## Verification checklist

- [ ] npm run lint
- [ ] npm run build
- [ ] Existing regression scripts
- [ ] Search results and categories open the same complete detail panel
- [ ] Recommendation text does not overwrite the query without user action
- [ ] Rapid audiobook chapter changes settle on the latest selection
- [ ] Chess CPU responds after legal moves for White and Black
- [ ] Scrabble CPU moves and scores repeated letters correctly
- [ ] Uno, Scrabble, chess, Crossword, and Word Search follow selected themes
- [ ] Light/dark/custom contrast and keyboard focus checked
- [ ] Android safe areas, back navigation, audio, and touch gestures checked
- [ ] External-service outages show useful retry states

## Review limitations

This is a static repository review supplemented by GitHub Actions output. It cannot establish that the production app works on a particular device or that third-party services are currently available. The audit separates code observations and priorities from behavior that still needs to be reproduced.
