import { uuidv4 } from './uuid';

const KEY = 'device_id';

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await chrome.storage.local.get(KEY);
  const current = existing[KEY];
  if (typeof current === 'string' && current.length > 0) return current;
  const fresh = uuidv4();
  await chrome.storage.local.set({ [KEY]: fresh });
  return fresh;
}
