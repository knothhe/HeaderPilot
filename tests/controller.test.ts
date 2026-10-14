import { describe, expect, it, vi } from 'vitest';
import { createController } from '../lib/controller';
import { activeProfile, createDefaultState, createHeader, type AppState } from '../lib/model';
import { buildRules } from '../lib/rules';

function fixture(initial: AppState | undefined = createDefaultState()) {
  let stored = initial && structuredClone(initial);
  const adapter = {
    read: vi.fn(async (): Promise<unknown> => stored && structuredClone(stored)),
    write: vi.fn(async (state: AppState) => { stored = structuredClone(state); }),
    apply: vi.fn(async (_rules: ReturnType<typeof buildRules>) => {}),
    badge: vi.fn(async (_state: AppState) => {}),
  };
  return { adapter, controller: createController(adapter), stored: () => stored };
}

function configured() {
  const state = createDefaultState();
  state.enabled = true;
  activeProfile(state).headers.push({ ...createHeader(), name: 'X-Env', value: 'test' });
  return state;
}

describe('background configuration lifecycle', () => {
  it('initializes storage once on first use', async () => {
    const { controller, adapter } = fixture(undefined);
    // Explicitly model a fresh storage area.
    adapter.read.mockResolvedValueOnce(undefined);
    const state = await controller.run({ type: 'get-state' });
    expect(state.enabled).toBe(false);
    expect(adapter.write).toHaveBeenCalledTimes(1);
  });

  it('restores persisted rules when the extension starts', async () => {
    const state = configured();
    const { controller, adapter } = fixture(state);
    expect(await controller.run({ type: 'get-state' })).toEqual(state);
    expect(adapter.apply).toHaveBeenCalledWith(buildRules(state));
  });

  it('removes the rules immediately on global disable', async () => {
    const { controller, adapter, stored } = fixture(configured());
    await controller.run({ type: 'set-enabled', enabled: false });
    expect(adapter.apply).toHaveBeenLastCalledWith([]);
    expect(stored()!.enabled).toBe(false);
    expect(activeProfile(stored()!).headers).toHaveLength(1);
  });

  it('does not persist rejected Chrome rules and can recover on the next operation', async () => {
    const previous = createDefaultState();
    const { controller, adapter, stored } = fixture(previous);
    adapter.apply.mockRejectedValueOnce(new Error('Chrome rejected the rule'));
    await expect(controller.run({ type: 'save-state', state: configured() })).rejects.toThrow('Chrome rejected');
    expect(stored()).toEqual(previous);
    await expect(controller.run({ type: 'set-enabled', enabled: true })).resolves.toMatchObject({ enabled: true });
  });

  it('restores the previous rules if storage persistence fails', async () => {
    const previous = configured();
    const { controller, adapter, stored } = fixture(previous);
    adapter.write.mockRejectedValueOnce(new Error('Storage full'));
    await expect(controller.run({ type: 'set-enabled', enabled: false })).rejects.toThrow('Storage full');
    expect(adapter.apply.mock.calls.map(([rules]) => rules)).toEqual([[], buildRules(previous)]);
    expect(stored()).toEqual(previous);
  });

  it('serializes concurrent operations so the last toggle wins', async () => {
    const { controller, stored } = fixture(configured());
    const results = await Promise.all([
      controller.run({ type: 'set-enabled', enabled: false }),
      controller.run({ type: 'set-enabled', enabled: true }),
      controller.run({ type: 'set-enabled', enabled: false }),
    ]);
    expect(results.map((state) => state.enabled)).toEqual([false, true, false]);
    expect(stored()!.enabled).toBe(false);
  });

  it('rejects invalid drafts before modifying rules', async () => {
    const { controller, adapter } = fixture();
    const state = configured();
    activeProfile(state).headers[0]!.name = 'invalid:name';
    await expect(controller.run({ type: 'save-state', state })).rejects.toThrow('无效 Header');
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('does not let an autosave with a stale enabled flag undo a pause', async () => {
    const { controller, stored } = fixture(configured());
    const stale = configured();
    await controller.run({ type: 'set-enabled', enabled: false });
    await controller.run({ type: 'save-edits', state: stale });
    expect(stored()!.enabled).toBe(false);
    expect(activeProfile(stored()!).headers[0]!.value).toBe('test');
  });

  it('keeps the global switch enabled when a stale paused edit arrives', async () => {
    const { controller, stored } = fixture();
    const draft = createDefaultState();
    await controller.run({ type: 'set-enabled', enabled: true });
    await controller.run({ type: 'save-edits', state: draft });
    expect(stored()!.enabled).toBe(true);
  });

  it('does not fail a successful save if updating the badge fails', async () => {
    const { controller, adapter, stored } = fixture();
    adapter.badge.mockRejectedValueOnce(new Error('Badge unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(controller.run({ type: 'save-state', state: configured() })).resolves.toMatchObject({ enabled: true });
    expect(stored()!.enabled).toBe(true);
    log.mockRestore();
  });
});
