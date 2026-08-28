// View-X workspace persistence. This file is intentionally dependency-free so
// the deck remains a Load Unpacked, no-build Chrome extension.
(function () {
  'use strict';

  const STORAGE_KEY = 'viewx_workspace_v1';
  const LEGACY_STATE_KEY = 'tweetdeckx_state';
  const DEFAULT_WORKSPACE_VERSION = 2;
  const MIN_COLUMN_WIDTH = 480;
  const MAX_COLUMN_WIDTH = 600;
  const DEFAULT_COLUMN_WIDTH = 480;
  const VALID_PRESETS = new Set(['home', 'following', 'topic:0', 'topic:1', 'likes']);
  const VALID_ACCENTS = new Set(['blue', 'lavender', 'light']);
  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return 'column_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function snapWidth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_COLUMN_WIDTH;
    return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(numeric)));
  }

  function getStorage(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function setStorage(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
  }

  function legacyColumnUrl(column) {
    if (column && column.url) return String(column.url);

    const param = String((column && column.param) || '');
    switch (column && column.type) {
      case 'explore': return 'https://x.com/explore';
      case 'notifications': return 'https://x.com/notifications';
      case 'messages': return 'https://x.com/messages';
      case 'bookmarks': return 'https://x.com/i/bookmarks';
      case 'search': return `https://x.com/search?q=${encodeURIComponent(param)}&src=typed_query&f=live`;
      case 'user': return `https://x.com/${param.replace(/^@/, '')}`;
      case 'likes': return `https://x.com/${param.replace(/^@/, '')}/likes`;
      case 'list': return /^https?:/i.test(param) ? param : `https://x.com/i/lists/${param}`;
      case 'url': return /^https?:/i.test(param) ? param : `https://x.com/${param.replace(/^\/+/, '')}`;
      case 'home':
      default: return 'https://x.com/home';
    }
  }

  function normalizeWorkspace(workspace) {
    const rawColumns = Array.isArray(workspace && workspace.columns) ? workspace.columns : [];
    const ids = new Set();
    const columns = rawColumns.reduce((result, column) => {
      const sourceUrl = String((column && (column.sourceUrl || column.lastUrl)) || '').trim();
      if (!sourceUrl) return result;

      let id = String((column && column.id) || createId());
      while (ids.has(id)) id = createId();
      ids.add(id);

      result.push({
        id,
        sourceUrl,
        lastUrl: String((column && column.lastUrl) || sourceUrl),
        width: snapWidth(column && column.width),
        preset: VALID_PRESETS.has(column && column.preset) ? column.preset : null,
        accountHandle: /^[A-Za-z0-9_]{1,15}$/.test((column && column.accountHandle) || '') ? column.accountHandle : null,
      });
      return result;
    }, []);

    const savedSettings = (workspace && workspace.settings) || {};
    const savedLayoutColumns = Number(savedSettings.layoutColumns);
    return {
      version: Number(workspace && workspace.version) >= DEFAULT_WORKSPACE_VERSION ? DEFAULT_WORKSPACE_VERSION : 1,
      settings: {
        theme: savedSettings.theme === 'light' ? 'light' : 'dark',
        accent: VALID_ACCENTS.has(savedSettings.accent) ? savedSettings.accent : 'light',
        layoutColumns: Number.isInteger(savedLayoutColumns) && savedLayoutColumns >= 2 ? savedLayoutColumns : null,
        hideAds: savedSettings.hideAds !== false,
        hideColumnHeader: Boolean(savedSettings.hideColumnHeader),
      },
      columns,
      initialized: Boolean(workspace && workspace.initialized),
    };
  }

  function migrateLegacyState(legacyState) {
    const savedSettings = (legacyState && legacyState.settings) || {};
    const pages = Array.isArray(legacyState && legacyState.pages) ? legacyState.pages : [];
    const legacyWidth = savedSettings.columnWidth || 400;
    const columns = [];

    // Preserve the stored page sequence, then each page's stored column order.
    // The old key is deliberately not removed: it is a recoverable backup.
    pages.forEach((page) => {
      (Array.isArray(page && page.columns) ? page.columns : []).forEach((column) => {
        const sourceUrl = legacyColumnUrl(column);
        columns.push({
          id: String((column && column.id) || createId()),
          sourceUrl,
          lastUrl: sourceUrl,
          width: snapWidth(legacyWidth),
        });
      });
    });

    return normalizeWorkspace({
      settings: {
        theme: savedSettings.theme,
        hideAds: savedSettings.hideAds !== false,
        hideColumnHeader: Boolean(savedSettings.hideColumnHeader),
      },
      columns,
      initialized: columns.length > 0,
    });
  }

  class WorkspaceStorage {
    async load() {
      const data = await getStorage([STORAGE_KEY, LEGACY_STATE_KEY]);
      if (data[STORAGE_KEY]) return normalizeWorkspace(data[STORAGE_KEY]);

      if (data[LEGACY_STATE_KEY]) {
        const migrated = migrateLegacyState(data[LEGACY_STATE_KEY]);
        await this.save(migrated);
        return migrated;
      }

      return normalizeWorkspace(null);
    }

    async save(workspace) {
      const normalized = normalizeWorkspace(workspace);
      await setStorage({ [STORAGE_KEY]: normalized });
      return normalized;
    }

    createColumn(sourceUrl, preset) {
      return {
        id: createId(),
        sourceUrl,
        lastUrl: sourceUrl,
        width: DEFAULT_COLUMN_WIDTH,
        preset: VALID_PRESETS.has(preset) ? preset : null,
        accountHandle: null,
      };
    }
  }

  window.ViewX = window.ViewX || {};
  window.ViewX.WorkspaceStorage = WorkspaceStorage;
  window.ViewX.MIN_COLUMN_WIDTH = MIN_COLUMN_WIDTH;
  window.ViewX.MAX_COLUMN_WIDTH = MAX_COLUMN_WIDTH;
  window.ViewX.DEFAULT_COLUMN_WIDTH = DEFAULT_COLUMN_WIDTH;
  window.ViewX.snapWidth = snapWidth;
})();
