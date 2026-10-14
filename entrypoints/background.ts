import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createController } from '../lib/controller';
import { createSaveQueue } from '../lib/save-queue';
import { activeProfile, STORAGE_KEY } from '../lib/model';
import type { Message, Reply } from '../lib/protocol';

export default defineBackground(() => {
  const controller = createController({
    async read() {
      return (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    },
    async write(state) {
      await browser.storage.local.set({ [STORAGE_KEY]: state });
    },
    async apply(addRules) {
      const existing = await browser.declarativeNetRequest.getDynamicRules();
      await browser.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((rule) => rule.id), addRules,
      });
    },
    async badge(state) {
      const count = activeProfile(state).headers.filter((header) => header.enabled).length;
      await browser.action.setBadgeText({ text: state.enabled && count ? String(count) : '' });
      await browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
      await browser.action.setTitle({
        title: `HeaderPilot · ${state.enabled ? activeProfile(state).name : '已暂停'}`,
      });
    },
  });
  // Pending edits live in the service worker, independently of popup lifetime.
  const saves = createSaveQueue((message) => controller.run(message));

  browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const task = saves.write(message);
    void task.then(
      (state) => sendResponse({ ok: true, state } satisfies Reply),
      (error: unknown) => sendResponse({
        ok: false, error: error instanceof Error ? error.message : '操作失败，请重试。',
      } satisfies Reply),
    );
    // Keep the response channel open while Chrome applies the rules.
    return true;
  });

  const restore = () => {
    void controller.run({ type: 'get-state' }).catch(async (error: unknown) => {
      console.error('HeaderPilot failed to restore configuration', error);
      // Fail closed if persisted configuration is corrupt.
      const rules = await browser.declarativeNetRequest.getDynamicRules();
      await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.map((rule) => rule.id) });
      await browser.action.setBadgeText({ text: '!' });
      await browser.action.setBadgeBackgroundColor({ color: '#dc2626' });
    });
  };
  browser.runtime.onInstalled.addListener(restore);
  browser.runtime.onStartup.addListener(restore);
});
