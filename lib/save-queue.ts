import type { AppState } from './model';
import type { Message } from './protocol';

type PendingWrite = {
  message: Message;
  resolve: Array<(state: AppState) => void>;
  reject: Array<(error: unknown) => void>;
};

// Coalesce pending edits, but keep global toggles as ordering barriers.
export function createSaveQueue(send: (message: Message) => Promise<AppState>) {
  const pending: PendingWrite[] = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const write = pending.shift()!;
        try {
          const result = await send(write.message);
          write.resolve.forEach((resolve) => resolve(result));
        } catch (error) {
          write.reject.forEach((reject) => reject(error));
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    write(message: Message): Promise<AppState> {
      const snapshot = structuredClone(message);
      return new Promise((resolve, reject) => {
        const last = pending.at(-1);
        if (snapshot.type === 'save-edits' && last?.message.type === 'save-edits') {
          last.message = snapshot;
          last.resolve.push(resolve);
          last.reject.push(reject);
        } else {
          pending.push({ message: snapshot, resolve: [resolve], reject: [reject] });
        }
        void drain();
      });
    },
  };
}
