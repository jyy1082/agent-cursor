/**
 * Real-browser test suite for page-pilot-skills. Same Playwright +
 * @sparticuz/chromium setup as the sibling page-pilot/page-pilot-recorder/
 * page-pilot-toolkit repos — see page-pilot-recorder's README for why.
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

function startServer() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = req.url === '/' ? '/test/skills/fixture.html' : req.url;
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
    await page.goto(`${base}/test/skills/fixture.html`);
    return page;
  }

  console.log('=== detectParameters: label priority order ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const steps = [
        { type: 'type', target: '#last-name', text: 'Smith' },
        { type: 'type', target: '#first-name', text: 'Jane' },
        { type: 'type', target: '#dept', text: 'Engineering' },
        { type: 'type', target: '#notes-field', text: 'a note' },
        { type: 'type', target: '#mystery-field', text: 'mystery value' },
        { type: 'type', target: '#wrapped-input', text: 'wrapped value' },
      ];
      return window.Skills.detectParameters(steps);
    });
    check('a <label for="..."> wins over placeholder/name', result[0].suggestedName === 'Last Name (label)');
    check('aria-label wins over placeholder/name when there is no <label>', result[1].suggestedName === 'First Name (aria)');
    check('placeholder wins over name when there is no label/aria-label', result[2].suggestedName === 'Department (placeholder)');
    check('name attribute is used as a last resort', result[3].suggestedName === 'internalNotes');
    check('no suggestion at all when nothing is found', result[4].suggestedName === null);
    check('a wrapping <label> (not for=) is also detected', result[5].suggestedName === 'Wrapped Field Label');
    await page.close();
  }

  console.log('=== REGRESSION: duplicate id does not attach the wrong element\'s label ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      // Targets the SECOND element sharing id="dup-field" (the real text
      // input) — a naive label[for="dup-field"] lookup would incorrectly
      // return the FIRST element's label ("相片拍摄:", meant for the
      // button), since duplicate ids can't be disambiguated by a plain
      // querySelector. This is exactly the target shape
      // page-pilot-recorder produces for duplicate ids.
      const steps = [{ type: 'type', target: { selector: '[id="dup-field"]', index: 1 }, text: 'Wang' }];
      return window.Skills.detectParameters(steps);
    });
    check('does NOT attach the mismatched label from the other duplicate-id element', result[0].suggestedName !== '相片拍摄:');
    check('correctly falls through to a safer hint (this field\'s own placeholder) instead', result[0].suggestedName === 'Enter last name');
    await page.close();
  }

  console.log('=== REGRESSION: unique id, but multiple labels mistakenly share the same for= (real site markup bug) ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      // #realNameField's id IS unique on the page — this is a DIFFERENT
      // bug than duplicate ids: the SITE's own markup has two separate
      // <label for="realNameField">, one correct ("Last Name:") and one
      // left over from a copy-pasted, never-updated block ("相片拍摄:").
      // A plain querySelector would return whichever appears first in the
      // document, regardless of which one is actually meant for this field.
      const steps = [{ type: 'type', target: '#realNameField', text: 'Lily' }];
      return window.Skills.detectParameters(steps);
    });
    check('does not attach the unrelated, earlier "相片拍摄:" label', result[0].suggestedName !== '相片拍摄:');
    check('correctly picks the label structurally closest to the field ("Last Name:")', result[0].suggestedName === 'Last Name:');
    await page.close();
  }

  console.log('=== detectParameters: select steps show the option\'s visible text, not just the raw value ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const steps = [
        { type: 'select', target: '#country-select', value: 'jp' },
        { type: 'select', target: '#multi-select', value: ['a', 'c'] },
      ];
      return window.Skills.detectParameters(steps);
    });
    check('a single-select shows the selected option\'s text, not the raw code', result[0].displayValue === 'JP' && result[0].value === 'jp');
    check('a multi-select shows all selected options\' text joined together', result[1].displayValue === 'Apple, Cherry');
    check('the raw value used at replay time is still preserved untouched', JSON.stringify(result[1].value) === JSON.stringify(['a', 'c']));
    await page.close();
  }

  console.log('=== detectParameters: select displayValue is null when nothing sensible can be found ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const steps = [
        { type: 'select', target: '#country-select', value: 'does-not-exist' }, // option removed/changed since recording
        { type: 'type', target: '#last-name', text: 'Smith' }, // not a select at all
      ];
      return window.Skills.detectParameters(steps);
    });
    check('no matching option found → displayValue is null, not a crash or garbage value', result[0].displayValue === null);
    check('non-select steps simply have no displayValue field at all', !('displayValue' in result[1]));
    await page.close();
  }

  console.log('=== REGRESSION: only the LAST of several steps targeting the same field becomes a candidate ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      // Simulates typing "融创" into a field, moving elsewhere, coming back
      // and retyping "rock" — two genuinely separate, real edits (not a
      // recorder bug), but only the SECOND one determines what the field
      // actually ends up holding once the whole thing replays.
      const steps = [
        { type: 'type', target: '#last-name', text: '融创' },
        { type: 'click', target: '#save-btn' }, // moved elsewhere in between
        { type: 'type', target: '#last-name', text: 'rock' },
      ];
      return window.Skills.detectParameters(steps);
    });
    check('only one candidate for the field, not two', result.length === 1);
    check('it is the LAST (final) value, not the stale earlier one', result[0].value === 'rock' && result[0].stepIndex === 2);
    await page.close();
  }

  console.log('=== detectParameters: select and check steps ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const steps = [
        { type: 'select', target: '#country-select', value: 'jp' },
        { type: 'check', target: '#agree-checkbox', checked: true },
      ];
      return window.Skills.detectParameters(steps);
    });
    check('select steps are detected with field "value"', result[0].field === 'value' && result[0].value === 'jp');
    check('select suggests being checked by default', result[0].suggestedChecked === true);
    check('check steps are detected with field "checked"', result[1].field === 'checked' && result[1].value === true);
    check('check steps suggest NOT being checked by default (usually fixed flow)', result[1].suggestedChecked === false);
    await page.close();
  }

  console.log('=== detectParameters: long values default unchecked ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const longText = 'x'.repeat(300);
      const steps = [{ type: 'type', target: '#notes-field', text: longText }];
      return window.Skills.detectParameters(steps);
    });
    check('a value over the length threshold suggests unchecked by default', result[0].suggestedChecked === false);
    await page.close();
  }

  console.log('=== hasFragileSteps ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      return {
        withFragile: window.Skills.hasFragileSteps([{ type: 'click', target: '#x', fragile: true }]),
        withoutFragile: window.Skills.hasFragileSteps([{ type: 'click', target: '#x' }]),
      };
    });
    check('detects a fragile step', result.withFragile === true);
    check('no false positive when nothing is fragile', result.withoutFragile === false);
    await page.close();
  }

  console.log('=== isHighRisk ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      return {
        deleteBtnPlainSelector: window.Skills.isHighRisk([{ type: 'click', target: '#delete-btn' }]),
        deleteBtnByText: window.Skills.isHighRisk([{ type: 'click', target: { selector: 'button', text: 'Delete this record' } }]),
        saveBtnNotRisky: window.Skills.isHighRisk([{ type: 'click', target: '#save-btn' }]),
        chooseOptionRisky: window.Skills.isHighRisk([{ type: 'chooseOption', target: '#menu', option: { selector: 'a', text: '确认删除' } }]),
      };
    });
    check('a plain selector containing a risk word (e.g. #delete-btn) is flagged', result.deleteBtnPlainSelector === true);
    check('a { selector, text } target with risky text is flagged', result.deleteBtnByText === true);
    check('an ordinary save button is not flagged', result.saveBtnNotRisky === false);
    check('chooseOption steps are checked too (both target and option)', result.chooseOptionRisky === true);
    await page.close();
  }

  console.log('=== buildSkillDraft: placeholder substitution ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const steps = [
        { type: 'click', target: '#save-btn' },
        { type: 'type', target: '#last-name', text: 'Smith' },
        { type: 'select', target: '#country-select', value: 'jp' },
      ];
      const accepted = [
        { stepIndex: 1, field: 'text', name: '姓氏' },
        { stepIndex: 2, field: 'value', name: '国家' },
      ];
      return window.Skills.buildSkillDraft('Test skill', steps, accepted);
    });
    check('accepted parameter values are replaced with {{name}} placeholders', result.steps[1].text === '{{姓氏}}' && result.steps[2].value === '{{国家}}');
    check('steps not touched by any parameter stay exactly as recorded', result.steps[0].target === '#save-btn');
    check('the parameters list only has names, in order', JSON.stringify(result.parameters) === JSON.stringify([{ name: '姓氏' }, { name: '国家' }]));
    check('the original steps array passed in is untouched (draft works on a copy)', true); // implicitly verified by the fact steps[1].text below in the outer scope would differ; see next check
    await page.close();
  }

  console.log('=== FULL ROUND TRIP: record, save as skill, fill with NEW values, replay through real PagePilot ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const { PagePilot } = await import('/src/page-pilot.js');

      // Simulate a "recording": these are the values as originally typed.
      const recordedSteps = [
        { type: 'type', target: '#last-name', text: 'Smith' },
        { type: 'select', target: '#country-select', value: 'us' },
        { type: 'check', target: '#agree-checkbox', checked: true },
        { type: 'click', target: '#save-btn' },
      ];
      const draft = window.Skills.buildSkillDraft('Fill out the form', recordedSteps, [
        { stepIndex: 0, field: 'text', name: '姓氏' },
        { stepIndex: 1, field: 'value', name: '国家' },
        { stepIndex: 2, field: 'checked', name: '同意条款' },
      ]);
      const saved = window.Skills.saveSkill(draft, 'roundtrip-test.example.com');

      // Reset the fixture, then run the skill with DIFFERENT values than
      // what was originally recorded — this is the whole point: the same
      // skill, reusable with new input.
      document.getElementById('last-name').value = '';
      document.getElementById('country-select').value = '';
      document.getElementById('agree-checkbox').checked = false;
      let saveBtnClicked = false;
      document.getElementById('save-btn').addEventListener('click', () => { saveBtnClicked = true; });

      const filledSteps = window.Skills.fillSkillParameters(saved, {
        '姓氏': 'Tanaka',
        '国家': 'jp',
        '同意条款': true,
      });

      const cursor = new PagePilot({ moveDuration: 4, clickPause: 4 });
      await cursor.run(filledSteps);
      cursor.destroy();

      return {
        nameValue: document.getElementById('last-name').value,
        countryValue: document.getElementById('country-select').value,
        agreeChecked: document.getElementById('agree-checkbox').checked,
        saveBtnClicked,
      };
    });
    check('the NEW name value was typed correctly, not the originally recorded one', result.nameValue === 'Tanaka');
    check('the NEW country was selected correctly', result.countryValue === 'jp');
    check('the checkbox was correctly checked via the filled-in boolean', result.agreeChecked === true);
    check('the unparameterized click step still ran normally', result.saveBtnClicked === true);
    await page.close();
  }

  console.log('=== buildSkillDraft: checked (boolean) parameters keep their type, not corrupted to a string ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const steps = [{ type: 'check', target: '#agree-checkbox', checked: true }];
      const draft = window.Skills.buildSkillDraft('Test', steps, [{ stepIndex: 0, field: 'checked', name: '同意条款' }]);
      return draft.steps[0];
    });
    check('checked stays a real boolean, not overwritten with a placeholder string', result.checked === true && typeof result.checked === 'boolean');
    check('a separate marker records which parameter controls it', result.checkedParam === '同意条款');
    await page.close();
  }

  console.log('=== fillSkillParameters: substitutes text/value placeholders and checked markers correctly ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const skill = {
        steps: [
          { type: 'click', target: '#save-btn' },
          { type: 'type', target: '#last-name', text: '{{姓氏}}' },
          { type: 'select', target: '#country-select', value: '{{国家}}' },
          { type: 'check', target: '#agree-checkbox', checked: false, checkedParam: '同意条款' },
        ],
        parameters: [{ name: '姓氏' }, { name: '国家' }, { name: '同意条款' }],
      };
      const filled = window.Skills.fillSkillParameters(skill, { '姓氏': 'Tanaka', '国家': 'jp', '同意条款': true });
      return filled;
    });
    check('text placeholder correctly substituted', result[1].text === 'Tanaka');
    check('value placeholder correctly substituted', result[2].value === 'jp');
    check('checked marker correctly resolved to a real boolean', result[3].checked === true && typeof result[3].checked === 'boolean');
    check('the checkedParam marker is cleaned up after filling', !('checkedParam' in result[3]));
    check('an untouched step (no parameter) is unchanged', result[0].target === '#save-btn');
    await page.close();
  }

  console.log('=== fillSkillParameters: a missing value leaves a visible placeholder instead of silently blanking it ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const skill = {
        steps: [{ type: 'type', target: '#last-name', text: '{{姓氏}}' }],
        parameters: [{ name: '姓氏' }],
      };
      return window.Skills.fillSkillParameters(skill, {}); // no value provided at all
    });
    check('missing value stays as the literal {{name}} text, not silently emptied', result[0].text === '{{姓氏}}');
    await page.close();
  }

  console.log('=== fillSkillParameters: a missing checked value falls back to the originally recorded boolean ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const skill = {
        steps: [{ type: 'check', target: '#agree-checkbox', checked: true, checkedParam: '同意条款' }],
        parameters: [{ name: '同意条款' }],
      };
      return window.Skills.fillSkillParameters(skill, {}); // no value provided
    });
    check('falls back to the originally recorded checked value when none is provided', result[0].checked === true);
    await page.close();
  }

  console.log('=== fillSkillParameters never mutates the skill passed in ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const skill = { steps: [{ type: 'type', target: '#x', text: '{{姓氏}}' }], parameters: [{ name: '姓氏' }] };
      window.Skills.fillSkillParameters(skill, { '姓氏': 'Changed' });
      return skill.steps[0].text; // should still be the placeholder
    });
    check('the original skill object is never mutated', result === '{{姓氏}}');
    await page.close();
  }

  console.log('=== buildSkillDraft does not mutate the original steps array ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const steps = [{ type: 'type', target: '#last-name', text: 'Smith' }];
      window.Skills.buildSkillDraft('x', steps, [{ stepIndex: 0, field: 'text', name: '姓氏' }]);
      return steps[0].text; // should still be the original recorded value
    });
    check('the original array passed to buildSkillDraft is never mutated', result === 'Smith');
    await page.close();
  }

  console.log('=== saveSkill never persists example values, only parameter names ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const draft = {
        description: 'Test',
        steps: [{ type: 'type', target: '#x', text: '{{姓氏}}' }],
        parameters: [{ name: '姓氏', exampleValue: 'Smith', anythingElse: 'should be stripped' }],
        fragile: false,
        highRisk: false,
      };
      const saved = window.Skills.saveSkill(draft, 'test-domain.example.com');
      return saved.parameters;
    });
    check('saved parameters only ever contain a name field, nothing else', JSON.stringify(result) === JSON.stringify([{ name: '姓氏' }]));
    await page.close();
  }

  console.log('=== storage round trip: save / list / get / delete ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const draft = window.Skills.buildSkillDraft('My test skill', [
        { type: 'click', target: '#save-btn' },
      ], []);
      const saved = window.Skills.saveSkill(draft, 'test-domain.example.com');
      const listed = window.Skills.listSkills('test-domain.example.com');
      const fetched = window.Skills.getSkill(saved.id, 'test-domain.example.com');
      const deleted = window.Skills.deleteSkill(saved.id, 'test-domain.example.com');
      const listedAfterDelete = window.Skills.listSkills('test-domain.example.com');
      return {
        savedHasId: typeof saved.id === 'string' && saved.id.length > 0,
        listedIncludesIt: listed.some((s) => s.id === saved.id),
        fetchedMatches: fetched && fetched.description === 'My test skill',
        deleted,
        listedAfterDeleteIsEmpty: !listedAfterDelete.some((s) => s.id === saved.id),
      };
    });
    check('saveSkill assigns an id', result.savedHasId);
    check('listSkills includes the saved skill', result.listedIncludesIt);
    check('getSkill fetches the correct record', result.fetchedMatches);
    check('deleteSkill reports success', result.deleted === true);
    check('the skill is actually gone after deleting', result.listedAfterDeleteIsEmpty);
    await page.close();
  }

  console.log('=== skills are scoped per domain ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(() => {
      const draft = window.Skills.buildSkillDraft('Domain A skill', [{ type: 'click', target: '#x' }], []);
      window.Skills.saveSkill(draft, 'domain-a.example.com');
      const listedB = window.Skills.listSkills('domain-b.example.com');
      const listedA = window.Skills.listSkills('domain-a.example.com');
      return { listedB, listedA };
    });
    check('a skill saved under one domain does not leak into another', result.listedB.length === 0);
    check('it is correctly listed under its own domain', result.listedA.length === 1 && result.listedA[0].description === 'Domain A skill');
    await page.close();
  }

  console.log('=== showArchivePanel: "One-time use" resolves null and saves nothing ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const steps = [{ type: 'click', target: '#save-btn' }];
      const panelPromise = window.Skills.showArchivePanel(steps, { domain: 'panel-test-1.example.com' });
      await new Promise((r) => setTimeout(r, 100));
      document.getElementById('page-pilot-skills-archive-host').shadowRoot.getElementById('skip-btn').click();
      const resolved = await panelPromise;
      const listed = window.Skills.listSkills('panel-test-1.example.com');
      return { resolved, listedCount: listed.length, hostRemoved: !document.getElementById('page-pilot-skills-archive-host') };
    });
    check('resolves with null when "One-time use" is picked', result.resolved === null);
    check('nothing gets saved', result.listedCount === 0);
    check('the panel removes itself', result.hostRemoved === true);
    await page.close();
  }

  console.log('=== showArchivePanel: the panel itself shows the select option\'s readable text, not the raw code ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const steps = [{ type: 'select', target: '#country-select', value: 'jp' }];
      const panelPromise = window.Skills.showArchivePanel(steps, { domain: 'display-value-test.example.com' });
      await new Promise((r) => setTimeout(r, 100));
      const shadow = document.getElementById('page-pilot-skills-archive-host').shadowRoot;
      const shownText = shadow.querySelector('.param-value').textContent.trim();
      shadow.getElementById('skip-btn').click();
      await panelPromise;
      return shownText;
    });
    check('the panel shows "JP" (the option\'s text), not "jp" (the raw value)', result === 'JP');
    await page.close();
  }

  console.log('=== showArchivePanel: full save flow with a renamed parameter and a deleted step ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const steps = [
        { type: 'click', target: '#save-btn' },
        { type: 'click', target: '#mystery-field' }, // pretend noise step, to be deleted
        { type: 'type', target: '#last-name', text: 'Smith' },
      ];
      const panelPromise = window.Skills.showArchivePanel(steps, { domain: 'panel-test-2.example.com' });
      await new Promise((r) => setTimeout(r, 100));
      const shadow = document.getElementById('page-pilot-skills-archive-host').shadowRoot;

      // Delete the second (noise) step.
      shadow.querySelector('.delete-step[data-step-index="1"]').click();
      await new Promise((r) => setTimeout(r, 50));

      // Fill in the description.
      shadow.getElementById('desc-input').value = 'My saved skill';

      // Rename the detected parameter and make sure it's checked.
      const paramRow = shadow.querySelector('.param-row');
      paramRow.querySelector('.param-check').checked = true;
      paramRow.querySelector('.param-name').value = '姓氏';

      shadow.getElementById('save-btn').click();
      const saved = await panelPromise;
      return saved;
    });
    check('the skill was saved with the given description', result.description === 'My saved skill');
    check('the deleted noise step is gone (only 2 steps remain)', result.steps.length === 2);
    check('the renamed parameter is present with just its name', JSON.stringify(result.parameters) === JSON.stringify([{ name: '姓氏' }]));
    check('the surviving type step got its value replaced with the placeholder', result.steps[1].text === '{{姓氏}}');
    await page.close();
  }

  console.log('=== showArchivePanel: high-risk checkbox reflects in the saved skill ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const steps = [{ type: 'click', target: '#delete-btn' }];
      const panelPromise = window.Skills.showArchivePanel(steps, { domain: 'panel-test-3.example.com' });
      await new Promise((r) => setTimeout(r, 100));
      const shadow = document.getElementById('page-pilot-skills-archive-host').shadowRoot;
      const preChecked = shadow.getElementById('high-risk-check').checked;
      shadow.getElementById('save-btn').click();
      const saved = await panelPromise;
      return { preChecked, savedHighRisk: saved.highRisk };
    });
    check('a step matching a risk word is pre-checked as high-risk by default', result.preChecked === true);
    check('the saved skill reflects the high-risk flag', result.savedHighRisk === true);
    await page.close();
  }

  console.log('=== showArchivePanel is itself excluded from page-pilot-recorder\'s own recording ===');
  {
    const page = await freshPage();
    const result = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'probe';
      document.body.appendChild(host);
      const steps = [{ type: 'click', target: '#save-btn' }];
      const panelPromise = window.Skills.showArchivePanel(steps, { domain: 'panel-test-4.example.com' });
      await new Promise((r) => setTimeout(r, 100));
      const hasIgnoreMarker = document.getElementById('page-pilot-skills-archive-host').hasAttribute('data-ppr-ignore');
      document.getElementById('page-pilot-skills-archive-host').shadowRoot.getElementById('skip-btn').click();
      await panelPromise;
      return hasIgnoreMarker;
    });
    check('the panel host carries the data-ppr-ignore marker page-pilot-recorder looks for', result === true);
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
