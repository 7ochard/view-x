// View-X's deck-side X adapter. All iframe creation, URL policy and X frame
// messaging live here so Deck never needs to know about X.com internals.
(function () {
  'use strict';

  const ALLOWED_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
  const IDLE_TIMEOUT = 45_000;

  function isAllowedOrigin(origin) {
    return origin === 'https://x.com' || origin === 'https://twitter.com';
  }

  class XAdapter {
    constructor({ settings, onNavigate, onLightbox, onColumnClick, onRateLimit, onAccount, onAvatar } = {}) {
      this.settings = settings || {};
      this.onNavigate = onNavigate || (() => {});
      this.onLightbox = onLightbox || (() => {});
      this.onColumnClick = onColumnClick || (() => {});
      this.onRateLimit = onRateLimit || (() => {});
      this.onAccount = onAccount || (() => {});
      this.onAvatar = onAvatar || (() => {});
      this.frames = new Map();
      this.activeColumnId = null;
      this.idleTimer = null;
      this.rateLimited = false;
      this.boundMessageHandler = this.handleWindowMessage.bind(this);

      window.addEventListener('message', this.boundMessageHandler);
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
          if (message && message.type === 'tweetdeckx-rate-limited') this.handleRateLimit();
        });
      }
    }

    normalizeUrl(rawUrl) {
      const raw = String(rawUrl || '').trim();
      if (!raw) throw new Error('Enter an X URL.');

      const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
      let parsed;
      try {
        parsed = new URL(candidate);
      } catch (error) {
        throw new Error('Enter a valid X URL.');
      }

      if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
        throw new Error('Only x.com and twitter.com URLs are supported.');
      }

      // Use one canonical origin for predictable iframe messaging and storage.
      parsed.protocol = 'https:';
      parsed.hostname = 'x.com';
      if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/home';
      return parsed.toString();
    }

    createFrame(column) {
      const iframe = document.createElement('iframe');
      iframe.className = 'column-frame';
      iframe.sandbox = 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
      iframe.allow = 'autoplay; encrypted-media; fullscreen';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';

      this.frames.set(column.id, { column, iframe });
      iframe.addEventListener('load', () => {
        this.initializeFrame(column.id);
        this.pause(column.id);
        this.burst(column.id);
      });
      iframe.src = column.lastUrl || column.sourceUrl;
      return iframe;
    }

    initializeFrame(columnId) {
      const record = this.frames.get(columnId);
      if (!record) return;
      const { column } = record;
      this.post(columnId, {
        type: 'tweetdeckx-init',
        hideAds: Boolean(this.settings.hideAds),
        hideColumnHeader: Boolean(this.settings.hideColumnHeader),
        timelinePreset: column.preset || null,
      });
      this.post(columnId, {
        type: 'tweetdeckx-set-column-width',
        width: column.width,
      });
    }

    updateSettings(settings) {
      this.settings = settings || {};
      this.frames.forEach((record, columnId) => {
        this.post(columnId, { type: 'tweetdeckx-set-hide-ads', enabled: Boolean(this.settings.hideAds) });
        this.post(columnId, {
          type: 'tweetdeckx-set-hide-column-header',
          enabled: Boolean(this.settings.hideColumnHeader),
        });
      });
    }

    updateColumnWidth(columnId, width) {
      this.post(columnId, { type: 'tweetdeckx-set-column-width', width });
    }

    refresh(columnId, url) {
      const record = this.frames.get(columnId);
      if (!record) return;
      record.iframe.src = url || record.column.lastUrl || record.column.sourceUrl;
      this.activate(columnId);
    }

    activate(columnId) {
      if (this.activeColumnId && this.activeColumnId !== columnId) this.pause(this.activeColumnId);
      this.activeColumnId = columnId;
      this.resume(columnId);
      this.resetIdleTimer();
    }

    burst(columnId) {
      this.resume(columnId);
      window.setTimeout(() => {
        if (this.activeColumnId !== columnId) this.pause(columnId);
      }, 3_000);
    }

    pause(columnId) {
      this.post(columnId, { type: 'tweetdeckx-pause' });
    }

    resume(columnId) {
      if (!this.rateLimited) this.post(columnId, { type: 'tweetdeckx-resume' });
    }

    pauseAll() {
      this.frames.forEach((record, columnId) => this.pause(columnId));
    }

    destroy(columnId) {
      const record = this.frames.get(columnId);
      if (!record) return;
      if (record.iframe.parentNode) record.iframe.remove();
      this.frames.delete(columnId);
      if (this.activeColumnId === columnId) {
        this.activeColumnId = null;
        window.clearTimeout(this.idleTimer);
      }
    }

    post(columnId, message) {
      const record = this.frames.get(columnId);
      if (!record || !record.iframe.contentWindow) return;
      try {
        record.iframe.contentWindow.postMessage(message, 'https://x.com');
      } catch (error) {
        // The iframe may be navigating or already disposed. It will receive
        // a fresh initialization message after its next load event.
      }
    }

    resetIdleTimer() {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => {
        if (this.activeColumnId) this.pause(this.activeColumnId);
        this.activeColumnId = null;
      }, IDLE_TIMEOUT);
    }

    handleRateLimit() {
      this.rateLimited = true;
      this.pauseAll();
      this.onRateLimit();
      window.setTimeout(() => {
        this.rateLimited = false;
      }, 50_000);
    }

    handleWindowMessage(event) {
      if (!isAllowedOrigin(event.origin) || !event.data || typeof event.data.type !== 'string') return;

      let matchedColumnId = null;
      this.frames.forEach((record, columnId) => {
        if (record.iframe.contentWindow === event.source) matchedColumnId = columnId;
      });
      if (!matchedColumnId) return;

      if (event.data.type === 'tweetdeckx-user-activity') {
        this.activate(matchedColumnId);
      }

      if (event.data.type === 'tweetdeckx-column-click') {
        this.onColumnClick(matchedColumnId);
      }

      if (event.data.type === 'tweetdeckx-url-changed' && event.data.url) {
        try {
          const url = this.normalizeUrl(event.data.url);
          this.onNavigate(matchedColumnId, url);
        } catch (error) {
          // Ignore a malformed or external URL reported by page code.
        }
      }

      if (event.data.type === 'tweetdeckx-lightbox-opened') {
        this.onLightbox(matchedColumnId, true);
      }
      if (event.data.type === 'tweetdeckx-lightbox-closed') {
        this.onLightbox(matchedColumnId, false);
      }

      if (event.data.type === 'tweetdeckx-account-handle' && /^[A-Za-z0-9_]{1,15}$/.test(event.data.handle || '')) {
        this.onAccount(event.data.handle, typeof event.data.avatarUrl === 'string' ? event.data.avatarUrl : '');
      }
      if (event.data.type === 'tweetdeckx-account-avatar' && typeof event.data.avatarUrl === 'string') {
        this.onAvatar(event.data.avatarUrl);
      }
    }
  }

  window.ViewX = window.ViewX || {};
  window.ViewX.XAdapter = XAdapter;
})();
