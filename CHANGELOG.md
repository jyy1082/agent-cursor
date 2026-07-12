# Changelog

All notable changes to this project are documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.5]

### Fixed
- **Recorder: interacting with a date picker (or any similar third-party
  widget that sets a field's value directly, with no `input`/`change`
  event at all) could silently lose the value entirely, or — worse —
  corrupt a completely unrelated later step.** Investigated after a real
  report ("the date wasn't recorded") and reproduced end-to-end with the
  actual bootstrap-datepicker library. Two compounding bugs were found:
  - `_wasRevealedSince` (the "did clicking this reveal something new"
    check behind `chooseOption` merge detection) matched any DOM mutation
    whose target was an ancestor of the next click, with no limit on how
    far up the tree — and `<body>`/`<html>` are technically an ancestor
    of everything on the page. A date picker's popup, appended directly
    to `<body>` (a common pattern to avoid CSS clipping issues) and
    removed from it on close, triggered exactly this: the very next click
    anywhere on the page, however unrelated, got wrongly merged into a
    bogus `chooseOption` step with the calendar-day click, silently
    losing the actual date. Now excludes `<body>`/`<html>` (in whichever
    document — this also needed to work inside an iframe) from counting
    as a "revealed" signal.
  - Even with that fixed, the date's own value still never made it into
    the recording. `_onClick`'s own flush-before-processing check ran in
    this recorder's capture-phase listener, which fires *before* the
    widget's own bubble-phase handler actually sets the field's value —
    so at the moment of that check, nothing looked different yet, and the
    typing buffer tracking the field was discarded. Since the widget then
    sets the value with no event firing at all, there was no other signal
    left to catch the change by afterward. `_flushTyping` now gives a
    field one short, one-time deferred re-check before giving up when
    nothing looks changed yet — the overwhelmingly common case (a real,
    direct typing session actually ending) finds nothing different a
    moment later either and costs nothing; a delayed, eventless value-set
    now gets caught and correctly recorded as a clean `type` step. The
    click that triggered it (which would otherwise replay against a
    specific calendar day cell that isn't even in the DOM once the
    calendar isn't open, breaking replay before it ever reached the
    correct value) is removed rather than left behind, since the `type`
    step alone already reproduces the correct final result — the same
    as if the date had been typed directly.
- 2 new real-browser regression tests (using a minimal, dependency-free
  reproduction of each mechanism, after manually verifying the real
  underlying cause against the actual bootstrap-datepicker library).
  Also corrected an existing test whose own scenario had — ironically —
  the same category of mistake found in 1.0.4's test: it exercised a
  *legitimate* `chooseOption` merge (an element added directly to
  `<body>` by its own trigger, clicking that same element) rather than
  the actual bug pattern (an unrelated later click near a `<body>`-level
  mutation caused by something else entirely).

## [1.0.4]

### Added
- **Recorder: typing into a field, leaving it, and coming back to
  retype something different now merges into one clean step** when
  nothing else genuinely happened in between the two edits — fixing a
  typo by clicking away and back, say. The now-superseded earlier value
  never shows up as its own step, and any Backspace/Delete/Ctrl+A steps
  used to clear the field along the way get cleaned up too, since the
  merged step alone already reproduces the same final result on replay.
  The moment anything else genuinely happens in between — even an
  incidental click on some other element — both edits are correctly kept
  as separate steps, in order, since real actions between them can
  matter for what replays correctly; this only merges when there is
  truly nothing to lose. Requested after a report showing two candidates
  for a "city" field (a corrected typo and the real final value) in
  page-pilot-skills' review panel — that panel-level fix from 1.0.3
  still applies as a second line of defense, but this addresses it at
  the source, in the recording itself.
- 3 new real-browser tests: the merge case (leave and come back, nothing
  else happening), confirming the pressKey steps used to clear the field
  get cleaned up too, and confirming a genuinely intervening action (a
  real click) correctly prevents merging.

### Changed
- Updated an existing test whose expectations predated this change (a
  field typed into, edited mid-session with repeated Backspace presses,
  and retyped now correctly merges into a single step, where it
  previously — correctly, at the time — expected two).

## [1.0.3]

### Added
- **Skills: `select` step candidates now show the selected option's actual
  visible text**, not just its raw `value` — found from a real report
  where fields like state or gender showed opaque codes ("143", "2") with
  no meaning to someone reviewing candidates. The real value used at
  replay time is untouched; only the panel's display changed. Works for
  both single- and multi-select (joins multiple selected options'  text
  together); falls back to `null` if no matching option can be found
  (e.g. the page's options changed since recording), rather than
  guessing or crashing.

### Fixed
- **Skills: typing into the same field twice (moved away, came back, and
  retyped something different) showed up as two separate candidates.**
  Both were real, genuine edits — not a recorder bug — but only the
  *last* one actually determines what the field holds once the whole
  recording replays. Found from a real report where a "city" field
  showed both a since-corrected typo and the real final value as two
  separate rows, risking someone reviewing candidates accidentally
  parameterizing (or renaming) the stale one and leaving the value that
  actually matters as a fixed, unparameterized part of the flow instead.
  Now only the last occurrence of a given field becomes a candidate at
  all — the earlier, superseded one doesn't appear.
- 4 new real-browser tests covering both changes, including one that
  reproduces the exact real report (a field typed into twice, correctly
  showing only the final value as a candidate) and one confirming the
  panel itself renders the option's text, not just `detectParameters`'
  return value.

## [1.0.2]

### Fixed
- **Recorder: 1.0.1's fix for "typing after Backspace/Delete/Ctrl+A gets
  lost" had its own timing bug, discovered from a real report** — it
  restarted the typing buffer synchronously right after such a key, but
  `keydown` fires *before* the browser applies that key's own default
  action (actually deleting a character). Capturing the buffer's baseline
  value at that moment grabbed the pre-deletion value, so pressing
  Backspace several times in a row (a very ordinary way to clear a field)
  recorded one redundant, intermediate `type` step *per keypress* instead
  of one clean step for the final result. Deferring the restart with a
  microtask or `setTimeout` didn't fix it either — with several such keys
  fired in a fast burst, the deferred restarts could race against
  subsequent typing and end up treating already-typed text as the
  baseline, silently swallowing it entirely (confirmed by testing — this
  is what happened in the report: several intermediate values got
  recorded, and the real final text ended up missing). Now driven by the
  browser's own `input` event instead of any guessed delay: the buffer is
  only ever re-established the moment a value-changing event actually
  fires and none is currently active, which is definitionally the correct
  time — no race, and it also happens to record *fewer* steps than before
  (a trailing Backspace with nothing typed after it no longer produces a
  redundant step at all, since the preceding `pressKey` step alone already
  reproduces the correct final value on replay). 1 new real-browser
  regression test for the repeated-Backspace case specifically.
- **Skills: a site's own markup having more than one `<label for="X">`
  pointing at the same, otherwise‑uniquely‑identified field could attach
  the wrong one.** 1.0.1 fixed the case of a duplicate *id* across several
  elements, but this is a different bug: the target field's id is unique,
  yet the site's markup (a real, found-in-the-wild copy-paste mistake —
  an unrelated form row's label was never updated after being duplicated)
  has two different labels both claiming that same `for=` value. A plain
  `document.querySelector` always returns whichever one happens to appear
  first in the document, regardless of which is actually meant for the
  field — in the reported case, a "相片拍摄:" (photo capture) label
  attached to a completely unrelated "Last Name" field. Now, when more
  than one label shares a `for=`, the one structurally closest to the
  target element (measured by nearest shared ancestor) is used instead of
  just the first one found — correctly preferring a label sitting in the
  same form row over an unrelated one elsewhere on the page. 1 new
  real-browser regression test reproducing the exact real-site structure.

## [1.0.1]

### Fixed
- **Recorder: typing after a non-character key (Backspace, Delete, an
  arrow key, Ctrl+A, etc.) within the same focus session was silently
  lost.** `_onKeyDown` correctly flushed whatever was typed *before* such
  a key into its own step, but never re-established the typing buffer
  afterward — so anything typed *after* it (until the next focus event)
  had nowhere to go. This affected an extremely common editing pattern:
  fixing a typo with Backspace and continuing to type, or selecting all
  (Ctrl+A) and retyping a value, would both end up recording only the
  pre-correction text, silently dropping the actual final value a person
  typed. Found from a real report: a "王" typed, then corrected to "Wang"
  by select-all-and-retype, was recorded as "王" — the correction never
  made it into the step at all. Now restarts the typing buffer for the
  same field right after such a key, so subsequent typing is captured
  correctly. 2 new real-browser regression tests (Backspace mid-word, and
  the exact Ctrl+A-and-retype scenario from the report).
- **Skills: a duplicate `id` on the page could attach a completely
  unrelated element's `<label for="...">` text as a parameter's suggested
  name.** `suggestFieldName`'s label lookup used a plain
  `document.querySelector('label[for="X"]')`, which always returns the
  *first* element with a matching `for` value in DOM order — with no way
  to tell whether that's actually the label meant for *this* specific
  field, if the id isn't unique (duplicate ids happen a lot on real,
  messier sites — the exact same reason page-pilot-recorder disambiguates
  them by position for selectors already). Found from a real report where
  a parameter's detected name and its actual value visibly didn't
  correspond to each other. Now checks whether the id is actually unique
  on the page before trusting the `for=` lookup at all, falling through to
  the next safer hint (a wrapping `<label>`, `aria-label`, `placeholder`,
  or `name` — none of which depend on id uniqueness) instead of risking a
  mismatched label. 1 new real-browser regression test.

## [1.0.0] — Unified into one repository

### Changed
- `page-pilot`, `page-pilot-recorder`, `page-pilot-skills`, and
  `page-pilot-toolkit` — previously four separate GitHub repositories,
  each with its own version number and its own vendored test copies of
  the others — are now one repository with one version number, under
  `src/page-pilot.js`, `src/page-pilot-recorder.js`,
  `src/page-pilot-skills.js`, and `src/toolkit.js` respectively. Tests
  moved to `test/core/`, `test/recorder/`, `test/skills/`, `test/toolkit/`.
- `src/toolkit.js` no longer imports the other three via separately-pinned
  jsDelivr URLs — it uses plain relative imports (`./page-pilot.js` etc.),
  since everything is now deployed together at the same version tag. This
  removes an entire class of bug this project hit repeatedly before the
  merge: a toolkit release accidentally pointing at a stale or mismatched
  version of one of the other three layers.
- The version histories below are preserved exactly as they were in each
  formerly-separate repository, under their own headings, rather than
  renumbered into one combined sequence — so a version number like
  "0.17.0" below always means "page-pilot's own 0.17.0", not some new
  reinterpretation of it.

The four layers, and what each one is responsible for, are unchanged by
this move — see the README for the full picture.

---

## page-pilot (core / playback engine) — history before the merge

## [0.17.0] — onObstruction callback

### Added
- `onObstruction` option — called when `verifyClickable` finds something
  blocking the target, with the blocking element and the intended target;
  return `true` if you dismissed it yourself (the click is retried once,
  only erroring if something is genuinely still in the way), or `false`/
  nothing to keep the default error behavior. Lets you handle a modal/
  overlay automatically (e.g. clicking its own close button) instead of
  stopping, without changing the default (still errors if no callback is
  provided, or if the callback doesn't actually resolve it).
- 3 new real-browser tests: the callback dismissing the obstruction and
  the click succeeding afterward (also confirming it receives the correct
  blocking/target elements), the callback claiming success without
  actually fixing anything still falling back to the same clear error, and
  the callback explicitly returning `false` doing the same even when it
  did dismiss the obstruction as a side effect.

### Documentation
- Noted that `onObstruction` must use plain DOM calls
  (`element.click()`), not `cursor.click()` — the callback runs in the
  middle of the queued step that discovered the obstruction, and calling
  back into the same queue from inside it would deadlock.

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

---

## page-pilot-recorder — history before the merge

## [0.5.6]

### Documentation
- Synced vendored page-pilot.js (used by this repo's own test suite) to
  0.17.0, which adds an `onObstruction` callback — handle a click blocked
  by `verifyClickable` yourself (e.g. dismissing a modal) instead of
  erroring, defaulting to the same error behavior if no callback is
  provided. No change to this package's own code.

## [0.5.5]

### Documentation
- Synced vendored page-pilot.js (used by this repo's own test suite) to
  0.16.0, which adds `verifyClickable` — before every click, confirms the
  target is actually the topmost element at its own position, catching
  clicks that would otherwise silently go "through" a modal backdrop/
  overlay a real mouse couldn't reach. No change to this package's own
  code.

## [0.5.4]

### Documentation
- Synced vendored page-pilot.js (used by this repo's own test suite) to
  0.15.0, which fixes the default click behavior to dispatch a fuller
  mousedown/mouseup/click sequence instead of just `el.click()` alone —
  real-world UI that binds its behavior to mousedown instead of click
  (dropdown menus, tab switches, admin dashboard frameworks like
  AceAdmin) would otherwise silently never respond. No change to this
  package's own code.

## [0.5.3]

### Documentation
- Synced vendored page-pilot.js (used by this repo's own test suite) to
  0.14.0, which adds `autoWaitForIframeReload` — automatically detects and
  waits for a same-origin iframe reloading after any click, with no manual
  wait step needed. No change to this package's own code.

## [0.5.2]

### Documentation
- Synced vendored page-pilot.js (used by this repo's own test suite) to
  0.13.0, which adds `waitForFrameReload()` — waits for a same-origin
  iframe's own content to actually reload, fixing a race where the step
  right after a click that triggers an iframe reload can otherwise run
  before that reload has even started, hitting stale content. No change to
  this package's own code.

## [0.5.1]

### Documentation
- Synced vendored page-pilot.js (used by this repo's own test suite) to
  0.12.1, which fixes `waitFor()` incorrectly polling a stale iframe
  document after that iframe navigates/reloads its own content mid-wait.
  No change to this package's own code.

## [0.5.0] — Text-based matching for buttons/links

### Added
- `generateSelector()` now tries the visible text content of `<button>`,
  `<a>`, and `role="button"` elements (if reasonably short) as a selector
  tier, producing a `{ selector: 'button', text: '...' }` target — often
  the most human-recognizable and redesign-resistant identifier a button
  has, and frequently the only thing available when there's no id/
  aria-label/data attribute at all. When more than one element shares the
  exact same text, it's disambiguated by position (adding `index`), the
  same approach already used for duplicate ids.
  Requires page-pilot 0.12.0+, which understands this target shape.
- 4 new real-browser tests: unique text matching, duplicate-text
  disambiguation, a plain `<a>` link with no attributes, and a full record
  → replay round trip confirming the exact duplicate-text element that was
  clicked during recording is the one clicked again on replay.

## [0.4.1]

### Documentation
- Added guidance on a real race condition: on pages that update content
  asynchronously without a full navigation, replaying a step right after
  one that triggers such an update can run ahead of it and hit a stale
  element. Points to page-pilot 0.11.0's new `waitFor(target, { state:
  'gone' })`, which waits for the old element to actually disappear (or the
  new one to appear) before continuing, instead of guessing a fixed delay.

## [0.4.0] — Duplicate-id disambiguation

### Added
- `generateSelector()` now handles duplicate `id` attributes (invalid HTML,
  but common on real, messier sites) instead of just discarding the id and
  falling all the way back to a deep structural path once it's found not to
  be unique. It disambiguates among the elements sharing that id by
  position, producing a `{ selector: '[id="..."]', index: N, fragile: true }`
  target — still marked fragile (a duplicate id is itself a markup smell
  worth reviewing), but far shorter and more robust than a structural path.
  Requires page-pilot 0.10.0+, which understands this target shape.
- 5 new real-browser tests: the disambiguation itself, and a full record →
  replay round trip confirming the exact duplicate that was clicked during
  recording is the one that gets clicked again on replay.

### Changed
- Internally, every step-producing code path now goes through one shared
  `_buildTarget(el, generated)` helper that decides whether a step's target
  needs to be a plain selector string or a `{ selector, index?, frame? }`
  object — previously frame-handling was duplicated across every call site;
  this also fixed a latent inconsistency where a couple of paths could have
  ended up attaching frame info differently. No change to the recorded
  output's meaning, just how it's assembled internally.

## [0.3.2]

### Security
- `<input type="password">` is now never recorded — a hard, non-configurable
  exclusion. Previously any input, regardless of type, was treated as a
  typeable field, meaning a typed password could end up verbatim inside a
  recorded `type` step. Excluded both from the normal `focusin`-triggered
  buffering and from the "field already focused before `start()`" seeding
  path. Verified with 2 new real-browser tests confirming the actual
  password text never appears anywhere in the recorded output.

## [0.3.1]

### Fixed
- Multi-line typing into a `<textarea>` (or `contenteditable`) only
  captured the first line. Enter is in the "non-character keys" list so
  keyboard shortcuts like Enter-to-submit get recorded — but inside a
  multi-line field, pressing Enter is just a newline, not a shortcut. Every
  newline was prematurely flushing the typing buffer into its own `type`
  step and clearing it, so anything typed after the first line had no
  buffer left to land in and was silently lost. Enter now flows into the
  typing buffer like any other character when the focused element is a
  `<textarea>` or `contenteditable` — single-line `<input>` fields are
  unaffected, Enter there still records as its own `pressKey` step.
- Added a real-browser regression test: typing three lines separated by
  Enter into a textarea now correctly captures all three, joined by `\n`.

## [0.3.0] — Drag detection, wait hints, and iframe support

### Added
- `dragTo` recording: a `mousedown` followed by movement past `dragThreshold`
  (default 10px) before `mouseup` is recorded as `{ type: 'dragTo', target,
  destination }`. Text-selection drags are detected and skipped. Set
  `recordDragTo: false` to disable.
- Wait hints: a step following a pause of `waitHintThreshold` (default
  1200ms) or more gets a `gapBefore` (ms) field and fires
  `onWaitHint(gapMs, step)` — a nudge that a `waitFor()` might belong there,
  not an automatic one (the recorder still can't know what selector to wait
  for).
- Same-origin iframe recording: interactions inside a same-origin iframe
  now get a `frame` field (an iframe selector, or an array for nested
  iframes) alongside the usual `target`, so page-pilot's `run()` knows
  which document to resolve the selector in. Cross-origin iframes remain
  unobservable (a hard browser security limitation). Set
  `recordIframes: false` to disable.
- `generateSelector()` (and the whole recorder) now resolves uniqueness
  against each element's own document (`el.ownerDocument`), not always the
  top-level `document` — required for correct selectors on elements inside
  iframes.

### Fixed
- Every `el instanceof Element` (and one `instanceof Document`) check
  silently failed for anything inside an iframe, since each iframe has its
  own separate realm with its own `Element`/`Document` constructors —
  `instanceof` across realms is always `false` even for structurally
  identical elements. Replaced with realm-safe `nodeType` checks
  (`nodeType === 1` / `=== 9`). This is what actually broke iframe click
  recording during development, caught only once real cross-frame
  interactions were tested in an actual browser.
- `_flushIfBlurred()`'s safety net compared the typing buffer's element
  against the top-level `document.activeElement` — for a field focused
  inside an iframe, the top document's `activeElement` is the `<iframe>`
  tag itself, never equal to the actual input, so this incorrectly flushed
  (and discarded) the buffer the instant it was created. Now compares
  against the buffered element's own `ownerDocument.activeElement`.
- A same-origin iframe's `contentDocument` gets replaced by a brand-new
  `Document` object once it finishes navigating to its real content —
  attaching listeners to whatever's there the instant the iframe is
  discovered could mean attaching to a transitional, about-to-be-discarded
  document. Iframe discovery now also listens for the iframe's own `load`
  event and re-attaches at that point.
- 12 new real-browser test cases covering dragTo (including the
  click-vs-drag threshold), wait hints, and iframe recording (typing,
  clicking, and a full record → replay round trip through a real
  `PagePilot.run()`).

## [0.2.0] — Custom dropdown detection (chooseOption)

### Added
- Automatic `chooseOption` merging: a click that reveals something (via a
  `MutationObserver` on style/class/hidden attribute changes or new nodes),
  immediately followed by a click on something inside what just appeared —
  with nothing else recorded in between, within `chooseOptionMergeWindow`
  (default 4000ms) — now merges into one `{ type: 'chooseOption', target,
  option, options: { waitAfterOpen } }` step instead of two separate
  `click` steps. Set `mergeChooseOption: false` to always get two plain
  clicks instead.
- `generateSelector()` now also tries any other `data-*` attribute (not
  just `data-testid`/`data-cy`/`data-test`/`data-qa`) as a selector
  candidate before falling back further — attributes like `data-value` on
  a custom dropdown option are usually read by the app's own logic, so
  they're a meaningfully more stable identifier than a structural fallback,
  even though they weren't put there specifically for testing.
- 8 new real-browser test cases covering the merge itself, the two
  false-positive-avoidance conditions (unrelated clicks, something else
  recorded in between), and a full record → replay round trip confirming
  the recorded `chooseOption` step actually works when fed into a real
  `PagePilot.run()`.

## [0.1.3]

### Added
- A real-browser regression suite (`test/browser-test.mjs`, `npm test`)
  using Playwright + Chromium, covering everything 0.1.1/0.1.2 fixed plus
  the original working cases — driven by actual `page.click()`/`page.fill()`
  /`page.selectOption()`/`keyboard.press()` interactions rather than
  synthetic `dispatchEvent()` calls. This exists because the bugs fixed in
  0.1.1 and 0.1.2 both passed a full jsdom-based suite; jsdom's event
  simulation doesn't reproduce real browser focus timing closely enough to
  have caught them before a real person did.
- Since `npx playwright install` needs `cdn.playwright.dev`, which isn't
  reachable in every environment (including the one these tests were
  developed in), the suite obtains Chromium via `@sparticuz/chromium`
  instead, which ships the binary inside its own npm tarball, and points
  Playwright's `launch({ executablePath })` at it directly.

## [0.1.2]

### Fixed
- Typing could still be silently lost in real-world use even after 0.1.1's
  fix, whenever focus moved away from a field without a `focusout` event
  being observably fired for it (e.g. moving focus into a native `<select>`
  in some browsers/interaction patterns) — the recorder relied on
  `focusin`/`focusout` exclusively, and that turned out to be fragile.
  Every `click`/`change`/`keydown` now also checks `document.activeElement`
  directly and flushes the typing buffer if it no longer matches, as a
  safety net independent of whether a focus event was seen at all.

### Changed
- A plain click into a text field/textarea (just focusing it to type) is no
  longer recorded as its own `click` step — it was pure noise, since
  focusing the element is already implicit in the `type` step that follows,
  and a redundant `click()` during replay could risk unwanted side effects.

## [0.1.1]

### Fixed
- Typing was silently lost entirely (no `type` step produced at all) if a
  field already had focus at the moment `start()` was called — no
  `focusin` event ever fires in that case, since focus never changes, so
  the typing buffer was never created. `start()` now checks
  `document.activeElement` and seeds the buffer immediately if it's already
  sitting in a form field.
- Clicking a custom Stop/Start/Replay control (built outside the recorder's
  own floating UI) got recorded as a spurious extra `click` step, since the
  recorder's capture-phase listener fires before the control's own
  bubble-phase handler calls `stop()`. Added a `data-ppr-ignore` attribute
  you can put on your own controls to exclude them from recording (the
  built-in floating UI is already excluded automatically).

## [0.1.0] — Initial release

### Added
- `PagePilotRecorder` class: `start()`, `stop()`, `clear()`, `destroyUi()`.
- Records click, typing (buffered until blur), native `<select>`
  (single/multi), checkbox/radio (as `check` steps), non-character keys and
  modifier-key shortcuts (as `pressKey` steps), and debounced window/
  container scrolling.
- `generateSelector()`: id → data-testid/data-cy/data-test/data-qa →
  aria-label → name → non-utility class names → structural fallback
  (flagged `fragile: true`).
- Optional floating start/stop/copy control panel.
- `demo.html`: full record → generate steps → replay loop using page-pilot.

---

## page-pilot-skills — history before the merge

## [0.2.0]

### Fixed
- `buildSkillDraft` overwrote a `check` step's `checked` boolean with a
  literal `"{{name}}"` *string* placeholder — silently corrupting its
  type. Any code (like `PagePilot.check()`) expecting a real boolean would
  have received a truthy string instead, regardless of what value was
  actually meant. Now uses a separate `checkedParam` marker property,
  leaving `checked` as the originally recorded boolean (a safe fallback if
  a value isn't provided when filling the skill back in later).

### Added
- `fillSkillParameters(skill, values)` — substitutes real values back into
  a saved skill's `{{name}}` placeholders (and `checkedParam` markers),
  returning a fresh steps array ready to hand to `PagePilot.run()`. A
  missing value leaves the literal `{{name}}` text in place rather than
  silently blanking it out (much easier to notice something's wrong), and
  a missing checked value falls back to what was originally recorded.
  Never mutates the skill passed in. This is what actually makes a saved
  skill usable again — `buildSkillDraft`/`saveSkill` alone only get you as
  far as storing one.
- 6 new real-browser tests, including a full round trip: record → save as
  a skill → fill with values different from what was originally recorded
  → replay through a real `PagePilot.run()` → confirm the new values (not
  the recorded ones) actually land in the page.

## [0.1.0] — Initial release

### Added
- `detectParameters(steps)`: scans a page-pilot-recorder step array for
  `type`/`select`/`check` values worth turning into named parameters,
  suggesting a human-readable name for each by inspecting the field's
  `<label>` (both `for=` and wrapping), `aria-label`, `placeholder`, and
  `name` attribute, in that priority order. Long values (>200 chars) and
  checkbox/radio states default to unchecked (suggested as fixed, not
  parameterized); select values default checked.
- `hasFragileSteps(steps)` / `isHighRisk(steps)`: heuristic checks for a
  structural-path-fallback selector and for a click matching a common
  dangerous-action word (delete, submit, pay, transfer, etc., in English
  and Chinese), used to pre-fill (not enforce) warnings in the panel.
- `buildSkillDraft(description, steps, acceptedParams)`: builds a draft
  skill with each accepted parameter's value replaced by a `{{name}}`
  placeholder, working on a copy — never mutates the steps array passed in.
- `saveSkill` / `listSkills` / `getSkill` / `deleteSkill`: a small
  `localStorage`-backed storage API, scoped per domain
  (`location.hostname` by default). `saveSkill` strips everything but a
  parameter's `name` before writing to storage — example values are never
  persisted, deliberately, even if a draft object happens to carry them.
- `showArchivePanel(steps, options?)`: the full review UI — task
  description, detected parameter candidates (editable name, checkbox),
  the step list (each individually removable, for dropping recorded
  noise), a fragile-selector warning, and a high-risk checkbox
  (pre-checked based on `isHighRisk`, always overridable). Resolves with
  the saved record on "Save as skill" (saving itself, callers don't need
  to call `saveSkill` separately) or `null` on "One-time use". Marked
  with `data-ppr-ignore` so page-pilot-recorder never records interactions
  with the panel itself as part of a session.
- A real-browser test suite (`test/browser-test.mjs`, `npm test`, 40
  cases) covering label-priority detection across every supported hint
  type, the storage round trip, per-domain scoping, and the full archive
  panel flow including renaming a parameter, deleting a step, and both
  the save and skip paths.

---

## page-pilot-toolkit (bookmarklet) — history before the merge

## [0.7.0] — page-pilot-skills integration

### Added
- Stopping a recording now shows [page-pilot-skills](https://github.com/jyy1082/page-pilot-skills)'s
  archive panel — save the recording as a reusable, named skill (turning
  specific typed/selected values into named parameters) or use it just
  this once. The JSON box always keeps the originally recorded values
  either way, so Run/Copy on what you just recorded keep working
  immediately regardless of whether it was also saved.
- A **My Skills** section at the top of the panel lists everything saved
  for the current site: **Run** opens a small form (one field per
  parameter) to fill in new values and run the skill with them; skills
  marked high-risk ask for an extra confirmation first; **Delete** removes
  one for good, with a confirmation.
- Pinned `page-pilot-skills` at 0.2.0.
- 5 new real-browser tests: the full save → appears in My Skills flow,
  running a saved skill with values different from what was originally
  recorded, deleting a skill, and the high-risk confirmation dialog.

### Documentation
- Corrected an outdated claim that nothing persists between visits — the
  JSON text box itself still doesn't, but saved skills now deliberately
  do (as named parameters, via page-pilot-skills, never as raw example
  values — see its own README for why). Added a security note about
  skills living in the site's own `localStorage`.

## [0.6.1]

### Changed
- Pinned page-pilot version bumped to 0.17.0, which adds an
  `onObstruction` callback for library consumers writing their own scripts
  (not directly usable from this panel's JSON-based UI, since there's no
  way to provide a JS callback through it — the panel's Run button keeps
  using the default error behavior when something is blocked).

## [0.6.0] — Modal/overlay obstruction detection

### Changed
- Pinned page-pilot version bumped to 0.16.0, and the Run button now
  passes `verifyClickable: true` when creating its PagePilot instance.
  Fixes the exact real-world risk: if a step in a recorded/pasted sequence
  clicks through a modal dialog's backdrop that hadn't actually closed
  (its own close button didn't work as expected, or something it was
  waiting on never resolved), a real mouse could never reach whatever's
  behind it — but this library, dispatching events straight to a resolved
  element, silently could and would, interacting with the wrong thing with
  no indication anything was wrong. With this on, such a click now throws
  a clear error instead of going through. Bookmarklet users have no
  realistic way to notice and fix this mid-run, so it needed to be
  automatic here even though it's opt-in in the underlying library.
- New real-browser test confirming the panel's own Run button (not just
  the underlying library) correctly refuses to click a button still
  covered by an open modal backdrop.

## [0.5.1]

### Changed
- Pinned page-pilot version bumped to 0.15.0, which fixes the default
  click behavior to dispatch a fuller mousedown/mouseup/click sequence
  instead of just `el.click()` alone. Real-world admin dashboards and UI
  frameworks (dropdown menus, tab switches — AceAdmin among them) often
  bind their actual behavior to `mousedown` instead of `click`, and would
  otherwise silently never respond even though the cursor animation played
  correctly.

## [0.5.0] — Automatic iframe-reload handling

### Changed
- Pinned page-pilot version bumped to 0.14.0, and the Run button now
  passes `autoWaitForIframeReload: true` when creating its PagePilot
  instance. Fixes the exact real-world race: clicking a button that
  reloads an iframe's content (whether the button is inside the iframe or
  on the parent page), then immediately clicking something in what should
  be the new content — without this, the next step could run before the
  iframe finished reloading and hit a stale, about-to-be-replaced button
  instead. Bookmarklet users have no realistic way to hand-insert a wait
  step into recorded/pasted JSON, so this needed to be automatic here even
  though it's opt-in in the underlying library.
- New real-browser test confirming the panel's own Run button (not just
  the underlying library) correctly waits through an iframe reload with no
  manual intervention.

## [0.4.2]

### Changed
- Pinned page-pilot version bumped to 0.13.0, which adds
  `waitForFrameReload()` — waits for a same-origin iframe's own content to
  actually reload, fixing a race where the step right after a click that
  triggers an iframe reload can otherwise run before that reload has even
  started, hitting stale content.

## [0.4.1]

### Changed
- Pinned page-pilot version bumped to 0.12.1, which fixes `waitFor()`
  incorrectly polling a stale document if an iframe navigates or reloads
  its own content while waiting (e.g. an embedded payment widget or
  multi-step form that reloads just that iframe, without the top page
  navigating at all).

## [0.4.0]

### Changed
- Pinned versions bumped to page-pilot 0.12.0 and page-pilot-recorder 0.5.0,
  which add text-based matching for buttons/links (`{ selector, text }`
  targets) — often the most human-recognizable and redesign-resistant way
  to identify a button that has no id/aria-label/data attribute at all.

## [0.3.0]

### Changed
- Pinned page-pilot version bumped to 0.11.0, which adds
  `waitFor(target, { state: 'gone' })` — fixes a real race condition on
  pages that update content asynchronously without a full navigation,
  where replaying a step right after one that triggers such an update
  could run ahead of it and hit a stale element.

## [0.2.0]

### Changed
- Pinned versions bumped to page-pilot 0.10.0 and page-pilot-recorder 0.4.0,
  which add duplicate-`id` disambiguation (`{ selector, index }` targets) —
  real, especially older or messier, sites often have more than one element
  sharing the same `id`, and recorded steps for such elements now resolve
  correctly on replay instead of always hitting the first match.
- Also fixes the earlier tag/version-pinning setup: the very first release
  referenced version tags on page-pilot/page-pilot-recorder that hadn't
  actually been created as real git tags yet, so jsDelivr's `@version`
  URLs 404'd and the bookmarklet silently did nothing. All three repos now
  have proper tags matching every pinned version referenced anywhere.

## [0.1.0] — Initial release

### Added
- `toolkit.js`: loaded by a bookmarklet, dynamically imports pinned versions
  of page-pilot and page-pilot-recorder from jsDelivr, and renders a
  floating record/run panel inside a closed-off Shadow DOM so it can't be
  visually broken by (or leak styles onto) whatever site it's running on.
- Panel controls: Start/Stop recording, an editable JSON textarea showing
  the recorded steps, Run (plays them back with `showPageGlow` +
  `pageGlowMessage` for visible feedback), and Copy (to clipboard).
- Running a hand-written steps array works the same way as running a
  recorded one — pasting into the box and pressing Run doesn't require
  recording first.
- `install.html`: the page with the actual draggable bookmarklet link and
  usage/security notes.
- A real-browser test suite (`test/browser-test.mjs`, `npm test`) covering
  the full record → stop → run round trip through the panel UI, pasting
  and running hand-written steps, password-field exclusion end-to-end,
  Copy-to-clipboard, and closing/reopening the panel.

### Fixed (found via the real-browser tests before shipping)
- Re-"clicking" the bookmarklet after closing the panel did nothing: an ES
  module script is only ever evaluated once per exact URL, so injecting a
  second `<script type="module">` pointing at the identical jsDelivr URL
  silently no-ops instead of re-running `toolkit.js`'s top-level code.
  Fixed by appending a `?t=<timestamp>` cache-buster to the script URL each
  time the bookmarklet runs, forcing a fresh module evaluation.
- Clicks inside the Shadow DOM panel get retargeted when observed by a
  listener outside the shadow root (`event.target` appears as the shadow
  host element, not the actual button clicked inside it) — this meant the
  recorder's own `data-ppr-ignore` exclusion check couldn't find the marker
  by walking up from the real target. Fixed by also putting
  `data-ppr-ignore` directly on the shadow host element itself, which is
  what a retargeted event's `target` actually resolves to.
