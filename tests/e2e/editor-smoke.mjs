#!/usr/bin/env bun
/**
 * Milkdown editor smoke test.
 *
 * Not part of `bun run test`: Playwright is intentionally not a project
 * dependency. Run it against the dev stack with Playwright available:
 *
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
 *   NANA_E2E_EMAIL=qa-kanban@nana.local \
 *   NANA_E2E_PASSWORD='…' \
 *   bun tests/e2e/editor-smoke.mjs
 *
 * `PLAYWRIGHT_MODULE` may point at an installed `playwright` package or be
 * omitted when `playwright` is resolvable from the current directory.
 * Screenshots land in `.playwright-mcp/`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.NANA_E2E_BASE_URL || 'http://127.0.0.1:3000';
const email = process.env.NANA_E2E_EMAIL;
const password = process.env.NANA_E2E_PASSWORD;
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';

if (!email || !password) {
  console.error('Set NANA_E2E_EMAIL and NANA_E2E_PASSWORD before running the editor smoke test.');
  process.exit(2);
}

const { chromium } = await import(playwrightModule);
const screenshotDir = path.resolve('.playwright-mcp');
await fs.mkdir(screenshotDir, { recursive: true });

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

const login = await api('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: email, password }),
});

const slug = `editor-smoke-${Date.now()}`;
const created = await api('/api/v1/records/documents', {
  method: 'POST',
  headers: { Authorization: login.token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Editor Smoke', slug, content: 'Hello world' }),
});

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
});
const errors = [];

async function openEditor(viewport, mode) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ token, record, mode }) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record }));
    localStorage.setItem('editorViewMode', mode);
  }, { token: login.token, record: login.record, mode });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${baseUrl}/document/${created.id}`, { waitUntil: 'networkidle' });
  await page.locator('.ProseMirror').waitFor();
  return { context, page };
}

async function selectWord(page, locator, letters) {
  await locator.click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  for (let index = 0; index < letters; index += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
}

async function caretAtEnd(page, locator) {
  await locator.click();
  await page.waitForTimeout(80);
  await page.keyboard.press('End');
  await page.waitForTimeout(40);
}

try {
  const { context, page } = await openEditor({ width: 1440, height: 900 }, 'wysiwyg');
  const prose = page.locator('.ProseMirror');

  // Markdown input rule.
  await caretAtEnd(page, prose.locator(':scope > p').first());
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Heading from input rule ');
  await page.waitForTimeout(350);
  assert.equal((await prose.locator('h2').last().innerText()).trim(), 'Heading from input rule');

  // Toolbar bold.
  await selectWord(page, prose.locator(':scope > p').first(), 5);
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.waitForTimeout(300);
  assert.match(await prose.locator(':scope > p').first().innerHTML(), /<strong>Hello<\/strong>/);

  // Split source ↔ WYSIWYG sync.
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  await page.waitForTimeout(300);
  await page.locator('.cm-content').click();
  await page.waitForTimeout(80);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Source line');
  await page.waitForTimeout(500);
  assert.ok((await prose.innerText()).includes('Source line'), 'WYSIWYG pane did not receive source edits');

  await caretAtEnd(page, prose.locator(':scope > p').last());
  await page.keyboard.press('Enter');
  await page.keyboard.type('Wysiwyg line');
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.cm-content').innerText()).includes('Wysiwyg line'), 'source pane did not receive WYSIWYG edits');

  // Slash menu.
  const h2Before = await prose.locator('h2').count();
  await caretAtEnd(page, prose.locator(':scope > p').last());
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.locator('[role="menu"][aria-label="Insert block"]').waitFor();
  await page.keyboard.type('heading 2');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  assert.equal(await prose.locator('h2').count(), h2Before + 1, 'slash menu did not insert a heading');
  assert.ok(!(await prose.innerText()).includes('/heading 2'));

  // Link popover.
  await selectWord(page, prose.locator(':scope > p').first(), 5);
  await page.waitForTimeout(120);
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByLabel('Link address').fill('https://example.org');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(300);
  assert.equal(await prose.locator('a[href="https://example.org"]').innerText(), 'Hello');

  // Task checkbox.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] Click me');
  await page.waitForTimeout(500);
  const task = prose.locator('li[data-item-type="task"]').last();
  const box = await task.boundingBox();
  assert.ok(box, 'task item has no box');
  await page.mouse.click(box.x + 8, box.y + 12);
  await page.waitForTimeout(300);
  assert.equal(await task.getAttribute('data-checked'), 'true');

  await page.screenshot({ path: path.join(screenshotDir, 'editor-smoke-desktop.png'), fullPage: true });

  // Read-only mode is not editable.
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await prose.getAttribute('contenteditable'), 'false');
  const before = await prose.innerText();
  await prose.click();
  await page.keyboard.type('SHOULD NOT APPEAR');
  await page.waitForTimeout(200);
  assert.equal(await prose.innerText(), before);

  // Autosave persisted Markdown.
  await page.waitForTimeout(2200);
  const saved = await api(`/api/v1/records/documents/${created.id}`, {
    headers: { Authorization: login.token },
  });
  assert.ok(saved.content.includes('## Heading from input rule'), 'autosave did not persist the heading');
  assert.ok(saved.content.includes('Click me'), 'autosave did not persist the task');

  await context.close();

  // Mobile screenshot and basic editor availability.
  const mobile = await openEditor({ width: 390, height: 844 }, 'wysiwyg');
  assert.equal(await mobile.page.locator('.ProseMirror').count(), 1);
  assert.ok(await mobile.page.getByRole('toolbar', { name: 'Formatting' }).isVisible());
  await mobile.page.screenshot({ path: path.join(screenshotDir, 'editor-smoke-mobile.png'), fullPage: true });
  await mobile.context.close();

  if (errors.length) {
    throw new Error(`Browser errors:\n${errors.join('\n')}`);
  }
  console.log('Editor smoke passed. Screenshots: .playwright-mcp/editor-smoke-desktop.png, editor-smoke-mobile.png');
} finally {
  await browser.close();
  await fetch(`${baseUrl}/api/v1/records/documents/${created.id}`, {
    method: 'DELETE',
    headers: { Authorization: login.token },
  }).catch(() => undefined);
}
