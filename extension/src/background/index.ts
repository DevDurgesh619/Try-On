import { handleMessage } from './router';
import { getOrCreateDeviceId } from '@/lib/device-id';
import type { Message, MessageResponse } from '@/lib/types';

const CONTEXT_MENU_GARMENT = 'tryon-image';
const CONTEXT_MENU_ACCESSORY = 'tryon-accessory';
const CONTEXT_MENU_HAIRSTYLE = 'tryon-hairstyle';
const LAST_ACTION_KEY = 'last_action';

function registerContextMenus(): void {
  // Idempotent: removeAll before create so reloading the unpacked extension
  // doesn't throw "duplicate id" and silently drop one of the entries.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_GARMENT,
      title: 'Try this on with TryOn',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ACCESSORY,
      title: 'Use as accessory in TryOn',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_HAIRSTYLE,
      title: 'Use this hairstyle in TryOn',
      contexts: ['image'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void getOrCreateDeviceId();
  registerContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.srcUrl) return;
  if (info.menuItemId === CONTEXT_MENU_GARMENT) {
    await handleMessage({
      type: 'SOURCE_IMAGE_SELECTED',
      url: info.srcUrl,
      origin: 'context_menu',
    });
    await chrome.storage.session.set({ [LAST_ACTION_KEY]: 'outfit' });
  } else if (info.menuItemId === CONTEXT_MENU_ACCESSORY) {
    await handleMessage({
      type: 'ADD_PENDING_ACCESSORY',
      accessory: { url: info.srcUrl, origin: 'context_menu' },
    });
    await chrome.storage.session.set({ [LAST_ACTION_KEY]: 'outfit' });
  } else if (info.menuItemId === CONTEXT_MENU_HAIRSTYLE) {
    await handleMessage({
      type: 'SET_PENDING_HAIR_SOURCE',
      source: { url: info.srcUrl, origin: 'context_menu' },
    });
    await chrome.storage.session.set({ [LAST_ACTION_KEY]: 'hair' });
  } else {
    return;
  }
  if (tab?.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (r: MessageResponse) => void) => {
    void (async (): Promise<void> => {
      try {
        const response = await handleMessage(message as Message);
        sendResponse(response);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        sendResponse({ ok: false, code: 'backend_error', message: msg });
      }
    })();
    return true; // keep the channel open for the async response
  },
);

export {};
