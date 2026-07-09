# page-pilot

**Version 0.7.0** · see [CHANGELOG.md](./CHANGELOG.md) for release history

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
- Optional pulsing border around the whole viewport (or a specific container via `pageGlowTarget`) while any step is running — a clear "the system is driving this" signal for the person watching
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
| `waitFor(target, options?)` | Poll until a selector/predicate matches a visible element, instead of a fixed delay |
| `moveTo(target)` | Move the cursor without acting |
| `step(target, action, label?)` | Run custom logic while still getting the cursor animation |
| `run(steps)` | Run an ordered array of steps of any of the above types, then automatically hide the cursor dot |
| `stop()` | Immediately abort whatever's running and drop anything still queued — the instance stays usable right after, no reset needed |
| `hideCursor()` | Hide the cursor dot (e.g. once a sequence of individual calls is done) |
| `showCursor()` | Show the cursor dot again (also happens automatically on the next move/click/type/etc.) |
| `clearHighlight(target)` | Remove one element's highlight box |
| `clearHighlights()` | Remove every active highlight box |
| `destroy()` | Remove the cursor, all highlights, and event listeners |

`target` accepts a `Element`, or a CSS selector string.

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
  highlightEnabled: true,
  highlightColor: null,        // defaults to `color`
  highlightDuration: null,     // null = persists until cleared; number (ms) = auto-fade
  scrollSettleTimeout: 1200,
  onExecuteClick: (el) => el.click(),
  onExecuteInput: (el, text) => { /* native-setter input, see source */ },
  onBeforeStep: (step) => {},
  onAfterStep: (step) => {},
})
```

## Framework compatibility

Works against React, Vue, and other framework-rendered UIs the same as
plain HTML — the library only ever touches the real DOM, and every
framework's UI ends up as real DOM nodes at runtime.

- **Clicks** dispatch a real `el.click()`, which bubbles and is caught by
  React's delegated event listeners exactly like a real mouse click.
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

## License

MIT
