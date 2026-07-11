# page-pilot

**English** · [中文](./README.zh-CN.md)

**Version 0.15.0** · see [CHANGELOG.md](./CHANGELOG.md) for release history

A dependency-free visualization layer for automated webpage operations.

It does **not** decide what to click or type — that's your own automation
logic (your own selectors, or whatever drives your automation). This library
only animates a virtual cursor moving to a target, plays a click / input
feedback effect, draws a highlight border around whatever was just touched,
and lets your executor perform the real DOM action underneath.

Built for the common case of adding a "here's what's happening, and where"
visual layer on top of any automated webpage interaction, without pulling in
a UI framework or animation library.

## Demo

**[Open the live demo](https://jyy1082.github.io/page-pilot/demo.html)** —
press "Run full demo" to watch the library drive a real form: typing, a
native `<select>`, a custom dropdown, a checkbox, scrolling a container, and
a final click, with a highlight border left on every field it touched.

You can also open [`demo.html`](./demo.html) directly from a local clone —
no build step needed, it's plain ES modules.

## Features

- Animated virtual cursor that moves to each target before acting
- Click ripple and press feedback
- Typing animation that works in native inputs/textareas (via native setter,
  so it works through React/Vue controlled inputs) and in `contenteditable`
  elements (rich-text editors, custom div-based inputs)
- Native `<select>` support, including multi-select
- Checkbox/radio/switch support (including ARIA-based custom toggles) that only clicks when the state actually needs to change
- Custom (div/li-based) dropdown menu support via `chooseOption`
- Keyboard input: `pressKey()` for Enter/Escape/arrows/etc., with modifier keys
- Hover/unhover for tooltips and hover-triggered menus
- Drag and drop for mouse-event-based sortable lists, sliders, and custom drag widgets
- `waitFor()` polls for asynchronously-loaded content instead of guessing a fixed delay
- Page and container scrolling, with scroll-settle detection and an optional direction indicator
- Optional pulsing border around the whole viewport (or a specific container via `pageGlowTarget`) while any step is running — a clear "the system is driving this" signal for the person watching. Real mouse clicks inside it are blocked by default (`blockInteraction`, with an escape-hatch allowlist via `pointerBlockAllowlist`), and an optional status message (`pageGlowMessage`) appears and disappears together with it
- Same-origin iframe support — target elements inside an iframe with `{ selector, frame }`, with automatic coordinate translation for the cursor/ripple/highlight visuals
- Persistent highlight borders on every acted-on element (on by default,
  cleared explicitly or via `highlightDuration`), auto-repositioned on scroll/resize
- Every operation is queued, so animations and actions never overlap
- Respects `prefers-reduced-motion`
- Zero dependencies, ~5KB

## Install

```bash
npm install page-pilot
```

Or just copy `page-pilot.js` directly into your project.

## Usage

```js
import { PagePilot } from 'page-pilot'

const cursor = new PagePilot({
  onExecuteClick: (el) => el.click(),
})

await cursor.click(document.querySelector('#submit'))
await cursor.type(document.querySelector('#name'), 'Acme Corp')
await cursor.select(document.querySelector('#country'), 'US')
await cursor.check(document.querySelector('#agree'), true)
await cursor.chooseOption('#menu-trigger', '.menu-item[data-value="pro"]')
await cursor.scroll(null, { amount: 600 })       // scroll window down 600px
await cursor.scroll('#panel', { to: 'bottom' })  // scroll a container to its bottom

cursor.clearHighlight('#name')  // remove one persisted highlight
cursor.clearHighlights()        // remove all of them
cursor.destroy()
```

### "The system is doing this" page glow

```js
const cursor = new PagePilot({ showPageGlow: true })
// Now the whole viewport gets a pulsing colored border for as long as any
// click/type/select/etc. is running, and it fades out once the queue is idle.
```

Wrap a specific container instead of the whole page:

```js
const cursor = new PagePilot({ showPageGlow: true, pageGlowTarget: '#chat-panel' })
// The glow hugs #chat-panel's current bounding box instead of the viewport,
// and stays aligned to it if the page scrolls or resizes.
```

By default, real mouse clicks inside the glow area are blocked while it's
showing — so the person watching can't interfere with automation in
progress — and it comes with an optional status message that appears and
disappears together with the glow:

```js
const cursor = new PagePilot({
  showPageGlow: true,
  pageGlowTarget: '#demo-card',
  pageGlowMessage: 'Automation running — please wait…',
  // Keep the Stop button clickable even though it's inside the blocked area:
  pointerBlockAllowlist: ['#stop-btn'],
})

// Or opt out of blocking entirely and just show the visual glow:
const cursor2 = new PagePilot({ showPageGlow: true, blockInteraction: false })
```

While the glow is showing, real mouse input inside that area is blocked by
default (`blockInteraction: true`) — so the person watching can't click/type
into the page while automation is driving it, and it releases automatically
the instant the glow fades:

```js
const cursor = new PagePilot({ showPageGlow: true, blockInteraction: false })
// Real clicks/input still reach the page even while the glow is showing.
```

Add a small status label pinned to the top of the glow area:

```js
const cursor = new PagePilot({
  showPageGlow: true,
  pageGlowMessage: 'Automation running — please wait…',
})
// Shown only while a step is running, and disappears together with the glow.
```

### Batch steps

```js
await cursor.run([
  { type: 'type', target: '#email', text: 'a@b.com' },
  { type: 'select', target: '#country', value: 'US' },
  { type: 'check', target: '#agree-terms', checked: true },
  { type: 'chooseOption', target: '#plan-trigger', option: '.plan-option[data-value="pro"]' },
  { type: 'scroll', target: '#panel', options: { to: 'bottom' } },
  { type: 'click', target: '#submit' },
])
```

### Stopping mid-sequence

```js
const runPromise = cursor.run([ /* a long list of steps */ ])

stopButton.addEventListener('click', () => cursor.stop())

await runPromise // resolves quietly even if stop() cut it short
```

### Keyboard, hover, drag, and waiting for async content

```js
await cursor.pressKey('#search', 'Enter')
await cursor.pressKey('#dropdown', 'ArrowDown')
await cursor.pressKey(null, 'Escape') // sends to whatever currently has focus

await cursor.hover('#info-icon')   // triggers mouseenter/mouseover (tooltips, hover menus)
await cursor.unhover()             // triggers mouseleave/mouseout

await cursor.dragTo('#item-1', '#drop-zone')          // element to element
await cursor.dragTo('#slider-handle', { x: 400, y: 120 }) // element to a raw point

await cursor.waitFor('#async-result', { timeout: 8000 }) // polls instead of guessing a fixed delay

// Wait for something to disappear instead of appear — useful right before a
// step that depends on an earlier, about-to-be-replaced element actually
// having been removed first (common on pages that update content
// asynchronously without a full navigation, where the next step can
// otherwise run before that update lands and hit the stale old element):
await cursor.click('#save-btn')
await cursor.waitFor('#save-btn', { state: 'gone', timeout: 3000 })
await cursor.waitFor('#saved-confirmation')
```

### Hooking up to your own executor

If your automation already has its own way of clicking/typing (a custom DOM
controller, a browser-extension bridge, whatever), just point the hooks at it
instead of the default `el.click()` / native-setter input:

```js
const cursor = new PagePilot({
  onExecuteClick: (el) => myController.clickElement(indexOf(el)),
  onExecuteInput: (el, text) => myController.inputText(indexOf(el), text),
})
```

## API

| Method | Description |
|---|---|
| `click(target, label?)` | Move to and click an element |
| `type(target, text, label?)` | Move to, focus, and type into an input/textarea/contenteditable element |
| `select(target, value, label?)` | Set a native `<select>`'s value (array = multi-select) |
| `check(target, checked, label?)` | Set a checkbox, radio, or ARIA switch (`role="switch"`/`aria-checked`) to a specific checked state |
| `chooseOption(trigger, option, options?)` | Open a custom dropdown and click an option |
| `scroll(target, options?)` | Scroll the window or a container (`{ amount }` or `{ to: 'top'\|'bottom' }`) |
| `pressKey(target, key, options?)` | Send a key press (Enter, Escape, arrows, etc.), with optional modifiers |
| `hover(target, label?)` | Move to a target and dispatch hover events (mouseenter/mouseover) |
| `unhover(label?)` | Leave whatever's currently hovered via `hover()` |
| `dragTo(source, target, options?)` | Drag from a source to a target element or `{x, y}` point |
| `waitFor(target, options?)` | Poll until a selector/predicate matches a visible element (or, with `{ state: 'gone' }`, until it disappears), instead of a fixed delay |
| `waitForFrameReload(frameSelector, options?)` | Wait for a same-origin iframe's own content to reload/navigate (its document identity changes) — no need to know anything about the new content |
| `moveTo(target)` | Move the cursor without acting |
| `step(target, action, label?)` | Run custom logic while still getting the cursor animation |
| `run(steps)` | Run an ordered array of steps of any of the above types, then automatically hide the cursor dot |
| `stop()` | Immediately abort whatever's running and drop anything still queued — the instance stays usable right after, no reset needed |
| `hideCursor()` | Hide the cursor dot (e.g. once a sequence of individual calls is done) |
| `showCursor()` | Show the cursor dot again (also happens automatically on the next move/click/type/etc.) |
| `clearHighlight(target)` | Remove one element's highlight box |
| `clearHighlights()` | Remove every active highlight box |
| `destroy()` | Remove the cursor, all highlights, and event listeners |

`target` accepts a `Element`, a CSS selector string, or an object combining
`selector` with `frame` (for an element inside a same-origin iframe, see
"iframe support" below), `index` (to pick the Nth match of a selector
that isn't unique on its own, see "Duplicate ids" below), and/or `text`
(to match a button/link by its visible text content, see "Matching by
text" below) — these are the shapes
[page-pilot-recorder](https://github.com/jyy1082/page-pilot-recorder)
produces automatically, so recorded steps replay with no manual adjustment.

## Duplicate ids

Real (especially older or messier) sites often have more than one element
sharing the same `id` — invalid HTML, but browsers don't stop anyone from
doing it. `{ selector, index }` picks the Nth match instead of assuming the
first one is the right one:

```js
await cursor.click({ selector: '[id="row-action"]', index: 2 }) // the third one
```

This is what page-pilot-recorder generates automatically once it notices a
recorded element's `id` doesn't uniquely identify it — you shouldn't
usually need to write this by hand, but it's there if you're constructing
steps yourself.

## Matching by text

Native CSS has no "match by visible text" selector, so `{ selector, text }`
fills that gap for buttons and links — often the most human-recognizable
and redesign-resistant identifier they have, especially when there's no
id/aria-label/data attribute at all:

```js
await cursor.click({ selector: 'button', text: 'Submit' })

// several elements sharing the exact same text combine with index, same as duplicate ids:
await cursor.click({ selector: 'button', text: 'Delete', index: 2 }) // the third "Delete" button
```

This is what page-pilot-recorder generates automatically for a button/link
it can't otherwise identify. `text` and `index` both combine freely with
`frame` too.

## iframe support

Steps recorded inside a **same-origin** iframe (or written by hand) can
carry a `frame` field — an iframe selector, or an array of them for nested
iframes — and `run()` resolves the element in the right document
automatically:

```js
await cursor.run([
  { type: 'click', target: '#confirm-btn', frame: '#payment-iframe' },
])

// or call a method directly with the { selector, frame } shape:
await cursor.click({ selector: '#confirm-btn', frame: '#payment-iframe' })

// nested iframes: outermost to innermost
await cursor.type({ selector: '#field', frame: ['#outer-iframe', '#inner-iframe'] }, 'hello')

// index and frame combine when an element is both inside an iframe and
// among a set of duplicate ids there:
await cursor.click({ selector: '[id="dup"]', index: 1, frame: '#payment-iframe' })
```

The cursor dot, click ripples, and highlight boxes all correctly account
for the iframe's own position on the page — `getBoundingClientRect()` is
relative to an element's own window, not the top page, so page-pilot
translates iframe-relative coordinates into top-level ones before drawing
anything.

If a click causes an iframe to navigate or reload its own content (common
for embedded payment widgets or multi-step forms — the top page's URL
never changes, only the iframe's), `waitFor({ selector, frame }, ...)`
correctly follows it through the reload instead of getting stuck polling
the old, torn-down document. This works the same way whether the
triggering click happened inside the iframe or on the parent page (e.g. a
"refresh" button on the parent page, or a `<form target="iframe-name">`
submission) — only the iframe's own content needs to be what's changing:

```js
await cursor.click({ selector: '#next-step-btn', frame: '#payment-iframe' })
await cursor.waitFor({ selector: '#step-2-marker', frame: '#payment-iframe' })
```

That approach needs you to know a specific element in the new content to
wait for. If you'd rather not — or the exact race is "the next step ran
before the iframe had even started reloading, so it hit a button in the
stale, about-to-be-replaced content" — `waitForFrameReload()` waits for the
iframe's own document identity to actually change instead, which needs no
knowledge of what the new content looks like at all:

```js
await cursor.click('#refresh-iframe-btn')   // wherever this button lives — inside the iframe or on the parent page, either way
await cursor.waitForFrameReload('#payment-iframe')
await cursor.click({ selector: '#new-btn', frame: '#payment-iframe' })
```

If you'd rather not add an explicit wait step at all — e.g. you're running
someone else's recorded steps, or steps a person pasted in through a tool
like [page-pilot-toolkit](https://github.com/jyy1082/page-pilot-toolkit) —
set `autoWaitForIframeReload: true`. After every click, it briefly watches
every same-origin iframe on the page for any of them starting to reload,
regardless of which iframe or whether the click that triggered it was
inside or outside it, and waits for it to finish before the next step:

```js
const cursor = new PagePilot({ autoWaitForIframeReload: true })
await cursor.click('#refresh-iframe-btn')
await cursor.click({ selector: '#new-btn', frame: '#payment-iframe' }) // no explicit wait needed
```

It's off by default so existing behavior never changes underneath you
without asking, and when nothing actually reloads it adds no meaningful
delay (`autoIframeReloadGrace`, default 400ms, is how long it watches
before giving up and proceeding immediately). This is a best-effort safety
net, not a hard guarantee — a reload that starts later than the grace
window won't be caught by it; use `waitForFrameReload()` explicitly for a
step you know will always need it.

**Cross-origin iframes can't be targeted at all** — reading or resolving
anything inside one is blocked by the browser itself (the same reason no
browser automation tool can reach into a cross-origin iframe without
special server-side cooperation), not a limitation specific to this library.

### Options

```js
new PagePilot({
  color: '#378ADD',
  size: 16,
  moveDuration: 480,
  clickPause: 260,
  typeDelay: 45,
  respectReducedMotion: true,
  showCursorDot: true,
  showScrollIndicator: false,
  showPageGlow: false,
  pageGlowColor: null,
  pageGlowWidth: 4,
  pageGlowTarget: null,
  pageGlowRadius: 0,
  blockInteraction: true,     // block real mouse clicks inside the glow area while it's showing
  pointerBlockAllowlist: [],  // selectors that stay clickable even while blocked (e.g. a Stop button)
  pageGlowMessage: null,      // small status label pinned to the top of the glow area; null = hidden
  blockInteraction: true,
  pageGlowMessage: null,
  highlightEnabled: true,
  highlightColor: null,        // defaults to `color`
  highlightDuration: null,     // null = persists until cleared; number (ms) = auto-fade
  autoWaitForIframeReload: false, // after each click, briefly watch for any iframe starting to reload and wait for it
  autoIframeReloadGrace: 400,  // ms to watch for a reload starting
  autoIframeReloadMaxWait: 4000, // ms to wait for a detected reload to finish
  scrollSettleTimeout: 1200,
  onExecuteClick: (el) => { /* dispatches pointerdown/mousedown/pointerup/mouseup/click, see source */ },
  onExecuteInput: (el, text) => { /* native-setter input, see source */ },
  onBeforeStep: (step) => {},
  onAfterStep: (step) => {},
})
```

## Framework compatibility

Works against React, Vue, and other framework-rendered UIs the same as
plain HTML — the library only ever touches the real DOM, and every
framework's UI ends up as real DOM nodes at runtime.

- **Clicks** dispatch a full `pointerdown`/`mousedown`/`pointerup`/`mouseup`/
  `click` sequence, not just `el.click()` alone — `.click()` by itself only
  ever fires a `click` event, and plenty of real-world UI (dropdown menus,
  tab switches, admin dashboard frameworks like AceAdmin) binds its actual
  behavior to `mousedown` instead, for snappier interaction. All of these
  bubble and get caught by React's delegated event listeners the same as a
  real mouse click.
- **Typing and `select()`** go through the element's native property setter
  rather than plain assignment, specifically to work around React's (and
  some other frameworks') controlled-component value tracking — plain
  `el.value = x` gets silently ignored by React's change detection even
  after dispatching an `input`/`change` event, so this bypass is required
  for `onChange` to actually fire.
- Component libraries (MUI, Ant Design, etc.) that render a checkbox/switch
  as a styled `<input>` under the hood work through `check()` as-is; ones
  that render a fully custom `<div role="switch">` work through `check()`'s
  ARIA support (see above).

## Known limits

- A native `<select>`'s open option list is rendered by the OS/browser, not
  the DOM, so only the click on the select box itself is animated.
- File inputs (`<input type="file">`) cannot be set programmatically for
  security reasons in any browser.
- Native date/color pickers have the same browser-drawn-popup limitation as
  `<select>`.
- `dragTo()` covers mouse-event-based drag (most sortable lists, sliders,
  custom drag widgets) — it doesn't drive native HTML5 drag-and-drop
  (`draggable="true"` + `DataTransfer`), which needs a trusted user gesture
  in most browsers. Canvas-based widgets also aren't covered directly; use
  `step()` to write custom logic while still getting the cursor animation
  for free.
- Every event this library dispatches is a genuine, real DOM event that any
  listener will see and react to — but it's `isTrusted: false`, since only
  actual OS-level user input produces `isTrusted: true`, and no page-level
  JavaScript (this library or any other) can change that. Most sites don't
  check `event.isTrusted` and work fine; a few (often ones with deliberate
  anti-automation logic on a specific sensitive action) explicitly gate
  behavior behind it and will silently ignore an untrusted click no matter
  how it's dispatched. If a click's animation plays correctly but nothing
  happens, this is worth ruling out.
- `pressKey()` dispatches real KeyboardEvents any listener will see, but —
  like `click()` — it won't trigger a browser's own built-in default action
  for a key (e.g. Enter alone won't auto-submit a form unless the page's own
  JS explicitly does that).
- A "form" built entirely from generic `<div>`s with no semantic markup at
  all (no `role`/`aria-checked`, no `contenteditable`, no real `<input>`
  anywhere) has no standard state to read or write — `click()` still works
  for anything that's just a click, but for anything stateful, use `step()`
  to read/write whatever custom attribute or class your component uses.
- This only moves a *visual* cursor — it cannot move the user's real, physical
  mouse pointer (browsers don't expose that capability to page scripts), and
  clicks are dispatched as synthetic (`isTrusted: false`) events.

## Testing

```bash
npm install
npm test
```

Runs a real-browser regression suite (Playwright + Chromium, obtained via
`@sparticuz/chromium` since it ships the browser inside its own npm
tarball — see
[page-pilot-recorder's README](https://github.com/jyy1082/page-pilot-recorder#testing)
for why that specific detour exists). This matters especially for the
same-origin iframe support: each iframe has its own separate JavaScript
realm with its own `Element`/`Document` constructors, and coordinate
translation between an iframe's viewport and the top page's needs to be
verified against a real browser's actual layout — a simulated DOM
environment doesn't reproduce either of those closely enough to catch
mistakes there.

## License

MIT
