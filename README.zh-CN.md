# page-pilot

[English](./README.md) · **中文**

**版本 0.12.2** · 完整版本历史见 [CHANGELOG.md](./CHANGELOG.md)

一个零依赖的"自动化网页操作可视化层"。

它**不负责决定**要点什么、要输入什么——那是你自己的自动化逻辑（你自己的选择器，或者随便什么驱动你自动化的东西）。这个库只做一件事：把一个虚拟光标动画式地移动到目标位置，播放点击/输入的反馈效果，给刚刚操作过的元素画一个高亮边框，然后把真正的 DOM 操作交给你自己的执行逻辑去完成。

设计初衷是给任何自动化网页操作加一层"这里正在发生什么、发生在哪里"的可视化反馈,不需要引入任何 UI 框架或动画库。

## Demo

**[打开在线 demo](https://jyy1082.github.io/page-pilot/demo.html)** —— 点"Run full demo"，看这个库驱动一个真实表单完成一整套操作：打字、原生下拉选择、自定义下拉菜单、勾选框、滚动容器、悬停提示、按键盘 Escape 关闭菜单、拖拽、等待异步加载的内容，最后点击提交——每个碰过的字段都会留下高亮边框。

也可以直接把仓库 clone 下来，本地打开 [`demo.html`](./demo.html)——不需要任何构建步骤，纯 ES module。

## 功能

- 动画光标：每次操作前先移动到目标位置
- 点击涟漪和按下反馈
- 打字动画：支持原生输入框/textarea（走原生 setter，所以在 React/Vue 受控输入框上也能正常触发），也支持 `contenteditable` 元素（富文本编辑器、自定义 div 输入框）
- 原生 `<select>` 支持，包括多选
- 复选框/单选框/开关支持（包括基于 ARIA 的自定义开关组件），只有状态真的需要改变时才会点击
- 自定义下拉菜单（div/li 拼的）支持，通过 `chooseOption`
- 键盘操作：`pressKey()` 支持 Enter/Escape/方向键等，可带修饰键
- 悬停/取消悬停：用于提示气泡、悬停触发的菜单
- 拖拽：支持基于鼠标事件实现的排序列表、滑块、自定义拖拽组件
- `waitFor()`：轮询等待异步加载的内容，而不是猜一个固定延时
- 页面和容器滚动，带滚动稳定检测，可选方向指示
- 可选的整页呼吸边框（或者用 `pageGlowTarget` 指定某个容器），只要有操作在跑就会亮起——清楚地告诉观看者"系统正在自己操作"。默认会屏蔽这个区域内的真实鼠标点击（`blockInteraction`，可以用 `pointerBlockAllowlist` 设置例外），还可以配一个状态提示文字（`pageGlowMessage`），跟边框同步出现、同步消失
- 支持同源 iframe——用 `{ selector, frame }` 就能操作 iframe 里面的元素，光标/涟漪/高亮这些视觉效果会自动换算坐标
- 每个被操作过的元素都会留下常驻高亮边框（默认开启，可以主动清除或者用 `highlightDuration` 设置自动淡出），滚动/窗口变化时会自动跟随重新定位
- 所有操作都走队列，动画和操作之间不会互相打架
- 遵循 `prefers-reduced-motion`（系统减少动态效果设置）
- 零依赖，体积约 5KB

## 安装

```bash
npm install page-pilot
```

或者直接把 `page-pilot.js` 复制到你的项目里。

## 用法

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
await cursor.scroll(null, { amount: 600 })       // 整个页面往下滚 600px
await cursor.scroll('#panel', { to: 'bottom' })  // 把某个容器滚到底部

cursor.clearHighlight('#name')  // 移除一个常驻高亮
cursor.clearHighlights()        // 移除全部高亮
cursor.destroy()
```

### "系统正在操作"呼吸边框

```js
const cursor = new PagePilot({ showPageGlow: true })
// 现在只要有 click/type/select 等任何操作在跑，整个视口就会出现一圈呼吸的彩色边框，
// 队列空闲下来之后会自动淡出。
```

指定某个容器而不是包住整个页面：

```js
const cursor = new PagePilot({ showPageGlow: true, pageGlowTarget: '#chat-panel' })
// 边框会紧贴 #chat-panel 当前的位置和大小，而不是包住整个视口，
// 页面滚动或者容器大小变化时也会跟着自动对齐。
```

默认情况下,呼吸边框亮着的时候,这个区域内的**真实鼠标点击会被屏蔽**——这样正在观看的人就不会不小心干扰到正在进行的自动化操作。还可以配一个状态提示文字,跟边框同步出现、同步消失:

```js
const cursor = new PagePilot({
  showPageGlow: true,
  pageGlowTarget: '#demo-card',
  pageGlowMessage: '正在自动化执行，请稍等……',
  // 即使 Stop 按钮在被屏蔽的区域里面，也让它保持可以点击：
  pointerBlockAllowlist: ['#stop-btn'],
})

// 或者完全不屏蔽点击，只保留视觉上的呼吸边框：
const cursor2 = new PagePilot({ showPageGlow: true, blockInteraction: false })
```

呼吸边框亮着的时候，边框范围内的真实鼠标输入默认会被拦截（`blockInteraction: true`）——
这样观看的人没法在自动化操作的时候手动点/输入干扰进去，边框一淡出就会立刻自动解除拦截：

```js
const cursor = new PagePilot({ showPageGlow: true, blockInteraction: false })
// 即使呼吸边框亮着，真实的点击/输入依然能正常触达页面。
```

在呼吸边框顶部加一行小字提示：

```js
const cursor = new PagePilot({
  showPageGlow: true,
  pageGlowMessage: '正在自动化执行，请稍等……',
})
// 只在有操作跑的时候显示，跟呼吸边框一起自动消失。
```

### 批量执行步骤

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

### 中途停止

```js
const runPromise = cursor.run([ /* 一长串步骤 */ ])

stopButton.addEventListener('click', () => cursor.stop())

await runPromise // 即使被 stop() 打断，也是正常 resolve，不会抛错
```

### 键盘、悬停、拖拽、等待异步内容

```js
await cursor.pressKey('#search', 'Enter')
await cursor.pressKey('#dropdown', 'ArrowDown')
await cursor.pressKey(null, 'Escape') // 发给当前拥有焦点的元素

await cursor.hover('#info-icon')   // 触发 mouseenter/mouseover（提示气泡、悬停菜单）
await cursor.unhover()             // 触发 mouseleave/mouseout

await cursor.dragTo('#item-1', '#drop-zone')              // 元素拖到元素
await cursor.dragTo('#slider-handle', { x: 400, y: 120 }) // 元素拖到坐标点

await cursor.waitFor('#async-result', { timeout: 8000 }) // 轮询等待，而不是猜一个固定延时

// 等一个元素消失,而不是等它出现——用在"下一步操作依赖某个即将被替换的旧元素真的已经没了"这种场景
// 之前非常有用（很多页面不整页跳转、只是异步更新内容，如果不等旧元素真的消失，
// 下一步很可能在更新完成之前就跑了，点到了那个还没被替换掉的旧元素上）：
await cursor.click('#save-btn')
await cursor.waitFor('#save-btn', { state: 'gone', timeout: 3000 })
await cursor.waitFor('#saved-confirmation')
```

### 接入你自己的执行逻辑

如果你的自动化已经有自己的一套点击/输入实现方式（自定义 DOM 控制器、浏览器扩展桥接、或者别的什么），把这两个 hook 指向你自己的逻辑就行，不用默认的 `el.click()` / 原生 setter 输入：

```js
const cursor = new PagePilot({
  onExecuteClick: (el) => myController.clickElement(indexOf(el)),
  onExecuteInput: (el, text) => myController.inputText(indexOf(el), text),
})
```

## API

| 方法 | 说明 |
|---|---|
| `click(target, label?)` | 移动过去并点击一个元素 |
| `type(target, text, label?)` | 移动过去、聚焦、然后打字到输入框/textarea/contenteditable 元素 |
| `select(target, value, label?)` | 设置原生 `<select>` 的值（传数组 = 多选） |
| `check(target, checked, label?)` | 把复选框、单选框或 ARIA 开关（`role="switch"`/`aria-checked`）设为指定的勾选状态 |
| `chooseOption(trigger, option, options?)` | 打开一个自定义下拉菜单并点击其中一个选项 |
| `scroll(target, options?)` | 滚动窗口或某个容器（`{ amount }` 或 `{ to: 'top'\|'bottom' }`） |
| `pressKey(target, key, options?)` | 发送一次按键（Enter、Escape、方向键等），可带修饰键 |
| `hover(target, label?)` | 移动到目标并派发悬停事件（mouseenter/mouseover） |
| `unhover(label?)` | 离开当前通过 `hover()` 悬停的元素 |
| `dragTo(source, target, options?)` | 从一个来源拖到目标元素或者一个 `{x, y}` 坐标点 |
| `waitFor(target, options?)` | 轮询直到某个选择器/条件匹配到可见元素（或者，配合 `{ state: 'gone' }`，等到它消失），而不是固定延时等待 |
| `moveTo(target)` | 只移动光标，不执行操作 |
| `step(target, action, label?)` | 运行自定义逻辑，同时仍然获得光标动画效果 |
| `run(steps)` | 按顺序执行一组步骤（以上任意类型），执行完自动隐藏光标 |
| `stop()` | 立刻中断正在执行的操作，并丢弃所有还在排队的后续步骤——实例之后仍可正常使用，不需要重置 |
| `hideCursor()` | 隐藏光标圆点（比如一连串单独调用都做完之后） |
| `showCursor()` | 重新显示光标圆点（下一次 move/click/type 等操作时也会自动重新显示） |
| `clearHighlight(target)` | 移除某一个元素的高亮框 |
| `clearHighlights()` | 移除所有当前存在的高亮框 |
| `destroy()` | 移除光标、所有高亮框，以及事件监听器 |

`target` 可以是一个 `Element`、CSS 选择器字符串，或者是一个对象，组合了 `selector` 和 `frame`（同源 iframe 里的元素，见下面的"iframe 支持"）、`index`（区分一个本身不唯一的选择器匹配到的第几个，见下面的"重复 id"）、和/或 `text`（按钮/链接按可见文字匹配，见下面的"按文字匹配"）——这些都是 [page-pilot-recorder](https://github.com/jyy1082/page-pilot-recorder) 会自动生成的格式，录制出来的步骤不需要手动调整就能直接回放。

## 重复 id

真实网站（尤其是老旧或者比较"糙"的网站）经常出现同一个 `id` 被用在好几个元素上——不合规的 HTML，但浏览器不会阻止。`{ selector, index }` 用来指定"匹配到的第几个"，而不是默认用第一个：

```js
await cursor.click({ selector: '[id="row-action"]', index: 2 }) // 第三个（0 开始数）
```

这是 page-pilot-recorder 发现某个录制到的元素的 `id` 并不能唯一确定它时，自动生成的格式——通常你不需要自己手写这个，但如果你自己拼步骤，也可以这么用。

## 按文字匹配

原生 CSS 没有"按可见文字内容匹配"这种选择器，`{ selector, text }` 就是为按钮和链接补上这个能力——这往往是它们最容易被人认出来、也最不容易在改版中被换掉的标识，尤其是在没有 id/aria-label/data 属性的情况下：

```js
await cursor.click({ selector: 'button', text: '提交' })

// 好几个元素文字完全一样的话，组合 index，跟重复 id 的处理方式一样：
await cursor.click({ selector: 'button', text: '删除', index: 2 }) // 第三个"删除"按钮
```

这是 page-pilot-recorder 给一个实在没法用别的方式识别的按钮/链接自动生成的格式。`text` 和 `index` 也都能跟 `frame` 自由组合。

## iframe 支持

在**同源** iframe 里录制的步骤（或者你自己手写的步骤）可以带一个 `frame` 字段——一个 iframe 选择器，多层嵌套的话是数组——`run()` 会自动去正确的文档里解析这个元素：

```js
await cursor.run([
  { type: 'click', target: '#confirm-btn', frame: '#payment-iframe' },
])

// 也可以直接调用方法，传 { selector, frame } 这种形式：
await cursor.click({ selector: '#confirm-btn', frame: '#payment-iframe' })

// 嵌套 iframe：从最外层到最内层
await cursor.type({ selector: '#field', frame: ['#outer-iframe', '#inner-iframe'] }, 'hello')

// index 和 frame 可以组合使用：既在 iframe 里,又碰上重复 id
await cursor.click({ selector: '[id="dup"]', index: 1, frame: '#payment-iframe' })
```

光标圆点、点击涟漪、高亮框，都会正确换算 iframe 在页面上的实际位置——因为 `getBoundingClientRect()` 返回的坐标是相对于元素自己所在窗口的，不是相对于顶层页面，page-pilot 会先把 iframe 内部的相对坐标换算成顶层坐标，再去画这些视觉效果。

如果一次点击导致某个 iframe **自己**跳转或者重新加载内容（很常见，比如内嵌的支付组件、多步骤表单——顶层页面的地址栏完全不变，只是 iframe 自己变了），`waitFor({ selector, frame }, ...)` 会正确跟着这次重新加载走，而不会卡在轮询一个已经作废的旧文档上。不管触发这次点击的按钮是在 iframe 里面，还是在父页面上（比如父页面上的一个"刷新"按钮，或者 `<form target="iframe-name">` 这种提交方式）——只要变化的是 iframe 自己的内容，都一样能正常工作：

```js
await cursor.click({ selector: '#next-step-btn', frame: '#payment-iframe' })
await cursor.waitFor({ selector: '#step-2-marker', frame: '#payment-iframe' })
```

**跨域的 iframe 完全没法操作**——读取或者操作跨域 iframe 内部的任何东西，都是浏览器自己拦下来的（任何浏览器自动化工具，不借助服务端配合，都进不去跨域 iframe），不是这个库特有的限制。

### 配置项

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
  blockInteraction: true,     // 呼吸边框亮着的时候，屏蔽这个区域内的真实鼠标点击
  pointerBlockAllowlist: [],  // 即使被屏蔽，也依然保持可点击的选择器列表（比如 Stop 按钮）
  pageGlowMessage: null,      // 固定在呼吸边框顶部的状态提示文字；null = 不显示
  blockInteraction: true,
  pageGlowMessage: null,
  highlightEnabled: true,
  highlightColor: null,        // 默认跟 color 一致
  highlightDuration: null,     // null = 一直保持直到手动清除；数字（毫秒）= 自动淡出
  scrollSettleTimeout: 1200,
  onExecuteClick: (el) => el.click(),
  onExecuteInput: (el, text) => { /* 原生 setter 输入，见源码 */ },
  onBeforeStep: (step) => {},
  onAfterStep: (step) => {},
})
```

## 框架兼容性

跟纯 HTML 一样，能正常在 React、Vue 等框架渲染出来的界面上工作——这个库只操作真实 DOM，不管是哪个框架，最终渲染出来的都是真实的 DOM 节点。

- **点击**：派发的是真实的 `el.click()`，会正常冒泡，能被 React 的委托事件监听器像真实鼠标点击一样捕获到。
- **打字和 `select()`**：走的是元素的原生属性 setter，而不是直接赋值——这是专门用来绕过 React（以及其他一些框架）对受控组件的值追踪机制的：直接 `el.value = x` 即使配合派发 `input`/`change` 事件，也会被 React 的变化检测悄悄忽略，必须走这个绕过逻辑 `onChange` 才会真正触发。
- 像 MUI、Ant Design 这类组件库，如果底层用的是套了样式的原生 `<input>` 实现 checkbox/开关，直接用 `check()` 就行；如果是完全自己拼的 `<div role="switch">`，走 `check()` 的 ARIA 支持（见上文）。

## 已知限制

- 原生 `<select>` 展开的选项列表是操作系统/浏览器渲染的，不在 DOM 里，所以只有点击选择框这个动作能做动画。
- 文件上传输入框（`<input type="file">`）出于安全原因，任何浏览器都不允许用脚本设置。
- 原生的日期/颜色选择器跟 `<select>` 一样，弹出的面板是浏览器绘制的，有同样的限制。
- `dragTo()` 覆盖的是基于鼠标事件实现的拖拽（大部分排序列表、滑块、自定义拖拽组件）——它驱动不了原生 HTML5 的拖放（`draggable="true"` + `DataTransfer`），这个在大部分浏览器里需要真实的用户手势。Canvas 类组件也没有直接支持；可以用 `step()` 写自定义逻辑，同时仍然能获得光标动画。
- `pressKey()` 派发的是真实的 KeyboardEvent，任何监听器都能收到，但是——跟 `click()` 一样——它不会触发浏览器自带的默认按键行为（比如单单按 Enter 不会自动提交表单，除非页面自己的 JS 显式做了这件事）。
- 一个完全用普通 `<div>` 拼出来、没有任何语义化标记的"表单"（没有 `role`/`aria-checked`，没有 `contenteditable`，也没有真实的 `<input>`）没有标准的状态可读可写——`click()` 对纯点击行为依然有效，但涉及状态的部分，需要用 `step()` 自己读写这个组件用的自定义属性或 class。
- 这个库只移动一个**视觉上**的光标——它没法移动用户真实的、物理的鼠标指针（浏览器不会把这个能力开放给页面脚本），并且点击是作为合成事件（`isTrusted: false`）派发的。

## 测试

```bash
npm install
npm test
```

跑的是真实浏览器的回归测试（Playwright + Chromium，通过 `@sparticuz/chromium` 拿到——它把浏览器打包在了 npm 包本身里，具体原因见 [page-pilot-recorder 的 README](https://github.com/jyy1082/page-pilot-recorder#testing)）。这对同源 iframe 支持这部分尤其重要：每个 iframe 都有自己独立的 JavaScript realm、自己独立的 `Element`/`Document` 构造函数，iframe 视口和顶层页面之间的坐标换算也得放到真实浏览器的实际布局里才能验证对不对——模拟出来的 DOM 环境两边都复现不到位，测不出这类问题。

## 协议

MIT
