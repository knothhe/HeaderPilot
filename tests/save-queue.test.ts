import { describe, expect, it, vi } from 'vitest';
import { createDefaultState, type AppState } from '../lib/model';
import { createSaveQueue } from '../lib/save-queue';
import type { Message } from '../lib/protocol';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function edit(name: string): Message {
  const state = createDefaultState();
  state.profiles[0]!.name = name;
  return { type: 'save-edits', state };
}

describe('background autosave queue', () => {
  it('coalesces rapid pending edits and resolves all callers with the latest state', async () => {
    const first = deferred<AppState>();
    const send = vi.fn(async (message: Message): Promise<AppState> => {
      if (send.mock.calls.length === 1) return first.promise;
      if (message.type !== 'save-edits') throw new Error('Unexpected message');
      return message.state;
    });
    const queue = createSaveQueue(send);
    const a = queue.write(edit('A'));
    const b = queue.write(edit('B'));
    const c = queue.write(edit('C'));
    expect(send).toHaveBeenCalledTimes(1);
    first.resolve(createDefaultState());
    await a;
    const [resultB, resultC] = await Promise.all([b, c]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(resultB.profiles[0]!.name).toBe('C');
    expect(resultC).toEqual(resultB);
  });

  it('keeps toggles and reads in order between edits', async () => {
    const first = deferred<AppState>();
    const send = vi.fn(async (_message: Message): Promise<AppState> => {
      if (send.mock.calls.length === 1) return first.promise;
      return createDefaultState();
    });
    const queue = createSaveQueue(send);
    const tasks = [
      queue.write(edit('A')),
      queue.write(edit('B')),
      queue.write({ type: 'set-enabled', enabled: false }),
      queue.write(edit('C')),
      queue.write({ type: 'get-state' }),
      queue.write(edit('D')),
    ];
    first.resolve(createDefaultState());
    await Promise.all(tasks);
    expect(send.mock.calls.map(([message]) => message.type)).toEqual([
      'save-edits', 'save-edits', 'set-enabled', 'save-edits', 'get-state', 'save-edits',
    ]);
  });

  it('snapshots messages so later typing cannot mutate an in-flight save', async () => {
    const first = deferred<AppState>();
    const send = vi.fn((_message: Message) => first.promise);
    const queue = createSaveQueue(send);
    const message = edit('Original');
    const task = queue.write(message);
    if (message.type === 'save-edits') message.state.profiles[0]!.name = 'Changed';
    expect(send.mock.calls[0]![0]).toMatchObject({ state: { profiles: [{ name: 'Original' }] } });
    first.resolve(createDefaultState());
    await task;
  });

  it('continues saving after an earlier request fails', async () => {
    const first = deferred<AppState>();
    const send = vi.fn(async (_message: Message): Promise<AppState> => {
      if (send.mock.calls.length === 1) return first.promise;
      return createDefaultState();
    });
    const queue = createSaveQueue(send);
    const failed = queue.write(edit('A'));
    const rejected = expect(failed).rejects.toThrow('Rejected');
    const next = queue.write(edit('B'));
    first.reject(new Error('Rejected'));
    await rejected;
    await expect(next).resolves.toMatchObject({ version: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
