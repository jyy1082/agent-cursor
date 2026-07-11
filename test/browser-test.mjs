/**
 * Real-browser tests for PagePilot's same-origin iframe support (the
 * `frame` field on a step, and _resolve()'s { selector, frame } target
 * shape). Uses the same Playwright + @sparticuz/chromium setup as
 * page-pilot-recorder's test suite, for the same reason: a real browser's
 * cross-realm behavior (each iframe has its own separate Element/Document
 * constructors) and getBoundingClientRect() coordinate scoping don't get
 * exercised meaningfully by jsdom.
 *
 * Run: node test/browser-test.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sparticuzChromium = require('@sparticuz/chromium').default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.error('  FAIL -', name); }
}

function startServer() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = req.url === '/' ? '/test/fixture.html' : req.url;
      const filePath = path.join(ROOT, urlPath);
      const body = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;

  const executablePath = await sparticuzChromium.executablePath();
  const launchArgs = sparticuzChromium.args.filter(
    (a) => a !== '--single-process' && a !== '--no-zygote'
  );
  const browser = await chromium.launch({ executablePath, args: launchArgs, headless: true });
  let intentionalClose = false;
  browser.on('disconnected', () => {
    if (!intentionalClose) console.error('[browser] disconnected unexpectedly');
  });

  async function freshPage() {
    const page = await browser.newPage();
    await page.goto(`${base}/test/fixture.html`);
    await page.waitForSelector('#test-iframe');
    // Wait for the iframe's own content to be ready before poking at it.
    await page.frameLocator('#test-iframe').locator('#iframe-input').waitFor();
    return page;
  }

  console.log('=== WITHOUT verifyClickable (default): clicking through a modal backdrop silently "succeeds" ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      window.showModalBackdrop();
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 }); // verifyClickable not set — default off
      await cursor.click('#covered-btn'); // real mouse could never reach this — the modal backdrop covers it
      cursor.destroy();
      return window.__coveredBtnClicked;
    });
    check('demonstrates the risk: the covered button gets clicked anyway by default (no check)', result === true);
    await page.close();
  }

  console.log('=== WITH verifyClickable: true, the same click throws instead of silently going through ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      window.showModalBackdrop();
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4, verifyClickable: true });
      let message = null;
      try {
        await cursor.click('#covered-btn');
      } catch (e) {
        message = e.message;
      } finally {
        cursor.destroy();
      }
      return { message, clicked: window.__coveredBtnClicked };
    });
    check('throws a clear error instead of clicking through the modal', typeof result.message === 'string' && result.message.includes('covered'));
    check('the covered button is NOT actually clicked when blocked', result.clicked === false);
    await page.close();
  }

  console.log('=== verifyClickable: true correctly allows the click once the modal is actually closed ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      window.showModalBackdrop();
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4, verifyClickable: true });
      await cursor.click('#modal-close-btn'); // closes the backdrop
      await cursor.click('#covered-btn'); // now genuinely reachable
      cursor.destroy();
      return window.__coveredBtnClicked;
    });
    check('once the modal is really closed, the same target clicks correctly with no error', result === true);
    await page.close();
  }

  console.log('=== verifyClickable: true does not false-positive on an icon nested inside the button itself ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4, verifyClickable: true });
      let errored = false;
      try {
        await cursor.click('#icon-btn'); // its own visual center may hit the inner <span> icon, not the button itself
      } catch {
        errored = true;
      }
      cursor.destroy();
      return { errored, clicked: window.__iconBtnClicked };
    });
    check('no false-positive obstruction error for an icon nested inside the target', result.errored === false);
    check('the button click still actually fires', result.clicked === true);
    await page.close();
  }

  console.log('=== verifyClickable: true does not false-positive on page-pilot\'s own glow/blocker overlay ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({
        moveDuration: 4, clickPause: 4, verifyClickable: true,
        showPageGlow: true, pageGlowTarget: '#top-btn', blockInteraction: true,
      });
      let errored = false;
      try {
        await cursor.click('#top-btn'); // sits right inside the glow+blocker's own covered area
      } catch {
        errored = true;
      }
      cursor.destroy();
      return errored;
    });
    check('page-pilot\'s own glow/blocker overlay is correctly excluded, no false-positive', result === false);
    await page.close();
  }

  console.log('=== click() triggers mousedown-bound handlers too, not just click ===');
  {
    const page = await freshPage();
    const fired = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click('#mousedown-only-link');
      cursor.destroy();
      return window.__mousedownLinkFired;
    });
    check('a handler bound only to mousedown (common in dropdown/tab-switch UI) still fires', fired === true);
    await page.close();
  }

  console.log('=== click() inside a same-origin iframe ===');
  {
    const page = await freshPage();
    const clicked = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click({ selector: '#iframe-btn', frame: '#test-iframe' });
      cursor.destroy();
      return document.getElementById('test-iframe').contentWindow.__iframeButtonClicked;
    });
    check('click actually reaches the button inside the iframe', clicked === true);
    await page.close();
  }

  console.log('=== type() inside a same-origin iframe ===');
  {
    const page = await freshPage();
    const value = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4, typeDelay: 2 });
      await cursor.type({ selector: '#iframe-input', frame: '#test-iframe' }, 'Hello iframe');
      cursor.destroy();
      const iframe = document.getElementById('test-iframe');
      return iframe.contentDocument.getElementById('iframe-input').value;
    });
    check('typing lands in the iframe input, not the top page', value === 'Hello iframe');
    await page.close();
  }

  console.log('=== select() inside a same-origin iframe ===');
  {
    const page = await freshPage();
    const value = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.select({ selector: '#iframe-select', frame: '#test-iframe' }, 'jp');
      cursor.destroy();
      const iframe = document.getElementById('test-iframe');
      return iframe.contentDocument.getElementById('iframe-select').value;
    });
    check('select value is set inside the iframe', value === 'jp');
    await page.close();
  }

  console.log('=== check() inside a same-origin iframe ===');
  {
    const page = await freshPage();
    const checked = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.check({ selector: '#iframe-checkbox', frame: '#test-iframe' }, true);
      cursor.destroy();
      const iframe = document.getElementById('test-iframe');
      return iframe.contentDocument.getElementById('iframe-checkbox').checked;
    });
    check('checkbox inside the iframe gets checked', checked === true);
    await page.close();
  }

  console.log('=== waitFor() inside a same-origin iframe ===');
  {
    const page = await freshPage();
    const found = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      const el = await cursor.waitFor({ selector: '#iframe-btn', frame: '#test-iframe' }, { timeout: 2000 });
      cursor.destroy();
      return el && el.id;
    });
    check('waitFor resolves with the element inside the iframe', found === 'iframe-btn');
    await page.close();
  }

  console.log('=== highlight/cursor positioning accounts for the iframe offset ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click({ selector: '#iframe-btn', frame: '#test-iframe' });
      const iframeRect = document.getElementById('test-iframe').getBoundingClientRect();
      const btnRect = document.getElementById('test-iframe').contentDocument.getElementById('iframe-btn').getBoundingClientRect();
      // The cursor's last known position should be within the iframe's
      // on-screen bounds (top-level coordinates), not the raw
      // iframe-relative coordinates of the button (which would place it
      // near (0,0) instead, since the iframe isn't at the page's origin).
      const pos = cursor._lastPos;
      cursor.destroy();
      return {
        pos,
        expectedMinX: iframeRect.left + btnRect.left,
        expectedMinY: iframeRect.top + btnRect.top,
        iframeLeft: iframeRect.left,
      };
    });
    check('cursor position is translated into top-level coordinates, not raw iframe-relative ones',
      Math.abs(result.pos.x - (result.expectedMinX + 20)) < 40); // roughly near the button's true screen position
    check('cursor position is not just the iframe-relative (unconverted) coordinate',
      result.pos.x > result.iframeLeft); // must be offset by at least the iframe's own left position
    await page.close();
  }

  console.log('=== full round trip: recorder captures inside an iframe, PagePilot replays it ===');
  {
    const page = await freshPage();
    await page.addScriptTag({ url: '/page-pilot-recorder.js', type: 'module' }).catch(() => {});
    const result = await page.evaluate(async () => {
      const { PagePilotRecorder } = await import('/page-pilot-recorder.js');
      const recorder = new PagePilotRecorder({ ui: false });
      recorder.start();

      const iframe = document.getElementById('test-iframe');
      const input = iframe.contentDocument.getElementById('iframe-input');
      input.dispatchEvent(new Event('focusin', { bubbles: true }));
      input.focus();
      input.value = 'Recorded then replayed';
      const btn = iframe.contentDocument.getElementById('iframe-btn');
      btn.click(); // triggers a real focusout on input plus the click handler

      const steps = recorder.stop();

      // Reset the fixture, then replay the exact recorded steps.
      input.value = '';
      window.__iframeButtonClicked = false;

      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4, typeDelay: 2 });
      await cursor.run(steps);
      cursor.destroy();

      return {
        steps,
        replayedValue: iframe.contentDocument.getElementById('iframe-input').value,
        replayedClick: iframe.contentWindow.__iframeButtonClicked,
      };
    });
    check('recorded steps carry a frame marker', result.steps.some((s) => s.target?.frame === '#test-iframe'));
    check('replaying the recorded steps retypes the value inside the iframe', result.replayedValue === 'Recorded then replayed');
    check('replaying the recorded steps re-clicks the button inside the iframe', result.replayedClick === true);
    await page.close();
  }

  console.log('=== click() resolves { selector, index } targets (duplicate-id disambiguation) ===');
  {
    const page = await freshPage();
    const clickedText = await page.evaluate(async () => {
      const buttons = document.querySelectorAll('#dup-btn');
      let clicked = null;
      buttons.forEach((b) => b.addEventListener('click', () => { clicked = b.textContent; }));
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click({ selector: '[id="dup-btn"]', index: 2 });
      cursor.destroy();
      return clicked;
    });
    check('clicks the exact element at the given index among duplicates', clickedText === 'Third');
    await page.close();
  }

  console.log('=== { selector, index } throws a clear error when the index is out of range ===');
  {
    const page = await freshPage();
    const message = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      try {
        await cursor.click({ selector: '[id="dup-btn"]', index: 99 });
        return null;
      } catch (e) {
        return e.message;
      } finally {
        cursor.destroy();
      }
    });
    check('error mentions the index and how many matches were found', typeof message === 'string' && message.includes('index 99') && message.includes('found 3'));
    await page.close();
  }

  console.log('=== { selector, index } combined with frame resolves inside an iframe ===');
  {
    const page = await freshPage();
    const value = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.type({ selector: '#iframe-input', index: 0, frame: '#test-iframe' }, 'combined');
      cursor.destroy();
      return document.getElementById('test-iframe').contentDocument.getElementById('iframe-input').value;
    });
    check('index + frame together resolve correctly', value === 'combined');
    await page.close();
  }

  console.log('=== waitFor with state: "gone" waits for an element to disappear ===');
  {
    const page = await freshPage();
    const found = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      document.getElementById('stale-btn').click(); // triggers the 300ms async swap
      await cursor.waitFor('#stale-btn', { state: 'gone', timeout: 2000 });
      cursor.destroy();
      return document.getElementById('stale-btn') === null;
    });
    check('waitFor resolves once the stale element is actually removed', found === true);
    await page.close();
  }

  console.log('=== REGRESSION SCENARIO: without waitFor, the next click can hit the stale element ===');
  {
    const page = await freshPage();
    const clickedStale = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2 });
      let staleWasClicked = false;
      document.getElementById('stale-btn').addEventListener('click', () => {
        // the FIRST click (intentional); a second click landing here too
        // means the "next step" hit the stale button instead of #fresh-btn
      });
      await cursor.run([
        { type: 'click', target: '#stale-btn' }, // triggers the 300ms async swap
        // no waitFor here on purpose — demonstrates the exact race condition
      ]);
      // Immediately try to interact with what SHOULD be the new element —
      // reflects "the next step ran before the page finished updating".
      try {
        await cursor.click('#fresh-btn');
        return false; // if this succeeds, the swap already happened in time (not the race we're demonstrating)
      } catch {
        staleWasClicked = document.getElementById('stale-btn') !== null; // old element still present
        return staleWasClicked;
      } finally {
        cursor.destroy();
      }
    });
    check('demonstrates the race: #fresh-btn is not there yet, old element may still linger', clickedStale === true);
    await page.close();
  }

  console.log('=== FIX: waitFor(state: "gone") then the new element correctly resolves the race ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2 });
      let freshClicked = false;
      await cursor.run([
        { type: 'click', target: '#stale-btn' },
        { type: 'waitFor', target: '#stale-btn', options: { state: 'gone', timeout: 2000 } },
        { type: 'waitFor', target: '#fresh-btn', options: { timeout: 2000 } },
        { type: 'click', target: '#fresh-btn' },
      ]);
      cursor.destroy();
      return {
        staleGone: document.getElementById('stale-btn') === null,
        freshExists: document.getElementById('fresh-btn') !== null,
      };
    });
    check('with waitFor in between, the stale element is confirmed gone first', result.staleGone === true);
    check('and the new element exists and gets clicked correctly', result.freshExists === true);
    await page.close();
  }

  console.log('=== waitFor(state: "gone") times out with a clear message if the element never disappears ===');
  {
    const page = await freshPage();
    const message = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      try {
        await cursor.waitFor('#top-btn', { state: 'gone', timeout: 200 }); // never removed
        return null;
      } catch (e) {
        return e.message;
      } finally {
        cursor.destroy();
      }
    });
    check('error message says "disappear", not "appear"', typeof message === 'string' && message.includes('disappear'));
    await page.close();
  }

  console.log('=== click() resolves { selector, text } targets (button/link identified by visible text) ===');
  {
    const page = await freshPage();
    const clicked = await page.evaluate(async () => {
      let wasClicked = false;
      const buttons = document.querySelectorAll('button');
      buttons.forEach((b) => {
        if (b.textContent.trim() === 'Text Only') b.addEventListener('click', () => { wasClicked = true; });
      });
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click({ selector: 'button', text: 'Text Only' });
      cursor.destroy();
      return wasClicked;
    });
    check('clicks the button matching that exact text', clicked === true);
    await page.close();
  }

  console.log('=== { selector, text, index } disambiguates buttons sharing identical text ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.trim() === 'Same Text');
      let clickedIndex = null;
      buttons.forEach((b, i) => b.addEventListener('click', () => { clickedIndex = i; }));
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click({ selector: 'button', text: 'Same Text', index: 1 });
      cursor.destroy();
      return clickedIndex;
    });
    check('clicks specifically the second of the two identically-labeled buttons', result === 1);
    await page.close();
  }

  console.log('=== { selector, text } throws a clear error when no element has that text ===');
  {
    const page = await freshPage();
    const message = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      try {
        await cursor.click({ selector: 'button', text: 'Does Not Exist Anywhere' });
        return null;
      } catch (e) {
        return e.message;
      } finally {
        cursor.destroy();
      }
    });
    check('error mentions the missing text and the selector', typeof message === 'string' && message.includes('Does Not Exist Anywhere') && message.includes('button'));
    await page.close();
  }

  console.log('=== { selector, text } combined with frame resolves inside an iframe ===');
  {
    const page = await freshPage();
    const clicked = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click({ selector: '#iframe-btn', frame: '#test-iframe' }); // sanity: plain id+frame still works
      const iframe = document.getElementById('test-iframe');
      // Add a text-only button inside the iframe on the fly to test the combo.
      const btn = iframe.contentDocument.createElement('button');
      btn.textContent = 'Inner Text Button';
      let wasClicked = false;
      btn.addEventListener('click', () => { wasClicked = true; });
      iframe.contentDocument.body.appendChild(btn);
      await cursor.click({ selector: 'button', text: 'Inner Text Button', frame: '#test-iframe' });
      cursor.destroy();
      return wasClicked;
    });
    check('text + frame together resolve correctly inside the iframe', clicked === true);
    await page.close();
  }

  console.log('=== REGRESSION CHECK: clicking a button that reloads the IFRAME itself (not the top page) ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      // Triggers a real navigation scoped to just the iframe's own window
      // (window.location.href inside the iframe) — the top page's URL never
      // changes, but the iframe's contentDocument gets replaced entirely
      // once the new page finishes loading, ~200ms later.
      await cursor.click({ selector: '#reload-btn', frame: '#test-iframe' });
      let waitForError = null;
      let found = null;
      try {
        found = await cursor.waitFor({ selector: '#new-content-btn', frame: '#test-iframe' }, { timeout: 3000 });
      } catch (e) {
        waitForError = e.message;
      }
      cursor.destroy();
      return { foundId: found && found.id, waitForError };
    });
    check('waitFor correctly picks up the new iframe document after it reloads, not a stale one', result.foundId === 'new-content-btn');
    if (result.waitForError) console.log('    (waitFor error was:', result.waitForError, ')');
    await page.close();
  }

  console.log('=== NEW SCENARIO: without any wait, the next click can hit the STALE iframe button ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2 });
      const iframe = document.getElementById('test-iframe');
      const oldDoc = iframe.contentDocument;
      await cursor.click({ selector: '#reload-btn', frame: '#test-iframe' }); // starts a 200ms reload
      // Immediately try to click something in what SHOULD be the new
      // content — no wait in between, reflecting "moved to the next step
      // before the iframe finished refreshing".
      const stillOldDoc = iframe.contentDocument === oldDoc;
      let clickError = null;
      try {
        await cursor.click({ selector: '#new-content-btn', frame: '#test-iframe' });
      } catch (e) {
        clickError = e.message;
      }
      cursor.destroy();
      return { stillOldDoc, clickError };
    });
    check('demonstrates the race: the iframe genuinely had not reloaded yet at that instant', result.stillOldDoc === true);
    check('the immediate next click fails to find the new content (proves the race is real, not just theoretical)', typeof result.clickError === 'string');
    await page.close();
  }

  console.log('=== FIX: waitForFrameReload() resolves the exact race, no need to know the old element at all ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2 });
      let newBtnClicked = false;
      await cursor.run([
        { type: 'click', target: { selector: '#reload-btn', frame: '#test-iframe' } },
        { type: 'waitForFrameReload', target: '#test-iframe', options: { timeout: 3000 } },
        { type: 'click', target: { selector: '#new-content-btn', frame: '#test-iframe' } },
      ]);
      newBtnClicked = document.getElementById('test-iframe').contentWindow.__newContentButtonClicked === true;
      cursor.destroy();
      return newBtnClicked;
    });
    check('the new iframe content button gets clicked correctly after waiting for the reload', result === true);
    await page.close();
  }

  console.log('=== waitForFrameReload() also works when the trigger click is OUTSIDE the iframe ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2 });
      await cursor.run([
        { type: 'click', target: '#reload-iframe-from-outside' }, // plain top-level button, no frame
        { type: 'waitForFrameReload', target: '#test-iframe', options: { timeout: 3000 } },
        { type: 'click', target: { selector: '#new-content-btn', frame: '#test-iframe' } },
      ]);
      const clicked = document.getElementById('test-iframe').contentWindow.__newContentButtonClicked === true;
      cursor.destroy();
      return clicked;
    });
    check('works the same regardless of where the triggering click happened', result === true);
    await page.close();
  }

  console.log('=== AUTOMATIC: autoWaitForIframeReload catches the race with NO manual wait step at all ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2, autoWaitForIframeReload: true });
      // Trigger is INSIDE the iframe — no waitFor/waitForFrameReload step
      // anywhere in this sequence at all. This is exactly the bookmarklet
      // scenario: the person just clicks through the page normally.
      await cursor.run([
        { type: 'click', target: { selector: '#reload-btn', frame: '#test-iframe' } },
        { type: 'click', target: { selector: '#new-content-btn', frame: '#test-iframe' } },
      ]);
      const clicked = document.getElementById('test-iframe').contentWindow.__newContentButtonClicked === true;
      cursor.destroy();
      return clicked;
    });
    check('the new content button gets clicked correctly with zero manual intervention', result === true);
    await page.close();
  }

  console.log('=== AUTOMATIC: also catches it when the trigger click is OUTSIDE the iframe ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2, autoWaitForIframeReload: true });
      await cursor.run([
        { type: 'click', target: '#reload-iframe-from-outside' }, // plain top-level button
        { type: 'click', target: { selector: '#new-content-btn', frame: '#test-iframe' } },
      ]);
      const clicked = document.getElementById('test-iframe').contentWindow.__newContentButtonClicked === true;
      cursor.destroy();
      return clicked;
    });
    check('works automatically even when the trigger is outside the iframe', result === true);
    await page.close();
  }

  console.log('=== AUTOMATIC: is off by default (opt-in), so existing behavior is unchanged unless enabled ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2 }); // no autoWaitForIframeReload set
      let clickError = null;
      try {
        await cursor.run([
          { type: 'click', target: { selector: '#reload-btn', frame: '#test-iframe' } },
          { type: 'click', target: { selector: '#new-content-btn', frame: '#test-iframe' } },
        ]);
      } catch (e) {
        clickError = e.message;
      }
      cursor.destroy();
      return clickError;
    });
    check('without opting in, the race still happens exactly as before (no surprise behavior change)', typeof result === 'string');
    await page.close();
  }

  console.log('=== AUTOMATIC: adds no meaningful delay when nothing actually reloads ===');
  {
    const page = await freshPage();
    const elapsedMs = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 2, clickPause: 2, autoWaitForIframeReload: true });
      const start = performance.now();
      await cursor.click('#top-btn'); // an ordinary click, nothing reloads as a result
      const elapsed = performance.now() - start;
      cursor.destroy();
      return elapsed;
    });
    check('a plain click that triggers no reload stays fast (well under the reload timeout)', elapsedMs < 1000);
    await page.close();
  }

  console.log('=== waitForFrameReload() times out with a clear message if the iframe never reloads ===');
  {
    const page = await freshPage();
    const message = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      try {
        await cursor.waitForFrameReload('#test-iframe', { timeout: 200 }); // nothing triggers a reload here
        return null;
      } catch (e) {
        return e.message;
      } finally {
        cursor.destroy();
      }
    });
    check('error mentions the iframe selector and "reload"', typeof message === 'string' && message.includes('#test-iframe') && message.includes('reload'));
    await page.close();
  }

  console.log('=== REGRESSION CHECK: a button OUTSIDE the iframe reloading the iframe still works with waitFor ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      // The trigger is a plain top-level button — no `frame` on this step at
      // all, since the button itself lives on the parent page, not inside
      // the iframe. Only the iframe's own content changes as a result.
      await cursor.click('#reload-iframe-from-outside');
      let waitForError = null;
      let found = null;
      try {
        found = await cursor.waitFor({ selector: '#new-content-btn', frame: '#test-iframe' }, { timeout: 3000 });
      } catch (e) {
        waitForError = e.message;
      }
      cursor.destroy();
      return { foundId: found && found.id, waitForError };
    });
    check('waitFor correctly picks up the new iframe document even though the trigger click was outside it', result.foundId === 'new-content-btn');
    if (result.waitForError) console.log('    (waitFor error was:', result.waitForError, ')');
    await page.close();
  }

  console.log('=== REGRESSION CHECK: waitFor(state: "gone") also follows the iframe through its own reload ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.click({ selector: '#reload-btn', frame: '#test-iframe' });
      let gone = false, appeared = false;
      try {
        await cursor.waitFor({ selector: '#iframe-btn', frame: '#test-iframe' }, { state: 'gone', timeout: 3000 });
        gone = true;
        const el = await cursor.waitFor({ selector: '#new-content-btn', frame: '#test-iframe' }, { timeout: 3000 });
        appeared = !!el;
      } catch { /* leave flags as-is, checked below */ }
      cursor.destroy();
      return { gone, appeared };
    });
    check('confirms the old iframe button is gone after the reload', result.gone === true);
    check('and the new content is found afterward', result.appeared === true);
    await page.close();
  }

  console.log('=== a bad frame selector produces a clear error, not a silent no-op ===');
  {
    const page = await freshPage();
    const message = await page.evaluate(async () => {
      const cursor = new window.PagePilot({ moveDuration: 4, clickPause: 4 });
      try {
        await cursor.click({ selector: '#iframe-btn', frame: '#does-not-exist' });
        return null;
      } catch (e) {
        return e.message;
      } finally {
        cursor.destroy();
      }
    });
    check('throws a clear error for a missing iframe', typeof message === 'string' && message.includes('no iframe matches'));
    await page.close();
  }

  intentionalClose = true;
  await browser.close();
  server.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
