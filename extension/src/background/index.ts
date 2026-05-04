import { handleMessage } from './router';
import { getOrCreateDeviceId } from '@/lib/device-id';
import type { Message, MessageResponse } from '@/lib/types';

const CONTEXT_MENU_GARMENT = 'tryon-image';
const CONTEXT_MENU_ACCESSORY = 'tryon-accessory';
const CONTEXT_MENU_HAIRSTYLE = 'tryon-hairstyle';
const LAST_ACTION_KEY = 'last_action';
const ACTIVE_TAB_KEY = 'active_tab';

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
  void reinjectContentScripts();
});

/**
 * Chrome does NOT re-inject content scripts into already-open tabs when an
 * extension is installed/reloaded/updated. Without this, a user reloading
 * the unpacked extension would have to manually refresh every Pinterest /
 * Myntra / Amazon tab to get the hover button back. We do it for them.
 *
 * Reads the manifest's content_scripts entries, queries matching tabs, and
 * runs the listed JS files in each. Failures (chrome:// pages, blocked
 * origins, etc.) are swallowed silently.
 */
async function reinjectContentScripts(): Promise<void> {
  const entries = chrome.runtime.getManifest().content_scripts ?? [];
  for (const cs of entries) {
    const matches = cs.matches ?? [];
    const files = (cs.js ?? []).filter((f): f is string => typeof f === 'string');
    if (matches.length === 0 || files.length === 0) continue;
    let tabs: chrome.tabs.Tab[] = [];
    try {
      tabs = await chrome.tabs.query({ url: matches });
    } catch {
      continue;
    }
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files,
        });
      } catch {
        // Frame disallowed (e.g. chrome web store, login challenge). Skip.
      }
    }
  }
}

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
    // Smart-route by which tab the side panel is currently on. If the user
    // is mid-flow on Outfit, the click adds to the outfit's optional hair
    // source. Otherwise (Hair tab, Settings, or panel closed) we route to
    // the dedicated Hair pipeline — the higher-quality default.
    const stored = await chrome.storage.session.get(ACTIVE_TAB_KEY);
    const tab = stored[ACTIVE_TAB_KEY];
    if (tab === 'outfit') {
      await handleMessage({
        type: 'SET_PENDING_OUTFIT_HAIR_SOURCE',
        source: { url: info.srcUrl, origin: 'context_menu' },
      });
      await chrome.storage.session.set({ [LAST_ACTION_KEY]: 'outfit' });
    } else {
      await handleMessage({
        type: 'SET_PENDING_HAIR_SOURCE',
        source: { url: info.srcUrl, origin: 'context_menu' },
      });
      await chrome.storage.session.set({ [LAST_ACTION_KEY]: 'hair' });
    }
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
