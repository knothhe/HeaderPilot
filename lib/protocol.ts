import type { AppState } from './model';

export type Message =
  | { type: 'get-state' }
  | { type: 'save-state'; state: AppState }
  | { type: 'save-edits'; state: AppState }
  | { type: 'set-enabled'; enabled: boolean };

export type Reply =
  | { ok: true; state: AppState }
  | { ok: false; error: string };
