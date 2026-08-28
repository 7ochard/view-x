importScripts('x-adapter-background.js');

// Generic extension shell. X session, headers and 429 handling are delegated
// to the adapter companion loaded above.
ViewXAdapterBackground.init();

chrome.action.onClicked.addListener(async () => {
  const deckUrl = chrome.runtime.getURL('deck.html');
  const tabs = await chrome.tabs.query({ url: deckUrl });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: deckUrl });
});

// Update notification remains intentionally separate from the X adapter.
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/ngalatis/TweetdeckX/releases/latest';
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function compareVersions(current, candidate) {
  const left = current.split('.').map(Number);
  const right = candidate.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] || 0;
    const b = right[index] || 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate() {
  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!response.ok) return;
    const release = await response.json();
    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    if (!latestVersion) return;

    const currentVersion = chrome.runtime.getManifest().version;
    if (compareVersions(currentVersion, latestVersion) < 0) {
      chrome.runtime.sendMessage({
        type: 'tweetdeckx-update-available',
        version: latestVersion,
        url: release.html_url,
      }).catch(() => {});
    }
  } catch (error) {
    // Update availability never blocks the workspace.
  }
}

setTimeout(checkForUpdate, 10_000);
setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL);
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'tweetdeckx-check-update') checkForUpdate();
});
