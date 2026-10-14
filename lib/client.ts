import { createDefaultState, validateState, type AppState } from './model';
import type { Message, Reply } from './protocol';

declare const __HEADERPILOT_PREVIEW__: boolean;
export const isPreview = typeof __HEADERPILOT_PREVIEW__ !== 'undefined' && __HEADERPILOT_PREVIEW__;
let extensionSend: ((message: Message) => Promise<Reply>) | undefined;

export async function send(message: Message): Promise<AppState> {
  if (isPreview) {
    const stored = localStorage.getItem('headerpilot:preview');
    let state: AppState = stored ? JSON.parse(stored) : createDefaultState();
    if (message.type === 'save-state') state = message.state;
    if (message.type === 'save-edits') state = { ...message.state, enabled: state.enabled };
    if (message.type === 'set-enabled') state.enabled = message.enabled;
    validateState(state);
    localStorage.setItem('headerpilot:preview', JSON.stringify(state));
    return state;
  }
  if (!extensionSend) {
    const { browser } = await import('wxt/browser');
    extensionSend = (message) => browser.runtime.sendMessage(message);
  }
  const reply = await extensionSend(message);
  if (!reply || !reply.ok) throw new Error(reply?.error || '无法连接后台，请重新加载扩展。');
  return reply.state;
}
