# agent-cursor

A dependency-free visualization layer for automated page operations.

It does **not** decide what to click or type — that's your automation logic
(your own selectors, or something like PageAgent's `PageController`). This
library only animates a virtual cursor moving to a target, plays a click /
input feedback effect, draws a highlight border around whatever was just
touched, and lets your executor perform the real DOM action underneath.

Built for the common case of adding a "the AI is doing this, and here's
where" visual layer to an in-page AI/browser agent, without pulling in a UI
framework or animation library.

## Demo

Open [`demo.html`](./demo.html) directly in a browser (no build step needed —
it's plain ES modules) and press "Run full demo" to watch the library drive
a real form: typing, a native `<select>`, a custom dropdown, a checkbox,
scrolling a container, and a final click, with a highlight border left on
every field it touched.

If you enable GitHub Pages for this repo (Settings → Pages → deploy from
`main` branch), the demo will be live at
`https://jyy1082.github.io/agent-cursor/demo.html`.

## Features

- Animated virtual cursor that moves to each target before acting
- Click ripple and press feedback
- Typing animation with native-setter input (works through React/Vue
  controlled inputs)
- Native `<select>` support, including multi-select
- Checkbox/radio support that only clicks when the state actually needs to change
- Custom (div/li-based) dropdown menu support via `chooseOption`
- Page and container scrolling, with a direction indicator and scroll-settle detection
- Persistent highlight borders on every acted-on element (on by default,
  cleared explicitly or via `highlightDuration`), auto-repositioned on scroll/resize
- Every operation is queued, so animations and actions never overlap
- Respects `prefers-reduced-motion`
- Zero dependencies, ~5KB

## Install

```bash
npm install agent-cursor
```

Or just copy `agent-cursor.js` directly into your project.

## Usage

```js
import { AgentCursor } from 'agent-cursor'

const cursor = new AgentCursor({
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

### Hooking up to a real executor (e.g. PageAgent's PageController)

```js
const cursor = new AgentCursor({
  onExecuteClick: (el) => pageController.clickElement(indexOf(el)),
  onExecuteInput: (el, text) => pageController.inputText(indexOf(el), text),
})
```

## API

| Method | Description |
|---|---|
| `click(target, label?)` | Move to and click an element |
| `type(target, text, label?)` | Move to, focus, and type into an input/textarea |
| `select(target, value, label?)` | Set a native `<select>`'s value (array = multi-select) |
| `check(target, checked, label?)` | Set a checkbox/radio to a specific checked state |
| `chooseOption(trigger, option, options?)` | Open a custom dropdown and click an option |
| `scroll(target, options?)` | Scroll the window or a container (`{ amount }` or `{ to: 'top'\|'bottom' }`) |
| `moveTo(target)` | Move the cursor without acting |
| `step(target, action, label?)` | Run custom logic while still getting the cursor animation |
| `run(steps)` | Run an ordered array of steps of any of the above types |
| `clearHighlight(target)` | Remove one element's highlight box |
| `clearHighlights()` | Remove every active highlight box |
| `destroy()` | Remove the cursor, all highlights, and event listeners |

`target` accepts a `Element`, or a CSS selector string.

### Options

```js
new AgentCursor({
  color: '#378ADD',
  size: 16,
  moveDuration: 480,
  clickPause: 260,
  typeDelay: 45,
  respectReducedMotion: true,
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

## Known limits

- A native `<select>`'s open option list is rendered by the OS/browser, not
  the DOM, so only the click on the select box itself is animated.
- File inputs (`<input type="file">`) cannot be set programmatically for
  security reasons in any browser.
- Native date/color pickers have the same browser-drawn-popup limitation as
  `<select>`.
- Drag-and-drop and canvas-based widgets aren't covered directly; use `step()`
  to write custom logic while still getting the cursor animation for free.
- This only moves a *visual* cursor — it cannot move the user's real, physical
  mouse pointer (browsers don't expose that capability to page scripts), and
  clicks are dispatched as synthetic (`isTrusted: false`) events.

## License

MIT
