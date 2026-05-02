import type { Message, MessageResponse } from '@/lib/types';

export async function send<R extends MessageResponse = MessageResponse>(message: Message): Promise<R> {
  return (await chrome.runtime.sendMessage(message)) as R;
}
