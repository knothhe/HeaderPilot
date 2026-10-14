import { buildRules } from './rules';
import { createDefaultState, validateState, type AppState } from './model';
import type { Message } from './protocol';

export interface StateAdapter {
  read(): Promise<unknown>;
  write(state: AppState): Promise<void>;
  apply(rules: ReturnType<typeof buildRules>): Promise<void>;
  badge(state: AppState): Promise<void>;
}

// All reads and writes are serialized, including startup and multiple popups.
export function createController(adapter: StateAdapter) {
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<AppState> {
    const stored = await adapter.read();
    if (stored === undefined) {
      const state = createDefaultState();
      await adapter.write(state);
      return state;
    }
    validateState(stored);
    return stored;
  }

  async function applyAndSave(previous: AppState, next: AppState) {
    validateState(next);
    await adapter.apply(buildRules(next));
    try {
      await adapter.write(next);
    } catch (error) {
      // Keep Chrome's installed rules consistent with the persisted state.
      await adapter.apply(buildRules(previous));
      throw error;
    }
    await adapter.badge(next).catch((error: unknown) => console.error('Badge update failed', error));
    return next;
  }

  function run(message: Message): Promise<AppState> {
    const task = queue.then(async () => {
      const current = await load();
      switch (message.type) {
        case 'get-state':
          await adapter.apply(buildRules(current));
          await adapter.badge(current);
          return current;
        case 'save-state':
          return applyAndSave(current, message.state);
        case 'save-edits':
          // A header edit cannot undo a global toggle submitted before it.
          return applyAndSave(current, { ...message.state, enabled: current.enabled });
        case 'set-enabled':
          if (typeof message.enabled !== 'boolean') throw new Error('开关状态无效。');
          return applyAndSave(current, { ...current, enabled: message.enabled });
        default:
          throw new Error('未知操作。');
      }
    });
    queue = task.catch(() => undefined);
    return task;
  }

  return { run };
}
