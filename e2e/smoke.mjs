#!/usr/bin/env node
/**
 * End-to-end smoke test: drives the real UI in Chromium against the local
 * backend (scripts/local-stack/server.mjs) — an instructor runs a demo session
 * while a student group plays through all ten periods.
 *
 *   1. start the local backend with the built app:
 *        npm run build   (with .env.local pointing at http://localhost:54321)
 *        DATABASE_URL=... node scripts/local-stack/server.mjs --reset \
 *          --instructor teacher@example.edu:secret123 --static dist --web-port 4173
 *   2. DATABASE_URL=... node e2e/smoke.mjs
 *
 * Screenshots are written to e2e/screenshots/.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.WEB_URL ?? 'http://localhost:54321';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/opec_local';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const errors = [];
const pages = [];
const log = (...a) => console.log('•', ...a);

async function newPage(browser, viewport = { width: 1366, height: 900 }, name = 'page') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  pages.push([name, page]);
  page.on('console', (m) => {
    if (m.type() === 'error' && !/websocket|realtime|WebSocket/i.test(m.text())) errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  return page;
}

const shot = (page, name, fullPage = true) => page.screenshot({ path: `${OUT}${name}.png`, fullPage });

async function main() {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const browser = await chromium.launch();

  // ------------------------------------------------------------ instructor
  const teacher = await newPage(browser, undefined, 'teacher');
  await teacher.goto(`${BASE}/`);
  await shot(teacher, '01-landing');
  await teacher.goto(`${BASE}/instructor`);
  await teacher.getByLabel(/E-mail/).fill('teacher@example.edu');
  await teacher.getByLabel(/Password/).fill('secret123');
  await teacher.getByRole('button', { name: 'Sign in' }).click();
  await teacher.getByRole('button', { name: /New game session/ }).click();
  await teacher.getByLabel('Session name').fill('E2E Demo');
  await teacher.getByRole('switch').first().click(); // demo mode
  await shot(teacher, '02-create-session', false);
  await teacher.getByRole('button', { name: 'Create session' }).click();
  await teacher.waitForURL(/\/instructor\/s\//);
  const sessionId = teacher.url().split('/s/')[1];
  log('session', sessionId);

  const { rows: codes } = await db.query(
    `select g.group_number, w.code as world, g.country_code, c.access_code from groups g join worlds w on w.id = g.world_id
       join group_controls c on c.group_id = g.id where g.session_id = $1 order by g.group_number`,
    [sessionId],
  );
  const me = codes.find((c) => c.world === 'A' && c.country_code === 'SAU'); // assignments are randomized
  log('student plays group', me.group_number, me.world, me.country_code);

  // ------------------------------------------------------------ student joins
  const student = await newPage(browser, { width: 1280, height: 900 }, 'student');
  await student.goto(`${BASE}/play`);
  await student.getByLabel('Group number').fill(String(me.group_number));
  await student.getByLabel('Access code').fill(me.access_code);
  await shot(student, '03-student-entry', false);
  await student.getByRole('button', { name: 'Continue' }).click();
  await student.getByRole('button', { name: 'Start Game' }).waitFor();
  await shot(student, '04-briefing');
  await student.getByRole('button', { name: 'Start Game' }).click();
  await student.getByText(/Waiting for the instructor/).waitFor();

  // second device for the same group → takeover dialog
  const second = await newPage(browser, { width: 1000, height: 800 }, 'second');
  await second.goto(`${BASE}/play`);
  await second.getByLabel('Group number').fill(String(me.group_number));
  await second.getByLabel('Access code').fill(me.access_code);
  await second.getByRole('button', { name: 'Continue' }).click();
  await second.getByText('This group is active on another device').waitFor();
  await shot(second, '05-takeover-prompt', false);
  await second.getByRole('button', { name: 'Cancel' }).click();
  await second.context().close();

  // ------------------------------------------------------------ start + period 1
  await teacher.getByRole('button', { name: 'Start game' }).click();
  await teacher.getByRole('button', { name: /Open Period 1/ }).waitFor();
  await teacher.getByLabel('Duration (minutes)').fill('5');
  await teacher.getByRole('button', { name: /Open Period 1/ }).click();
  await teacher.getByRole('button', { name: 'Close period now' }).waitFor();
  await shot(teacher, '06-instructor-control');

  await student.getByRole('tab', { name: /Production/ }).click();
  await student.getByLabel('Production (kb)').waitFor();
  await student.waitForFunction(() => !document.querySelector('#qty')?.hasAttribute('disabled'), null, { timeout: 15000 });
  await student.getByLabel('Production (kb)').fill('9000');
  await student.getByRole('button', { name: /Submit production/ }).click();
  await student.getByText(/Submitted: 9,000 kb/).waitFor();
  await shot(student, '07-production');

  const closePeriod = async () => {
    await teacher.getByRole('button', { name: 'Close period now' }).click();
    await teacher.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
    await teacher.getByText(/Open Period \d+|Open final rankings/).first().waitFor();
  };
  const openPeriod = async (n) => {
    await teacher.getByRole('button', { name: new RegExp(`Open Period ${n}`) }).click();
    await teacher.getByRole('button', { name: 'Close period now' }).waitFor();
  };
  await closePeriod();

  await student.getByRole('tab', { name: /Results/ }).click();
  await student.getByText('Period 1 results').waitFor({ timeout: 15000 });
  await shot(student, '08-results-p1');

  // period 2: buy a strategy card
  await openPeriod(2);
  await student.getByRole('tab', { name: /Country/ }).click();
  await student.getByRole('button', { name: /Buy card/ }).nth(1).waitFor();
  await student.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Buy card/.test(b.textContent ?? '') && !b.disabled), null, { timeout: 15000 });
  await student.getByRole('button', { name: /Buy card/ }).nth(1).click(); // capacity expansion
  await student.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await student.getByText('Activates in Period 4').waitFor({ timeout: 15000 });
  await shot(student, '09-country-cards');
  await closePeriod();

  // period 3: talk opens, pledge, chat, meeting, audit, review
  await teacher.getByRole('switch').first().click(); // enable chat
  await openPeriod(3);
  await teacher.getByRole('button', { name: 'Start meeting' }).click();
  await student.getByRole('tab', { name: /Production/ }).click();
  await student.getByLabel('Pledge (% of capacity)').waitFor();
  await student.waitForFunction(() => !document.querySelector('#pledge')?.hasAttribute('disabled'), null, { timeout: 15000 });
  await student.getByLabel('Pledge (% of capacity)').fill('75');
  await student.getByRole('button', { name: 'Publish pledge' }).click();
  await student.getByText(/Your pledge for Period 3/).waitFor({ timeout: 15000 });
  await student.getByRole('tab', { name: /Talk/ }).click();
  await student.getByPlaceholder(/Speak in the OPEC meeting/).waitFor({ timeout: 15000 });
  await student.getByPlaceholder(/Speak in the OPEC meeting/).fill('Proposal: everyone holds output at 75% this period.');
  await student.getByRole('button', { name: 'Send' }).first().click();
  await student.getByPlaceholder(/Message to World/).fill('Saudi Arabia will respect its pledge.');
  await student.getByRole('button', { name: 'Send' }).nth(1).click();
  await student.getByText('Saudi Arabia will respect its pledge.').waitFor();
  await shot(student, '10-talk');

  await student.getByRole('tab', { name: /Country/ }).click();
  await student.getByRole('combobox', { name: 'Target country' }).click();
  await student.getByRole('option').nth(1).click();
  await student.getByRole('combobox', { name: 'Closed period' }).click();
  await student.getByRole('option', { name: 'Period 2' }).click();
  await student.getByRole('button', { name: /Use audit/ }).click();
  await student.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await student.getByText(/produced .* of capacity in Period 2/).first().waitFor({ timeout: 15000 });
  await student.getByRole('button', { name: 'Request review' }).click();
  await student.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await student.waitForTimeout(2500);
  await closePeriod();

  // recession event and the remaining periods
  await teacher.getByRole('button', { name: 'Trigger' }).first().click();
  await teacher.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  for (let n = 4; n <= 10; n++) {
    await openPeriod(n);
    if (n === 4) {
      await student.getByRole('tab', { name: /Production/ }).click();
      await student.getByText('Production decision — Period 4').waitFor({ timeout: 15000 });
      await student.waitForFunction(() => !document.querySelector('#qty')?.hasAttribute('disabled'), null, { timeout: 15000 });
      await student.getByRole('slider', { name: 'Share of capacity' }).focus();
      await student.keyboard.press('End');
      await student.getByRole('button', { name: /Update submission|Submit production/ }).click();
      await student.getByText(/Submitted: 14,400 kb/).waitFor({ timeout: 15000 });
      await shot(student, '11-production-p4-expanded');
    }
    if (n === 5) {
      await teacher.getByRole('tab', { name: /Groups/ }).click();
      await shot(teacher, '12-instructor-groups');
      await teacher.getByRole('tab', { name: /Markets/ }).click();
      await shot(teacher, '13-instructor-markets');
      await teacher.getByRole('tab', { name: /Talk & cards/ }).click();
      await shot(teacher, '14-instructor-talk-cards');
      await teacher.getByRole('tab', { name: /Control/ }).click();
    }
    await closePeriod();
  }

  // ------------------------------------------------------------ end of game
  await student.getByRole('tab', { name: /Results/ }).click();
  await student.getByRole('link', { name: 'Open final rankings' }).waitFor({ timeout: 20000 });
  await shot(student, '15-student-results-final');
  await student.getByRole('tab', { name: /Notices/ }).click();
  await shot(student, '16-notices');

  await teacher.getByRole('link', { name: 'Open final rankings' }).click();
  await teacher.getByText('Final wealth by country and world').waitFor();
  await teacher.waitForTimeout(800);
  await shot(teacher, '17-final-rankings');

  // Traditional Chinese + mobile layout
  const mobileSeat = codes.find((c) => c.world === 'B' && c.country_code === 'NGA');
  const mobile = await browser.newContext({ ...require('playwright').devices['iPhone 13'] });
  const mp = await mobile.newPage();
  mp.on('pageerror', (e) => errors.push(`[mobile] ${e.message}`));
  await mp.goto(`${BASE}/play`);
  await mp.getByRole('main').getByRole('radio', { name: '中文' }).click();
  await mp.getByLabel('組別編號').fill(String(mobileSeat.group_number));
  await mp.getByLabel('存取碼').fill(mobileSeat.access_code);
  await mp.getByRole('button', { name: '繼續' }).click();
  await mp.getByRole('button', { name: '開始遊戲' }).click();
  await mp.getByRole('tab', { name: /結果/ }).click();
  await mp.waitForTimeout(800);
  await shot(mp, '18-mobile-zh-results');
  await mp.getByRole('tab', { name: /國家/ }).click();
  await shot(mp, '19-mobile-zh-country', false);

  const { rows: fin } = await db.query('select count(*)::int as n from final_results where session_id = $1', [sessionId]);
  log('final results rows', fin[0].n);
  await browser.close();
  await db.end();

  if (errors.length) {
    console.log('\nBrowser errors:');
    for (const e of errors) console.log('  ', e);
    process.exitCode = 1;
  } else {
    console.log('\nE2E smoke test passed, no browser errors. Screenshots in', OUT);
  }
}

main().catch(async (err) => {
  console.error(err);
  for (const [name, page] of pages) {
    await page.screenshot({ path: `${OUT}FAILED-${name}.png`, fullPage: true }).catch(() => {});
  }
  process.exit(1);
});
