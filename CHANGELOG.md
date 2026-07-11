# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/) — while
in `0.x`, minor version bumps may include breaking changes.

## [0.16.1]

### Documentation
- Verified and documented that `verifyClickable` works correctly with
  dropdown menus (via `chooseOption()` or two plain `click()` calls) — a
  menu's own option is naturally the topmost element at its position once
  the menu is open. This includes the common "click outside to close"
  pattern many component libraries use (a transparent full-page overlay
  that appears alongside the menu to detect outside clicks): as long as it
  sits behind the menu itself, which it needs to for the menu to be
  clickable at all, it's never mistaken for an obstruction. Added 2 new
  real-browser tests covering a plain dropdown and one with that overlay
  pattern present. No code change — this confirms already-correct
  behavior.

## [0.16.0] — Modal/overlay obstruction detection

### Added
- `verifyClickable` option (default `false`) — before every click, confirms
  the target is actually the topmost element at its own position, the way
  a real mouse click would effectively require. Because this library
  dispatches events straight to a resolved element instead of going
  through the browser's normal hit-testing at a screen position, it can
  otherwise click "through" something a real mouse never could — most
  commonly a modal dialog's backdrop that's still covering the page behind
  it (e.g. a previous step's close button didn't actually work, or
  something it was waiting on never resolved). With this on, such a click
  throws a clear error naming what's covering the target instead of
  silently reaching past it. Uses `document.elementsFromPoint()` (with a
  same-origin-iframe-aware document lookup, so it works correctly for
  iframe-scoped targets too), and correctly excludes this library's own
  overlay elements (cursor, ripple, highlight boxes, page glow, its
  blocker) from ever counting as an obstruction, as well as anything
  nested inside the target itself (an icon or text node inside a button
  isn't "covering" it).
- 5 new real-browser tests: the risk demonstrated without the option (click
  goes through the modal backdrop silently), the fix throwing a clear
  error instead, the click succeeding normally once the modal is genuinely
  closed, no false positive for an icon nested inside the target, and no
  false positive against this library's own glow/blocker overlay when both
  are active together.

## [0.15.0] — Fuller click event simulation

### Fixed
- The default `onExecuteClick` only ever called `el.click()`, which
  dispatches nothing but a `click` event (plus native activation behavior
  like link navigation or form submission) — it does NOT simulate
  `mousedown`/`mouseup`/`pointerdown`/`pointerup` at all. Plenty of
  real-world UI (dropdown menus, tab switches, admin dashboard frameworks
  like AceAdmin) binds its actual behavior to `mousedown` instead of
  `click`, for snappier interaction, and would silently never respond to
  a bare `.click()` call — the cursor animation would play correctly (since
  that's independent of what the target element actually does), but
  nothing would happen. The default now dispatches the fuller
  `pointerdown → mousedown → pointerup → mouseup → click` sequence,
  covering both cases. Verified with a controlled comparison (a handler
  bound only to `mousedown` genuinely never fires from plain `el.click()`,
  confirmed fixed with the new sequence) and a new permanent test.
- Documented a related, separate, and unfixable limitation discovered
  while investigating this: every event this library dispatches is
  `isTrusted: false` (no page-level JavaScript can produce a trusted
  event — this is a deliberate browser security boundary). Most sites
  don't check `event.isTrusted` and are unaffected, but a few — often ones
  with deliberate anti-automation logic on a specific sensitive action —
  explicitly gate behavior behind it and will silently ignore any
  synthetic click no matter how it's dispatched. If a click's animation
  plays but nothing happens, and the mousedown fix above doesn't explain
  it, this is worth ruling out; there is no workaround from page-level
  JavaScript.

## [0.14.0] — Automatic iframe-reload detection

### Added
- `autoWaitForIframeReload` option (default `false`) — when on, every
  `click()` (and anything built on the same internal click helper:
  `check()`, `chooseOption()`) briefly watches every same-origin iframe on
  the page for any of them starting to reload, regardless of which iframe
  or whether the triggering click was inside or outside it, and waits for
  it to finish before the next step runs. This is the fully automatic
  counterpart to `waitForFrameReload()` — for situations where inserting
  an explicit wait step isn't practical, most notably running someone
  else's recorded steps or steps pasted into a tool like
  [page-pilot-toolkit](https://github.com/jyy1082/page-pilot-toolkit),
  where there's no opportunity to hand-edit the step sequence.
  `autoIframeReloadGrace` (default 400ms) controls how long it watches for
  a reload to start before assuming nothing changed and proceeding
  immediately (so unrelated clicks pay no meaningful latency);
  `autoIframeReloadMaxWait` (default 4000ms) bounds how long it waits for
  a detected reload to actually finish. Off by default so existing
  behavior never changes without opting in.
- 4 new real-browser tests: the exact race resolved automatically with
  zero manual wait steps (trigger both inside and outside the iframe),
  confirmation it's opt-in (default behavior unchanged), and confirmation
  it adds no meaningful delay when nothing actually reloads.

## [0.13.0] — waitForFrameReload()

### Added
- `waitForFrameReload(frameSelector, options?)` — waits for a same-origin
  iframe's own content to actually reload/navigate, by polling until its
  `contentDocument` identity changes (and has finished loading), rather
  than requiring you to know a specific old element to `waitFor(...,
  { state: 'gone' })`. Directly addresses the race where a step
  immediately following a click that triggers an iframe reload runs before
  that reload has even started, hitting a button in the stale,
  about-to-be-replaced content. Works identically whether the triggering
  click happens inside the iframe or on the parent page (e.g. a "refresh"
  button on the parent page, or a `<form target="iframe-name">`
  submission) — only the iframe's own content needs to be what changes.
  Added to `run()`'s step dispatcher as `{ type: 'waitForFrameReload',
  target, options }`.
- 4 new real-browser tests: a demonstration of the race without any wait
  (proving it's real, not theoretical — the click genuinely fails to find
  the new content), the fix resolving it via `run()`, the same fix working
  when the trigger is outside the iframe, and a clear timeout error.

## [0.12.2]

### Documentation
- Clarified and verified that 0.12.1's `waitFor()` iframe-reload fix works
  the same way regardless of whether the triggering click happens inside
  the iframe or on the parent page (e.g. a "refresh" button on the parent
  page, or a `<form target="iframe-name">` submission) — only the iframe's
  own content needs to be what's changing. Added a real-browser test for
  this specific case (trigger button outside the iframe). No functional
  code change; 0.12.1 already covered this correctly.

## [0.12.1]

### Fixed
- `waitFor()` resolved the target document for a `{ selector, frame }`
  target once, before starting to poll, instead of on every check. If the
  iframe itself navigated or reloaded its own content while `waitFor` was
  waiting (e.g. a button inside the iframe that reloads just that iframe,
  without the top page navigating at all — common for embedded payment
  widgets or multi-step forms), its `contentDocument` gets replaced with a
  brand-new `Document` object, and polling kept querying the old,
  torn-down one forever, timing out even once the real new content was
  ready. Now re-resolves the frame's document on every poll tick, so it
  correctly follows the iframe through its own navigation. Verified with 2
  new real-browser tests, for both the default "wait for it to appear" and
  `state: 'gone'`.

## [0.12.0] — Text-based target resolution

### Added
- `_resolve()` now also supports `{ selector, text }` — matches an element
  by its visible (trimmed) text content, since native CSS has no "match by
  text" selector. Combines freely with `index` (for several elements
  sharing identical text) and `frame`. This is what
  [page-pilot-recorder](https://github.com/jyy1082/page-pilot-recorder)
  0.5.0+ produces for a button/link it can't otherwise identify by
  id/aria-label/data attribute — often the most human-recognizable
  identifier a button has.
- 4 new real-browser tests: unique text matching, duplicate-text
  disambiguation via `index`, a clear error when no element has the given
  text, and `text` + `frame` combined inside an iframe.

## [0.11.0] — waitFor(state: 'gone')

### Added
- `waitFor()` now accepts `options.state: 'gone'` to wait for an element to
  disappear (removed from the DOM, or become invisible) instead of the
  default behavior of waiting for one to appear. This directly addresses a
  real race condition on pages that update content asynchronously without a
  full navigation: a step immediately following one that triggers such an
  update can otherwise run before the update lands, hitting a stale/about-
  to-be-replaced element instead of the new one. The fix is to wait for the
  old element to actually be gone (and/or the new one to appear) before
  continuing, rather than guessing a fixed delay.
- 4 new real-browser tests, including one that deliberately reproduces the
  race condition without `waitFor` (confirming it's real and repeatable),
  and one confirming `state: 'gone'` resolves it correctly end to end.

## [0.10.0] — Duplicate-id target resolution

### Added
- `_resolve()` now also supports `{ selector, index }` — picks the Nth
  element matching a selector that isn't unique on its own, combinable with
  `frame` for an element that's both inside a duplicate-id situation and a
  same-origin iframe. This is what
  [page-pilot-recorder](https://github.com/jyy1082/page-pilot-recorder)
  0.4.0+ produces for elements sharing a duplicate `id` attribute (invalid
  HTML, but common on real, messier sites) instead of falling back to a
  fragile structural path — recorded steps for such elements replay with no
  manual adjustment.
- `run()`'s frame-wrapping now also merges a step-level `frame` into an
  existing target object (one that already has `index` set but no `frame`
  of its own) instead of only wrapping plain strings.
- 3 new real-browser tests: resolving a `{ selector, index }` target
  correctly, a clear error when the index is out of range, and `index` +
  `frame` combined.

## [0.9.0] — Same-origin iframe support

### Added
- `_resolve()` (and every method built on it — `click`, `type`, `select`,
  `check`, `chooseOption`, `hover`, `dragTo`, `moveTo`, `step`) now accepts
  `{ selector, frame }` as a target, where `frame` is an iframe selector
  (or an array of them for nested iframes), resolving the selector inside
  that same-origin iframe's own document instead of the top page. `run()`
  automatically wraps a recorded step's string targets this way whenever it
  carries a `frame` field — the exact field
  [page-pilot-recorder](https://github.com/jyy1082/page-pilot-recorder)
  produces when it records interactions inside an iframe, so recorded
  steps replay with no manual adjustment.
- `waitFor()` also supports the `{ selector, frame }` shape for its target.
- A new `_topLevelRect()` helper converts an iframe-contained element's
  `getBoundingClientRect()` (relative to that iframe's own viewport) into
  top-level-viewport coordinates, by walking up through `window.frameElement`
  for however many iframes it's nested in. The cursor dot, click ripples,
  and highlight boxes all use this now, so they land in the right place on
  screen even when the target lives inside an iframe.
- A real-browser test suite (`test/browser-test.mjs`, `npm test`) covering
  click/type/select/check/waitFor inside a same-origin iframe, correct
  coordinate translation, a full record → replay round trip using
  page-pilot-recorder, and a clear error for a missing/wrong iframe selector.

### Fixed
- `_scheduleReposition()`'s "is this highlight's element still attached"
  check used `document.body.contains(el)` — always false for an element
  inside an iframe (it's never a descendant of the *top* document's body),
  which would have silently dropped iframe-contained highlights on the next
  scroll/resize. Now uses `el.isConnected`, which is correct regardless of
  which document owns the element.

## [0.8.0] — Block real input during the page glow

### Added
- `blockInteraction` (default `true`) — while the page glow is showing, a
  transparent overlay blocks real mouse clicks inside the glow area, so the
  person watching can't interfere with automation in progress. Set to
  `false` to keep the visual glow but allow real input through.
- `pointerBlockAllowlist` — an array of selectors that stay clickable even
  while blocked (e.g. a Stop button that happens to sit inside the
  glow-covered container).
- `pageGlowMessage` — an optional status label (e.g.
  `"Automation running — please wait…"`) pinned to the top of the glow
  area, shown and hidden in sync with the glow itself. Hidden by default.
- Demo updated to enable the message and allowlist the Stop/Reset buttons.

Verified with a 17-case test suite covering blocking, the allowlist
passthrough, the message, and `stop()`/`destroy()` cleanup.

## [0.7.0] — Rename to page-pilot

### Changed
- **Breaking:** renamed the project from `agent-cursor` to `page-pilot`.
  The exported class is now `PagePilot` (was `AgentCursor`), the error class
  is `PagePilotStopped` (was `AgentCursorStopped`), and the file is
  `page-pilot.js` (was `agent-cursor.js`). Update your imports:
  ```js
  // before
  import { AgentCursor } from './agent-cursor.js'
  // after
  import { PagePilot } from './page-pilot.js'
  ```

## [0.6.0] — Keyboard, hover, drag, and async waiting

### Added
- `pressKey(target, key, options)` — dispatch a real keydown/keyup, with
  optional modifier keys (ctrl/shift/alt/meta).
- `hover(target)` / `unhover()` — trigger mouseenter/mouseover and
  mouseleave/mouseout for tooltips and hover-driven UI.
- `dragTo(source, target, options)` — animated mousedown → mousemove →
  mouseup drag sequence, for mouse-event-based sortable lists, sliders, and
  drag widgets. Accepts an element or a raw `{ x, y }` point as the
  destination.
- `waitFor(target, options)` — poll for a selector (or predicate function)
  to match a visible element before continuing, instead of guessing a fixed
  delay. Supports `timeout`, `interval`, and `visible`, and is abortable via
  `stop()`.
- All four new methods work as `run()` step types (`pressKey`, `hover`,
  `unhover`, `dragTo`, `waitFor`).
- Demo updated with a hover tooltip, an Escape-to-close menu, a
  drag-and-drop chip, and an asynchronously-loaded "Load more" section.

Verified with an 18-case test suite covering all four additions.

## [0.5.0] — Container-scoped page glow

### Added
- `pageGlowTarget` — wrap the page glow around a specific container instead
  of the whole viewport, staying aligned to it across scroll/resize.
- `pageGlowRadius` — rounds the glow's corners, useful when wrapping a
  container that itself has rounded corners.

### Changed
- Demo's page glow now wraps the card container instead of the full browser
  viewport, since the demo's content is a narrow centered column.

## [0.4.0] — stop() and hardening

### Added
- `stop()` — immediately abort whatever's currently running (mid-wait,
  mid-typing, mid-scroll, anywhere) and drop anything still queued. The
  instance stays fully usable right after, no reset needed.
- `AgentCursorStopped` error class (later renamed `PagePilotStopped`) for
  distinguishing an intentional stop from a real failure.
- A Stop button in the demo.

### Fixed
- The page glow could get stuck on permanently after `stop()` interrupted a
  step mid-flight, due to an active-step counter drifting negative. Now
  clamped at 0.
- `stop()` interrupting a scroll (with `showScrollIndicator: true`) could
  leave the direction-arrow badge stuck on screen forever. `stop()` now
  cleans it up.
- Added a fallback for environments without `element.scrollTo()`, and made
  `contenteditable` detection more robust (checks the attribute as well as
  `isContentEditable`).

Verified with a 29-case test suite covering every public method.

## [0.3.0] — Page glow

### Added
- `showPageGlow` — a pulsing colored border around the whole viewport for
  as long as any step is running, a "the system is driving this" signal.
  Off by default. Configurable via `pageGlowColor` and `pageGlowWidth`.

## [0.2.0] — Broader form and framework support

### Added
- `check()` now supports custom ARIA switch components (`role="switch"` /
  `aria-checked`), not just native checkbox/radio inputs.
- `type()` now supports `contenteditable` elements (rich-text editors,
  custom div-based inputs), not just `<input>`/`<textarea>`.
- `showCursorDot: false` to skip the moving cursor dot entirely and keep
  only ripple/highlight feedback.
- `showScrollIndicator` (default off) to optionally show a small direction
  arrow during `scroll()`.
- `hideCursor()` / `showCursor()`; `run()` now auto-hides the cursor once a
  full sequence finishes.

### Fixed
- `select()` now uses the native property setter (like `type()` already
  did) so React-controlled `<select>` elements fire `onChange` correctly.

### Documentation
- Added a "Framework compatibility" section covering React/Vue behavior.
- Made the project description tool-agnostic (no longer references any
  specific third-party automation framework).

## [0.1.0] — Initial release

### Added
- Core interaction methods: `click()`, `type()`, `select()` (including
  multi-select), `check()` (checkbox/radio), `chooseOption()` (custom
  dropdowns), `scroll()` (window or container, by amount or to an edge).
- Animated virtual cursor with click ripple feedback.
- Persistent highlight borders on every acted-on element, with
  `clearHighlight()` / `clearHighlights()`.
- `run(steps)` to execute an ordered batch of steps.
- `step(target, action)` escape hatch for fully custom logic.
- Interactive `demo.html` covering every control type.

### Fixed
- A highlight box could jump to the top-left corner if the acted-on element
  hid itself as a side effect of being clicked (e.g. a dropdown option that
  closes its own menu).
- The demo's custom dropdown didn't open on the first click, due to a
  state-comparison bug against an unset inline style.
