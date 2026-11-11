import type { Note } from '@360note/shared';

const CHANNEL = '360note:note-sync';

interface NoteSavedMessage {
  type: 'note-saved';
  note: Note;
  at: number;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

/** Notify other tabs in the same browser that a note was saved. */
export function broadcastNoteSaved(note: Note): void {
  try {
    getChannel()?.postMessage({ type: 'note-saved', note, at: Date.now() } satisfies NoteSavedMessage);
  } catch {
    /* BroadcastChannel can be unavailable in hardened/private contexts. */
  }
}

/** Subscribe to note saves from other tabs. Returns an unsubscribe function. */
export function subscribeNoteSaved(handler: (note: Note, at: number) => void): () => void {
  const bus = getChannel();
  if (!bus) return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as NoteSavedMessage | null;
    if (data?.type === 'note-saved' && data.note) handler(data.note, data.at ?? Date.now());
  };
  bus.addEventListener('message', listener);
  return () => bus.removeEventListener('message', listener);
}
