import type { Browser } from 'wxt/browser';
import { activeProfile, validateState, type AppState } from './model';

type Rule = Browser.declarativeNetRequest.Rule;
type Modification = Browser.declarativeNetRequest.ModifyHeaderInfo;

// One atomic rule contains all modifications in the selected profile.
export function buildRules(state: AppState): Rule[] {
  validateState(state);
  if (!state.enabled) return [];
  const profile = activeProfile(state);
  const requestHeaders: Modification[] = [];
  const responseHeaders: Modification[] = [];
  for (const header of profile.headers.filter((item) => item.enabled)) {
    const modification: Modification = header.operation === 'remove'
      ? { header: header.name.toLowerCase(), operation: 'remove' }
      : { header: header.name.toLowerCase(), operation: 'set', value: header.value };
    (header.target === 'request' ? requestHeaders : responseHeaders).push(modification);
  }
  if (!requestHeaders.length && !responseHeaders.length) return [];
  return [{
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      ...(requestHeaders.length ? { requestHeaders } : {}),
      ...(responseHeaders.length ? { responseHeaders } : {}),
    },
    condition: {
      ...(profile.urlFilter.trim() ? { urlFilter: profile.urlFilter.trim() } : {}),
      resourceTypes: [
        'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
        'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket',
        'webtransport', 'webbundle', 'other',
      ],
    },
  }];
}
