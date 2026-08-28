// X-specific service-worker integration: session cookies, CSRF header rules
// and rate-limit events. background.js only owns opening the View-X tab and
// generic release notifications.
(function () {
  'use strict';

  let initialized = false;
  let csrfDebounceTimer = null;

  async function updateCsrfRules() {
    const cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
    const ct0 = cookie ? cookie.value : null;
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules.map((rule) => rule.id);

    if (!ct0) {
      if (removeRuleIds.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
      return;
    }

    const addRules = [
      {
        id: 1000,
        priority: 3,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'x-csrf-token', operation: 'set', value: ct0 }],
        },
        condition: { urlFilter: '||api.x.com', resourceTypes: ['xmlhttprequest'] },
      },
      {
        id: 1001,
        priority: 3,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'x-csrf-token', operation: 'set', value: ct0 }],
        },
        condition: { urlFilter: '||x.com/i/api', resourceTypes: ['xmlhttprequest'] },
      },
    ];

    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    updateCsrfRules().catch(() => {});
    chrome.cookies.onChanged.addListener((changeInfo) => {
      if (!changeInfo.cookie.domain.includes('x.com')) return;
      clearTimeout(csrfDebounceTimer);
      csrfDebounceTimer = setTimeout(() => updateCsrfRules().catch(() => {}), 1000);
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== 'tweetdeckx-get-cookies') return;
      chrome.cookies.getAll({ domain: '.x.com' }, (cookies) => {
        sendResponse((cookies || [])
          .filter((cookie) => !cookie.httpOnly)
          .map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
          })));
      });
      return true;
    });

    chrome.webRequest.onCompleted.addListener(
      (details) => {
        if (details.statusCode !== 429) return;
        chrome.runtime.sendMessage({ type: 'tweetdeckx-rate-limited' }).catch(() => {});
      },
      { urls: ['https://x.com/*', 'https://api.x.com/*'] }
    );
  }

  globalThis.ViewXAdapterBackground = { init };
})();
