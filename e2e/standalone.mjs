#!/usr/bin/env node
/**
 * Browser test for the standalone build (npm run build:standalone): serves
 * dist-standalone/ and plays a solo game for two periods in Chromium.
 *
 *   node e2e/standalone.mjs            # plain static hosting
 *   CSP=strict node e2e/standalone.mjs # with a restrictive Content-Security-Policy
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = resolve(new URL('../dist-standalone', import.meta.url).pathname);
const OUT = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };
const CSP = {
  strict: "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com",
  nowasm: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
}[process.env.CSP ?? ''];

const server = http
  .createServer((req, res) => {
    let file = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...(CSP ? { 'content-security-policy': CSP } : {}) });
    res.end(readFileSync(file));
  })
  .listen(4180);

const errors = [];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  await page.goto('http://localhost:4180/');
  await page.getByRole('button', { name: /Start a new solo game/ }).click();
  await page.getByRole('button', { name: 'Start Game' }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Start Game' }).click();
  await page.getByRole('tab', { name: /Production/ }).click();
  for (const [n, q] of [[1, '9000'], [2, '8400']]) {
    await page.getByText(`Production decision — Period ${n}`).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('#qty')?.hasAttribute('disabled'), null, { timeout: 30000 });
    await page.getByLabel('Production (kb)').fill(q);
    await page.getByRole('button', { name: /Submit production|Update submission/ }).click();
    await page.getByText(new RegExp(`Submitted: ${Number(q).toLocaleString('en-US')} kb`)).waitFor({ timeout: 15000 });
    console.log(`period ${n}: submitted ${q}`);
  }
  await page.getByRole('tab', { name: /Results/ }).click();
  await page.getByText('Period 1 results').waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${OUT}standalone-results.png`, fullPage: true });
  console.log('period 1 results shown');
} catch (err) {
  await page.screenshot({ path: `${OUT}standalone-FAILED.png`, fullPage: true }).catch(() => {});
  errors.push(String(err.message ?? err).split('\n')[0]);
}
await browser.close();
server.close();
if (errors.length) {
  console.log('errors:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('standalone build OK');
