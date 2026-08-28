// TweetDeckX Content Script
// Runs at document_start in the ISOLATED world.
// Frame-busting defeat and interval pause/resume are handled by
// page-context.js (MAIN world, registered separately in manifest.json).

(function () {
  // Only apply in iframe context (not when user visits x.com normally)
  if (window === window.top) return;

  // -------------------------------------------------------
  // PHASE 1b: Inject first-party cookies into this iframe
  // -------------------------------------------------------
  // Cookie partitioning means this iframe has a separate cookie jar.
  // We bridge cookies from the first-party context so X.com's JS
  // reads the correct ct0 (CSRF token) and other session values.

  chrome.runtime.sendMessage({ type: 'tweetdeckx-get-cookies' }, (cookies) => {
    if (chrome.runtime.lastError || !cookies) return;
    for (const c of cookies) {
      try {
        document.cookie = `${c.name}=${c.value}; path=${c.path || '/'}; domain=${c.domain}; ${c.secure ? 'Secure;' : ''} SameSite=None`;
      } catch (e) {
        // Ignore cookie-setting errors
      }
    }
  });

  // -------------------------------------------------------
  // PHASE 2: Detect TweetDeckX context and apply compact styles
  // -------------------------------------------------------

  let isTweetDeckX = false;
  let reportedAccountHandle = null;
  let reportedAvatarUrl = null;

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'tweetdeckx-init') {
      isTweetDeckX = true;
      applyCompactStyles();
      applyHideAds(e.data.hideAds);
      applyHideColumnHeader(e.data.hideColumnHeader);
      applyTimelinePreset(e.data.timelinePreset);
      reportAccountHandleWhenReady();
    }
    if (e.data && e.data.type === 'tweetdeckx-set-column-width') {
      document.documentElement.style.setProperty('--tweetdeckx-col-width', e.data.width + 'px');
    }
    if (e.data && e.data.type === 'tweetdeckx-back') {
      window.history.back();
    }
    if (e.data && e.data.type === 'tweetdeckx-set-hide-ads') {
      applyHideAds(e.data.enabled);
    }
    if (e.data && e.data.type === 'tweetdeckx-set-hide-column-header') {
      applyHideColumnHeader(e.data.enabled);
    }
    // Forward user activity (scroll/click/keydown) so deck keeps the column active
    if (e.data && e.data.type === 'tweetdeckx-user-activity') {
      try { window.parent.postMessage(e.data, '*'); } catch (err) {}
    }
    // Forward trusted X-frame clicks separately from background activity. The deck
    // uses this message exclusively for the left column-selector state.
    if (e.data && e.data.type === 'tweetdeckx-column-click') {
      try { window.parent.postMessage(e.data, '*'); } catch (err) {}
    }
    // Forward iframe URL changes to the parent deck
    if (e.data && e.data.type === 'tweetdeckx-url-changed') {
      try { window.parent.postMessage(e.data, '*'); } catch (err) {}
    }
    // Forward lightbox open/close to deck page so it can expand the iframe
    if (e.data && (e.data.type === 'tweetdeckx-lightbox-opened' || e.data.type === 'tweetdeckx-lightbox-closed')) {
      try { window.parent.postMessage(e.data, '*'); } catch (err) {}
    }
  });

  // Cross-origin detection fallback
  try {
    if (window.top.location.href) {
      // Same origin check passed, but we already returned if window === top
    }
  } catch (err) {
    isTweetDeckX = true;
    applyCompactStyles();
  }

  // Fallback timer
  setTimeout(() => {
    if (!isTweetDeckX) {
      isTweetDeckX = true;
      applyCompactStyles();
    }
  }, 500);

  function applyCompactStyles() {
    if (document.getElementById('viewx-compact-styles-v8')) return;

    clearLegacyCenterOffsets();

    const style = document.createElement('style');
    style.id = 'viewx-compact-styles-v8';
    style.textContent = `
      /* Hide left navigation sidebar */
      header[role="banner"],
      [data-testid="sidebarColumn"],
      [aria-label="Primary navigation"] {
        display: none !important;
      }

      [data-testid="sidebarColumn"] {
        display: none !important;
      }

      /* Let the X timeline use the full Deck slot. This targets only the
         timeline's ancestor chain and never changes its horizontal position. */
      main,
      main :has([data-testid="primaryColumn"]),
      [data-testid="primaryColumn"] {
        width: 100% !important;
        max-width: none !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }

      [data-testid="primaryColumn"] {
        flex: 1 1 auto !important;
        margin: 0 !important;
        border-inline: none !important;
      }

      /* A two-column Deck gives each iframe a wide reading surface. Keep the
         timeline tabs on the same central rail as the feed rather than
         spreading them from edge to edge. Narrower three-plus-column views
         retain X's full-width tab navigation. */
      @media (min-width: 880px) {
        [data-testid="primaryColumn"] [role="tablist"] {
          width: min(100%, 720px) !important;
          max-width: 720px !important;
          margin-inline: auto !important;
        }

        [data-testid="primaryColumn"] form:has([data-testid="tweetTextarea_0"]) {
          width: min(100%, 720px) !important;
          max-width: 720px !important;
          margin-inline: auto !important;
          box-sizing: border-box !important;
        }
      }

      [data-testid="BottomBar"] {
        display: none !important;
      }

      [data-testid="SideNav_NewTweet_Button"] {
        display: none !important;
      }

      [data-testid="primaryColumn"] > div > div {
        padding-left: 0 !important;
        padding-right: 0 !important;
      }

      [data-testid="primaryColumn"] > div:first-child {
        position: sticky;
        top: 0;
        z-index: 10;
      }

      /* Prevent horizontal overflow without creating a new scroll container.
         overflow-x:hidden on html/body breaks X.com's virtual list by changing
         the scroll container from the viewport to the element itself. Instead,
         constrain widths so content never overflows horizontally. */
      #react-root,
      #react-root > div,
      #react-root > div > div {
        width: 100% !important;
        max-width: 100vw !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }

      [data-testid="sheetDialog"],
      [data-testid="BottomBar"] {
        display: none !important;
      }

      [data-testid="DMDrawer"] {
        display: none !important;
      }

      ::-webkit-scrollbar {
        width: 4px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(128, 128, 128, 0.3);
        border-radius: 2px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(128, 128, 128, 0.6);
      }
    `;

    const inject = () => {
      if (document.head) {
        document.head.appendChild(style);
      } else if (document.documentElement) {
        document.documentElement.appendChild(style);
      }
    };

    inject();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    }

    // Re-inject if React overwrites the DOM
    const observer = new MutationObserver(() => {
      if (!document.getElementById('viewx-compact-styles-v8')) {
        inject();
      }
    });

    const observe = () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    };

    if (document.body) {
      observe();
    } else {
      document.addEventListener('DOMContentLoaded', observe);
    }

    try {
      window.parent.postMessage({ type: 'tweetdeckx-compact-ready' }, '*');
    } catch (e) {}
  }

  function clearLegacyCenterOffsets() {
    document.querySelectorAll('[data-viewx-centered="true"]').forEach((element) => {
      element.style.removeProperty('position');
      element.style.removeProperty('left');
      element.style.removeProperty('right');
      element.style.removeProperty('transform');
      element.removeAttribute('data-viewx-centered');
    });
  }

  function applyHideAds(enabled) {
    const id = 'tweetdeckx-hide-ads';
    const existing = document.getElementById(id);
    if (enabled && !existing) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = `
        /* Hide promoted tweets (exclude cells containing video) */
        [data-testid="cellInnerDiv"]:has([data-testid="placementTracking"] > [data-testid="top-impression-pixel"]) {
          display: none !important;
        }

        /* Hide premium upsell banners */
        [data-testid="cellInnerDiv"]:has(a[href="/i/premium_sign_up"]),
        [data-testid="cellInnerDiv"]:has(a[href="/settings/monetization"]) {
          display: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    } else if (!enabled && existing) {
      existing.remove();
    }
  }

  function applyHideColumnHeader(enabled) {
    const id = 'tweetdeckx-hide-col-header';
    const existing = document.getElementById(id);
    if (enabled && !existing) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = `
        /* Hide X.com's in-iframe app bar (profile header, tweet-detail header, etc.).
           X.com wraps the whole column in a sticky wrapper (direct child of
           primaryColumn), and the actual header bar sits one level below that
           wrapper. We target the grandchild that contains the app-bar-back
           button so we hide the ~53px header without nuking the tweet list.
           Uses :has() which is supported in Chrome 105+. */
        [data-testid="primaryColumn"] > div > div:has([data-testid="app-bar-back"]) {
          display: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    } else if (!enabled && existing) {
      existing.remove();
    }
  }

  // View-X presets keep the default workspace useful without storing a
  // language-specific X URL. Following and topic timelines are tabs within
  // /home, so select them only after X has rendered its timeline tablist.
  function applyTimelinePreset(preset) {
    if (!preset || preset === 'likes' || window.location.pathname !== '/home') return;
    let attempts = 0;
    const selectPreset = () => {
      attempts += 1;
      const tablists = Array.from(document.querySelectorAll('[role="tablist"]'));
      const tablist = tablists.find((list) => {
        const text = (list.textContent || '').toLowerCase();
        return text.includes('for you') || text.includes('following') || text.includes('为你推荐') || text.includes('正在关注');
      });
      const tabs = tablist ? Array.from(tablist.querySelectorAll('[role="tab"]')) : [];
      if (tabs.length) {
        const label = (tab) => (tab.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        let target = null;
        if (preset === 'home') {
          target = tabs.find((tab) => /for you|为你推荐/.test(label(tab)));
        }
        if (preset === 'following') {
          target = tabs.find((tab) => /following|正在关注|关注中/.test(label(tab)));
        }
        if (preset.startsWith('topic:')) {
          const topicIndex = Number(preset.split(':')[1]);
          const topicTabs = tabs.filter((tab) => !/for you|following|为你推荐|正在关注|关注中/.test(label(tab)));
          target = topicTabs[topicIndex];
        }
        if (target && target.getAttribute('aria-selected') !== 'true') {
          target.click();
          return;
        }
        if (target) return;
      }
      if (attempts < 20) setTimeout(selectPreset, 750);
    };
    setTimeout(selectPreset, 250);
  }

  function publicHandleFromLink(link) {
    if (!link || !link.href) return null;
    try {
      const match = new URL(link.href, window.location.origin).pathname.match(/^\/([A-Za-z0-9_]{1,15})$/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  function findAccountHandle() {
    const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    const switcherText = accountSwitcher && [
      accountSwitcher.innerText,
      accountSwitcher.getAttribute('aria-label'),
      accountSwitcher.getAttribute('title'),
    ].filter(Boolean).join(' ');
    const switcherMatch = switcherText && switcherText.match(/@([A-Za-z0-9_]{1,15})\b/);
    if (switcherMatch) return switcherMatch[1];

    return publicHandleFromLink(document.querySelector('a[data-testid="AppTabBar_Profile_Link"]'));
  }

  function findAccountAvatar() {
    return document.querySelector(
      '[data-testid="SideNav_AccountSwitcher_Button"] img[src*="twimg.com"], ' +
      '[data-testid="AppTabBar_Profile_Link"] img[src*="twimg.com"]'
    );
  }

  // Likes require the current account handle. The avatar and public handle
  // arrive independently: current X layouts expose the account switcher even
  // when the profile navigation link is not present.
  function reportAccountHandleWhenReady() {
    let attempts = 0;
    const report = () => {
      attempts += 1;
      const avatar = findAccountAvatar();
      const avatarUrl = avatar ? (avatar.currentSrc || avatar.src || '') : '';
      if (avatarUrl && avatarUrl !== reportedAvatarUrl) {
        reportedAvatarUrl = avatarUrl;
        try { window.parent.postMessage({ type: 'tweetdeckx-account-avatar', avatarUrl }, '*'); } catch (error) {}
      }

      const handle = findAccountHandle();
      if (handle && handle !== reportedAccountHandle) {
        reportedAccountHandle = handle;
        try { window.parent.postMessage({ type: 'tweetdeckx-account-handle', handle, avatarUrl }, '*'); } catch (error) {}
      }

      if (attempts < 24 && (!reportedAccountHandle || !reportedAvatarUrl)) setTimeout(report, 750);
    };
    report();
  }

  // -------------------------------------------------------
  // PHASE 3: Intercept navigation to keep it in the iframe
  // -------------------------------------------------------

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      try {
        const url = new URL(link.href);
        if (url.hostname === 'x.com' || url.hostname === 'twitter.com') {
          return;
        }
        if (url.hostname !== window.location.hostname) {
          e.preventDefault();
          window.open(link.href, '_blank');
        }
      } catch (err) {}
    }
  }, true);
})();
