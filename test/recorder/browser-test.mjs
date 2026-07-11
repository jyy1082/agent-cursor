/**
 * Real-browser regression suite for page-pilot-recorder.
 *
 * Why this exists: the recorder's early bugs (typing silently lost when a
 * field was already focused before start(), typing lost when focus moved to
 * a <select> without an observable focusout, a click on the recorder's own
 * Stop button getting self-recorded) ALL passed a full jsdom test suite —
 * jsdom's synthetic event dispatch doesn't reproduce real browser focus
 * timing closely enough to catch them. These tests drive an actual Chromium
 * instance via Playwright and interact with the page the way a real user
 * would (page.fill(), page.click(), page.selectOption(), keyboard.press()),
 * which is what actually exposed the bugs in the first place.
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
const ROOT = path.resolve(__dirname, '../..');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.error('  FAIL -', name); }
}

// --- tiny static file server, no dependencies -------------------------------
function startServer() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = req.url === '/' ? '/test/recorder/fixture.html' : req.url;
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
  const browser = await chromium.launch({
    executablePath,
    args: launchArgs,
    headless: true,
  });
  let intentionalClose = false;
  browser.on('disconnected', () => {
    if (!intentionalClose) console.error('[browser] disconnected unexpectedly');
  });

  async function freshPage() {
    const page = await browser.newPage();
    await page.goto(`${base}/test/recorder/fixture.html`);
    await page.evaluate(() => window.__recorder.start());
    return page;
  }

  async function stopAndGetSteps(page) {
    await page.click('#stop-btn');
    return page.evaluate(() => window.__lastSteps);
  }

  console.log('=== real click recording ===');
  {
    const page = await freshPage();
    await page.click('#submit-btn');
    const steps = await stopAndGetSteps(page);
    check('records a click step', steps.some((s) => s.type === 'click' && s.target === '#submit-btn'));
    await page.close();
  }

  console.log('=== real typing recording (the original bug report) ===');
  {
    const page = await freshPage();
    await page.click('#name-input');
    await page.keyboard.type('Jane Cooper');
    await page.selectOption('#country-select', 'us'); // moves focus away from the input
    const steps = await stopAndGetSteps(page);
    check('captures the typed text', steps.some((s) => s.type === 'type' && s.text === 'Jane Cooper'));
    check('captures the select', steps.some((s) => s.type === 'select' && s.value === 'us'));
    check('no noisy click step for focusing the text field', !steps.some((s) => s.type === 'click' && s.target === '#name-input'));
    await page.close();
  }

  console.log('=== REGRESSION: field already focused before start() ===');
  {
    const page = await browser.newPage();
    await page.goto(`${base}/test/recorder/fixture.html`);
    await page.click('#name-input'); // focus it BEFORE recording starts
    await page.evaluate(() => window.__recorder.start());
    await page.keyboard.type('Already Focused');
    await page.click('#country-select');
    const steps = await stopAndGetSteps(page);
    check('captures typing even when the field was already focused', steps.some((s) => s.type === 'type' && s.text === 'Already Focused'));
    await page.close();
  }

  console.log('=== REGRESSION: type then click Stop directly (no intermediate click elsewhere) ===');
  {
    const page = await freshPage();
    await page.click('#name-input');
    await page.keyboard.type('Direct To Stop');
    const steps = await stopAndGetSteps(page); // clicking #stop-btn IS the very next real interaction
    check('captures typing even when Stop is clicked immediately after typing', steps.some((s) => s.type === 'type' && s.text === 'Direct To Stop'));
    check('does not record a click on the ignored Stop button', !steps.some((s) => s.type === 'click' && s.target?.includes('stop-btn')));
    await page.close();
  }

  console.log('=== real checkbox recording ===');
  {
    const page = await freshPage();
    await page.check('#agree-checkbox');
    const steps = await stopAndGetSteps(page);
    check('records a check step', steps.some((s) => s.type === 'check' && s.checked === true));
    check('does not also record a raw click for the checkbox', !steps.some((s) => s.type === 'click' && s.target?.includes('agree-checkbox')));
    await page.close();
  }

  console.log('=== real radio recording ===');
  {
    const page = await freshPage();
    await page.check('#radio-a');
    const steps = await stopAndGetSteps(page);
    check('records a check step for the radio', steps.some((s) => s.type === 'check' && s.target === '#radio-a' && s.checked === true));
    await page.close();
  }

  console.log('=== real keyboard shortcut recording ===');
  {
    const page = await freshPage();
    await page.click('#name-input');
    await page.keyboard.press('Enter');
    const steps = await stopAndGetSteps(page);
    check('records Enter as a pressKey step', steps.some((s) => s.type === 'pressKey' && s.key === 'Enter'));
    await page.close();
  }

  console.log('=== real scroll recording ===');
  {
    const page = await freshPage();
    await page.evaluate(() => { document.getElementById('scroll-box').scrollTop = 500; });
    await page.waitForTimeout(400); // let the debounce settle
    const steps = await stopAndGetSteps(page);
    check('records a scroll step', steps.some((s) => s.type === 'scroll'));
    await page.close();
  }

  console.log('=== NEW: chooseOption merge detection (custom dropdown) ===');
  {
    const page = await freshPage();
    await page.click('#plan-trigger'); // opens the menu (display:none -> block)
    await page.click('.menu-opt[data-value="pro"]'); // picks an option inside it
    const steps = await stopAndGetSteps(page);
    check('merges into a single chooseOption step', steps.length === 1 && steps[0].type === 'chooseOption');
    check('trigger target is correct', steps[0]?.target === '#plan-trigger');
    check('option selector uses the stable data-value attribute, not a structural fallback',
      steps[0]?.option === 'div[data-value="pro"]' && !steps[0]?.fragile);
    check('captures a waitAfterOpen timing hint', typeof steps[0]?.options?.waitAfterOpen === 'number');
    await page.close();
  }

  console.log('=== NEW: chooseOption does NOT merge unrelated clicks ===');
  {
    const page = await freshPage();
    await page.click('#submit-btn'); // an ordinary click, nothing opens as a result
    await page.click('#plan-trigger'); // a second, unrelated click
    const steps = await stopAndGetSteps(page);
    check('both stay as separate click steps (no false-positive merge)',
      steps.length === 2 && steps.every((s) => s.type === 'click'));
    await page.close();
  }

  console.log('=== NEW: chooseOption merge is skipped if another step happens in between ===');
  {
    const page = await freshPage();
    await page.click('#plan-trigger'); // opens the menu
    await page.check('#agree-checkbox'); // an unrelated step happens in between
    await page.click('.menu-opt[data-value="pro"]');
    const steps = await stopAndGetSteps(page);
    check('trigger click stays separate (not merged) since something happened in between',
      steps.some((s) => s.type === 'click' && s.target === '#plan-trigger'));
    check('the check step is still there too', steps.some((s) => s.type === 'check'));
    check('the option click is recorded on its own, not merged', steps.some((s) => s.type === 'click' && s.target?.includes('data-value')));
    await page.close();
  }

  console.log('=== NEW: chooseOption round-trip — recorded step actually replays correctly ===');
  {
    const page = await freshPage();
    await page.click('#plan-trigger');
    await page.click('.menu-opt[data-value="pro"]');
    const steps = await stopAndGetSteps(page);

    // Reset the trigger's label and close the menu, then replay the exact
    // recorded step through the real PagePilot playback engine.
    await page.evaluate(() => {
      document.getElementById('plan-trigger').textContent = 'Choose a plan';
      document.getElementById('plan-menu').style.display = 'none';
    });
    await page.addScriptTag({ url: '/src/page-pilot.js', type: 'module' }).catch(() => {});
    const replayedLabel = await page.evaluate(async (recordedSteps) => {
      const { PagePilot } = await import('/src/page-pilot.js');
      const cursor = new PagePilot({ moveDuration: 5, clickPause: 5 });
      await cursor.run(recordedSteps);
      cursor.destroy();
      return document.getElementById('plan-trigger').textContent;
    }, steps);
    check('replaying the recorded chooseOption step actually selects Pro', replayedLabel === 'Pro');
    await page.close();
  }

  console.log('=== NEW: dragTo recording ===');
  {
    const page = await freshPage();
    const source = await page.locator('#drag-source').boundingBox();
    const target = await page.locator('#drag-target').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await page.mouse.up();
    const steps = await stopAndGetSteps(page);
    check('records a dragTo step', steps.some((s) => s.type === 'dragTo'));
    const dragStep = steps.find((s) => s.type === 'dragTo');
    check('source target is correct', dragStep?.target === '#drag-source');
    check('destination resolves to the drop zone element', dragStep?.destination === '#drag-target');
    await page.close();
  }

  console.log('=== NEW: small mouse movement is NOT recorded as a drag (stays a click) ===');
  {
    const page = await freshPage();
    const box = await page.locator('#submit-btn').boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 6, box.y + 6); // tiny movement, below threshold
    await page.mouse.up();
    const steps = await stopAndGetSteps(page);
    check('no dragTo step for a near-stationary click', !steps.some((s) => s.type === 'dragTo'));
    check('recorded as a normal click instead', steps.some((s) => s.type === 'click' && s.target === '#submit-btn'));
    await page.close();
  }

  console.log('=== NEW: wait-hint (gapBefore) detection ===');
  {
    const page = await freshPage();
    await page.click('#submit-btn');
    await page.waitForTimeout(1500); // longer than the default 1200ms threshold
    await page.check('#agree-checkbox');
    const steps = await stopAndGetSteps(page);
    const checkStep = steps.find((s) => s.type === 'check');
    check('a long pause before a step attaches gapBefore', typeof checkStep?.gapBefore === 'number' && checkStep.gapBefore >= 1200);
    const clickStep = steps.find((s) => s.type === 'click');
    check('a step with no preceding pause has no gapBefore', clickStep && clickStep.gapBefore === undefined);
    await page.close();
  }

  console.log('=== NEW: duplicate ids are disambiguated by position ===');
  {
    const page = await freshPage();
    await page.locator('#dup-btn').nth(1).click(); // the second of the three duplicates
    const steps = await stopAndGetSteps(page);
    const step = steps.find((s) => s.type === 'click');
    check('target is an object with an index, not a bare #id string', typeof step.target === 'object' && step.target.index === 1);
    check('selector matches all three duplicates', step.target.selector === '[id="dup-btn"]');
    check('marked fragile (duplicate ids are inherently a markup smell)', step.fragile === true);
    await page.close();
  }

  console.log('=== NEW: duplicate-id round trip actually clicks the correct one on replay ===');
  {
    const page = await freshPage();
    await page.locator('#dup-btn').nth(2).click(); // the THIRD duplicate specifically
    const steps = await stopAndGetSteps(page);

    const clicked = await page.evaluate(async (recordedSteps) => {
      const buttons = document.querySelectorAll('#dup-btn');
      let clickedText = null;
      buttons.forEach((b) => b.addEventListener('click', () => { clickedText = b.textContent; }));
      const { PagePilot } = await import('/src/page-pilot.js');
      const cursor = new PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.run(recordedSteps);
      cursor.destroy();
      return clickedText;
    }, steps);
    check('replay clicks the exact duplicate that was recorded (the third one)', clicked === 'Third duplicate');
    await page.close();
  }

  console.log('=== NEW: buttons/links with no id/attributes get matched by their text ===');
  {
    const page = await freshPage();
    await page.getByText('No Identifiers Button', { exact: true }).click();
    const steps = await stopAndGetSteps(page);
    const step = steps.find((s) => s.type === 'click');
    check('target is an object with a text field, not a fragile structural selector', typeof step.target === 'object' && step.target.text === 'No Identifiers Button');
    check('selector is just the tag name', step.target.selector === 'button');
    check('not marked fragile since the text alone was unique', !step.fragile);
    await page.close();
  }

  console.log('=== NEW: duplicate text is disambiguated by index, same as duplicate ids ===');
  {
    const page = await freshPage();
    await page.getByText('Repeated Label', { exact: true }).nth(1).click(); // the second one
    const steps = await stopAndGetSteps(page);
    const step = steps.find((s) => s.type === 'click');
    check('target has both text and index', step.target.text === 'Repeated Label' && step.target.index === 1);
    check('marked fragile (duplicate visible text is worth a second look)', step.fragile === true);
    await page.close();
  }

  console.log('=== NEW: a plain <a> link with no attributes also gets a text-based target ===');
  {
    const page = await freshPage();
    await page.getByText('A Plain Link', { exact: true }).click();
    const steps = await stopAndGetSteps(page);
    const step = steps.find((s) => s.type === 'click');
    check('link selector is "a" with the matching text', step.target.selector === 'a' && step.target.text === 'A Plain Link');
    await page.close();
  }

  console.log('=== NEW: text-based target round trip actually clicks the right element on replay ===');
  {
    const page = await freshPage();
    await page.getByText('Repeated Label', { exact: true }).nth(1).click(); // second one, specifically
    const steps = await stopAndGetSteps(page);

    const clickedTexts = await page.evaluate(async (recordedSteps) => {
      window.__clickedTexts = [];
      const { PagePilot } = await import('/src/page-pilot.js');
      const cursor = new PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.run(recordedSteps);
      cursor.destroy();
      return window.__clickedTexts;
    }, steps);
    check('replay clicks exactly one element, the correct duplicate', clickedTexts.length === 1 && clickedTexts[0] === 'Repeated Label');
    await page.close();
  }

  console.log('=== SECURITY: password fields are never recorded ===');
  {
    const page = await freshPage();
    await page.click('#password-field');
    await page.keyboard.type('super-secret-123');
    await page.click('#submit-btn');
    const steps = await stopAndGetSteps(page);
    check('no type step exists for the password field', !steps.some((s) => s.type === 'type' && s.target?.includes('password')));
    check('the password itself never appears anywhere in the recorded output', !JSON.stringify(steps).includes('super-secret-123'));
    await page.close();
  }

  console.log('=== SECURITY: password field already focused before start() is still excluded ===');
  {
    const page = await browser.newPage();
    await page.goto(`${base}/test/recorder/fixture.html`);
    await page.click('#password-field');
    await page.evaluate(() => window.__recorder.start());
    await page.keyboard.type('another-secret');
    await page.click('#submit-btn');
    const steps = await stopAndGetSteps(page);
    check('still excluded even when focused before start()', !JSON.stringify(steps).includes('another-secret'));
    await page.close();
  }

  console.log('=== REGRESSION: multi-line textarea typing (Enter is a newline, not a shortcut) ===');
  {
    const page = await freshPage();
    await page.click('#bio');
    await page.keyboard.type('line one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line three');
    await page.click('#submit-btn'); // moves focus away, flushing the buffer
    const steps = await stopAndGetSteps(page);
    const typeStep = steps.find((s) => s.type === 'type' && s.target === '#bio');
    check('captures all three lines, not just the first', typeStep?.text === 'line one\nline two\nline three');
    check('Enter inside the textarea did not get recorded as its own pressKey step',
      !steps.some((s) => s.type === 'pressKey' && s.key === 'Enter'));
    await page.close();
  }

  console.log('=== same-origin iframe recording ===');
  {
    const page = await freshPage();
    // Give the recorder a moment to discover and attach to the iframe's
    // document (its content loads via a separate, async HTTP request) —
    // in real human-paced usage this is always ready well before anyone
    // could possibly click into it, but a scripted test can outrace it.
    await page.waitForFunction(() => window.__recorder._observedDocuments.size >= 2);
    const frame = page.frameLocator('#test-iframe');
    await frame.locator('#iframe-input').click();
    await page.keyboard.type('Hello iframe');
    await frame.locator('#iframe-btn').click();
    const steps = await stopAndGetSteps(page);

    const typeStep = steps.find((s) => s.type === 'type' && s.text === 'Hello iframe');
    check('captures typing inside the iframe', !!typeStep);
    check('typing step carries a frame marker', typeStep?.target?.frame === '#test-iframe');

    const clickStep = steps.find((s) => s.type === 'click' && s.target?.selector === '#iframe-btn');
    check('captures a click inside the iframe', !!clickStep);
    check('click step carries a frame marker', clickStep?.target?.frame === '#test-iframe');
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
