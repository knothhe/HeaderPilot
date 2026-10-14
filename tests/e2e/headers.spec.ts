import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let context: BrowserContext;
let server: Server;
let directory: string;
let origin: string;
let extensionUrl: string;
let popup: Page;
let network: Page;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-server', 'original');
    response.end(JSON.stringify(request.headers));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  origin = `http://127.0.0.1:${address.port}`;
  directory = await mkdtemp(join(tmpdir(), 'headerpilot-e2e-'));
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html`;
  popup = await context.newPage();
  await popup.setViewportSize({ width: 460, height: 600 });
  await popup.goto(extensionUrl);
  network = await context.newPage();
  await network.goto(origin);
});

test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function echo() {
  return network.evaluate(async () => {
    const response = await fetch(`/echo?t=${Date.now()}`, {
      headers: { 'X-Existing': 'original', 'X-Remove': 'original' },
    });
    return {
      request: await response.json() as Record<string, string>,
      serverHeader: response.headers.get('x-server'),
    };
  });
}

async function addHeader(index: number, name: string, value = '') {
  await popup.getByRole('button', { name: '添加 Header' }).click();
  await popup.getByRole('textbox', { name: `规则 ${index} 的 Header 名称` }).fill(name);
  if (value) await popup.getByRole('textbox', { name: `规则 ${index} 的 Header 值` }).fill(value);
}

async function saved() {
  await expect(popup.getByRole('status')).toHaveAttribute('data-state', 'saved');
}

async function profileMenu(name: string) {
  await popup.getByRole('button', { name: '更多 Profile 操作' }).click();
  await popup.getByRole('menuitem', { name, exact: true }).click();
}

async function chooseProfile(name: string) {
  await popup.getByRole('combobox', { name: '当前 Profile' }).click();
  await popup.getByRole('option', { name, exact: true }).click();
  await saved();
}

async function chooseRule(index: number, field: '方向' | '操作', name: string) {
  await popup.getByRole('combobox', { name: `规则 ${index} 的${field}` }).click();
  await popup.getByRole('listbox').getByRole('option', { name, exact: true }).click();
  await saved();
}

test('edits real request and response headers, isolates profiles, persists, and disables cleanly', async () => {
  let power = popup.getByRole('switch', { name: '全局 Header 修改开关' });
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await expect(popup.locator('.profile-toolbar').getByRole('switch')).toHaveCount(1);
  await expect(popup.locator('.app-header')).toHaveCount(0);

  // The compact controls support keyboard navigation, dismissal and disabled actions.
  const more = popup.getByRole('button', { name: '更多 Profile 操作' });
  const compactHeight = Math.ceil(await popup.locator('#app').evaluate((node) => node.getBoundingClientRect().height));
  await popup.setViewportSize({ width: 460, height: compactHeight });
  await expect(popup.getByRole('menuitem')).toHaveCount(0);
  await more.press('ArrowDown');
  await expect(popup.getByRole('menuitem', { name: '新建 Profile', exact: true })).toBeFocused();
  await expect(popup.getByRole('menuitem', { name: '删除 Profile', exact: true })).toBeDisabled();
  await popup.getByRole('menuitem', { name: '新建 Profile', exact: true }).press('ArrowUp');
  await expect(popup.getByRole('menuitem', { name: '重命名 Profile', exact: true })).toBeFocused();
  await popup.getByRole('menuitem', { name: '重命名 Profile', exact: true }).press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await more.click();
  await expect(popup.getByRole('menu')).toHaveCount(0);
  await more.click();
  const menuBounds = await popup.getByRole('menu').boundingBox();
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(compactHeight);
  await popup.getByRole('combobox', { name: '当前 Profile' }).click();
  await expect(popup.getByRole('menu')).toHaveCount(0);
  await expect(popup.getByRole('option', { name: 'Default', exact: true })).toHaveAttribute('aria-selected', 'true');
  await popup.locator('#headers-heading').click();
  await expect(popup.getByRole('listbox')).toHaveCount(0);
  await popup.setViewportSize({ width: 460, height: 600 });

  await addHeader(1, 'X-Pilot', 'development');
  await addHeader(2, 'X-Existing', 'replaced');
  await addHeader(3, 'X-Remove');
  await chooseRule(3, '操作', '移除');
  await addHeader(4, 'X-Server', 'response-modified');
  await chooseRule(4, '方向', '响应');
  await saved();
  await expect(popup.locator('select')).toHaveCount(0);
  // Rule selectors share Profile's keyboard behavior and retain their trigger nodes.
  const direction = popup.getByRole('combobox', { name: '规则 1 的方向' });
  const liveDirection = await direction.elementHandle();
  await direction.press('ArrowDown');
  await expect(popup.getByRole('option', { name: '请求', exact: true })).toHaveAttribute('aria-selected', 'true');
  await popup.getByRole('option', { name: '请求', exact: true }).press('ArrowDown');
  await popup.getByRole('option', { name: '响应', exact: true }).press('Enter');
  await saved();
  await expect(direction).toContainText('响应');
  await expect(direction).toBeFocused();
  expect(await liveDirection!.evaluate((node) => node.isConnected)).toBe(true);
  await chooseRule(1, '方向', '请求');
  await direction.click();
  await popup.getByRole('combobox', { name: '规则 1 的操作' }).click();
  await expect(direction).toHaveAttribute('aria-expanded', 'false');
  await expect(popup.getByRole('listbox')).toHaveCount(1);
  await popup.getByRole('option', { name: '设置', exact: true }).press('Escape');
  await expect(popup.getByRole('combobox', { name: '规则 1 的操作' })).toBeFocused();
  await direction.click();
  await popup.locator('#headers-heading').click();
  await expect(direction).toHaveAttribute('aria-expanded', 'false');
  expect((await echo()).request['x-pilot']).toBeUndefined();

  await power.click();
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await saved();
  const modified = await echo();
  expect(modified.request['x-pilot']).toBe('development');
  expect(modified.request['x-existing']).toBe('replaced');
  expect(modified.request['x-remove']).toBeUndefined();
  expect(modified.serverHeader).toBe('response-modified');

  // A reload uses storage and the background service worker, not popup memory.
  await popup.reload();
  await expect(popup.getByRole('textbox', { name: '规则 1 的 Header 名称' })).toHaveValue('X-Pilot');
  expect((await echo()).request['x-pilot']).toBe('development');

  // Autosave must keep the exact input node, focus, and caret while typing.
  await expect(popup.getByRole('button', { name: '保存并应用', exact: true })).toHaveCount(0);
  await expect(popup.locator('footer')).toHaveCount(0);
  const valueInput = popup.getByRole('textbox', { name: '规则 1 的 Header 值' });
  const liveValue = await valueInput.elementHandle();
  await valueInput.focus();
  await valueInput.press('End');
  await valueInput.pressSequentially('-typing', { delay: 1 });
  await saved();
  expect(await liveValue!.evaluate((node) => node instanceof HTMLInputElement && node.isConnected && node === document.activeElement && node.selectionStart === node.value.length)).toBe(true);
  expect((await echo()).request['x-pilot']).toBe('development-typing');

  // A burst immediately followed by popup destruction is saved by the worker.
  await valueInput.evaluate((node) => {
    if (!(node instanceof HTMLInputElement)) throw new Error('Expected input');
    for (let index = 0; index < 30; index++) {
      node.value = `closing-${index}`;
      node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  });
  await popup.close();
  popup = await context.newPage();
  await popup.setViewportSize({ width: 460, height: 600 });
  await popup.goto(extensionUrl);
  power = popup.getByRole('switch', { name: '全局 Header 修改开关' });
  await expect(popup.getByRole('textbox', { name: '规则 1 的 Header 值' })).toHaveValue('closing-29');
  expect((await echo()).request['x-pilot']).toBe('closing-29');
  await popup.getByRole('textbox', { name: '规则 1 的 Header 值' }).fill('development');
  await saved();

  await popup.getByRole('checkbox', { name: '启用规则 1', exact: true }).uncheck();
  await saved();
  expect((await echo()).request['x-pilot']).toBeUndefined();
  await popup.getByRole('checkbox', { name: '启用规则 1', exact: true }).check();
  await popup.getByRole('button', { name: '编辑匹配范围' }).click();
  await popup.getByRole('textbox', { name: 'URL 过滤器' }).fill('||no-match.invalid^');
  await saved();
  expect((await echo()).request['x-existing']).toBe('original');
  await popup.getByRole('textbox', { name: 'URL 过滤器' }).fill('||127.0.0.1^');
  await saved();
  expect((await echo()).request['x-pilot']).toBe('development');

  await profileMenu('新建 Profile');
  await popup.getByRole('textbox', { name: 'Profile 名称' }).fill('Staging');
  await popup.getByRole('button', { name: '保存 Profile', exact: true }).click();
  await expect(popup.getByRole('combobox', { name: '当前 Profile' })).toContainText('Staging');
  await saved();
  await popup.getByRole('combobox', { name: '当前 Profile' }).press('Home');
  await expect(popup.getByRole('option', { name: 'Default', exact: true })).toBeFocused();
  await popup.getByRole('option', { name: 'Default', exact: true }).press('ArrowDown');
  await expect(popup.getByRole('option', { name: 'Staging', exact: true })).toBeFocused();
  await popup.getByRole('option', { name: 'Staging', exact: true }).press('Enter');
  await expect(popup.getByRole('combobox', { name: '当前 Profile' })).toBeFocused();
  expect((await echo()).request['x-pilot']).toBeUndefined();
  await addHeader(1, 'X-Pilot', 'staging');
  await saved();
  expect((await echo()).request['x-pilot']).toBe('staging');
  await chooseProfile('Default');
  await expect(popup.getByRole('textbox', { name: '规则 1 的 Header 值' })).toHaveValue('development');
  await saved();
  expect((await echo()).request['x-pilot']).toBe('development');

  // Invalid drafts never replace the working rule, and the global switch still works.
  await popup.getByRole('textbox', { name: '规则 1 的 Header 名称' }).fill('Invalid:Header');
  await expect(popup.locator('#save-error')).toContainText('无效 Header');
  expect((await echo()).request['x-pilot']).toBe('development');
  await power.click();
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await saved();
  const paused = await echo();
  expect(paused.request['x-pilot']).toBeUndefined();
  expect(paused.request['x-existing']).toBe('original');
  expect(paused.request['x-remove']).toBe('original');
  expect(paused.serverHeader).toBe('original');
  await popup.reload();
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await expect(popup.getByRole('textbox', { name: '规则 1 的 Header 名称' })).toHaveValue('X-Pilot');

  // Profile management preserves an independent copy and supports renaming/deletion.
  await profileMenu('复制 Profile');
  await saved();
  await profileMenu('重命名 Profile');
  await popup.getByRole('textbox', { name: 'Profile 名称' }).fill('Copied');
  await popup.getByRole('button', { name: '保存 Profile', exact: true }).click();
  await saved();
  await chooseProfile('Copied');
  await expect(popup.getByRole('textbox', { name: '规则 1 的 Header 名称' })).toHaveValue('X-Pilot');
  await profileMenu('删除 Profile');
  await popup.getByRole('button', { name: '确认删除', exact: true }).click();
  await popup.getByRole('combobox', { name: '当前 Profile' }).click();
  await expect(popup.getByRole('listbox', { name: '选择 Profile' }).getByRole('option')).toHaveCount(2);
  await popup.getByRole('option', { name: 'Default', exact: true }).press('Escape');
  await saved();

  // Toggling a scrolled rule must not recreate the list or jump to the top.
  for (let index = 5; index <= 8; index++) await addHeader(index, `X-Scroll-${index}`, 'test');
  await saved();
  const list = popup.locator('.header-list');
  const lastValue = await popup.getByRole('textbox', { name: '规则 8 的 Header 值' }).elementHandle();
  await popup.getByRole('checkbox', { name: '启用规则 8', exact: true }).uncheck();
  const scrollTop = await list.evaluate((node) => node.scrollTop);
  await saved();
  expect(scrollTop).toBeGreaterThan(0);
  expect(await list.evaluate((node) => node.scrollTop)).toBe(scrollTop);
  expect(await lastValue!.evaluate((node) => node.isConnected)).toBe(true);
  await chooseRule(8, '操作', '移除');
  await saved();
  expect(await lastValue!.evaluate((node) => node instanceof HTMLInputElement && node.isConnected && node.disabled)).toBe(true);
  for (let index = 8; index >= 5; index--) await popup.getByRole('button', { name: `删除规则 ${index}`, exact: true }).click();
  await saved();

  // The popup must fit Chrome's 600px height limit with an internal rule scroller.
  expect(await popup.locator('#app').evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(600);
  await popup.screenshot({ path: '/tmp/headerpilot-popup.png' });
  await popup.getByRole('button', { name: '更多 Profile 操作' }).click();
  await popup.screenshot({ path: '/tmp/headerpilot-profile-menu.png' });
  await popup.getByRole('combobox', { name: '当前 Profile' }).click();
  await popup.screenshot({ path: '/tmp/headerpilot-profile-options.png' });
  await popup.getByRole('combobox', { name: '规则 1 的方向' }).click();
  await popup.screenshot({ path: '/tmp/headerpilot-rule-options.png' });
});
