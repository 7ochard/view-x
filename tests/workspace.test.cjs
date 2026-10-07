const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = join(__dirname, '..');
const storageKey = 'viewx_workspace_v1';

// Minimal host for the extension's DOM events and chrome.storage contract.
// Network/rendering remain outside these lifecycle tests.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.style = { setProperty() {} };
    this.className = '';
    this.hidden = false;
    this.clientWidth = 1500;
    this.animations = [];
    this.classList = {
      contains: (name) => this.className.split(' ').includes(name),
      toggle: (name, force) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        this.className = [...classes].join(' ');
        return enabled;
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
    if (tag === 'iframe') this.contentWindow = { postMessage() {} };
  }
  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, target) {
    child.remove();
    child.parentNode = this;
    const index = this.children.indexOf(target);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceChildren() { [...this.children].forEach((child) => child.remove()); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  removeEventListener(name, callback) {
    this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== callback);
  }
  dispatch(name, fields = {}) {
    const event = { target: this, currentTarget: this, detail: 1, preventDefault() {}, stopPropagation() {}, ...fields };
    (this.listeners[name] || []).forEach((callback) => callback(event));
  }
  querySelectorAll(selector) {
    const matches = (element) => selector.startsWith('.')
      ? selector.slice(1).split('.').every((name) => element.classList.contains(name))
      : element.tagName === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  scrollIntoView() {}
  scrollTo() {}
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  animate() {
    const animation = { cancelled: false, cancel() { this.cancelled = true; } };
    this.animations.push(animation);
    return animation;
  }
}

async function openWorkspace(saved, { reducedMotion = false } = {}) {
  const document = new Element('document');
  document.body = document.appendChild(new Element('body'));
  document.documentElement = new Element('html');
  document.createElement = (tag) => new Element(tag);
  const ids = new Map();
  for (const match of readFileSync(join(root, 'deck.html'), 'utf8').matchAll(/id="([^"]+)"/g)) {
    ids.set(match[1], document.body.appendChild(new Element()));
  }
  document.getElementById = (id) => ids.get(id);
  const rail = document.body.appendChild(new Element());
  rail.className = 'workspace-bar';
  ids.get('add-column-trigger').appendChild(new Element('i'));
  ids.get('add-column-form').hidden = true;
  ids.get('columns-container').appendChild(ids.get('add-column-form'));
  const data = saved ? { [storageKey]: structuredClone(saved) } : {};
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document, console, URL, crypto: require('node:crypto').webcrypto,
    chrome: {
      storage: { local: {
        get: (_keys, callback) => callback(data),
        set: (value, callback) => { Object.assign(data, structuredClone(value)); callback(); },
      } },
      runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve() },
    },
    addEventListener: (name, callback) => { if (name === 'message') messages.push(callback); },
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearInterval: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => { timers.set(++timerId, callback); return timerId; },
    cancelAnimationFrame: (id) => timers.delete(id),
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0' }),
  });
  context.window = context;
  for (const file of ['workspace-storage.js', 'x-adapter.js', 'column.js', 'deck.js']) {
    const source = readFileSync(join(root, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  return {
    context, document, data, timers,
    columns: () => document.querySelectorAll('.workspace-column'),
    frames: () => document.querySelectorAll('iframe'),
    click: (id) => ids.get(id).dispatch('click'),
    select: (index) => ids.get('column-nav').children[index].dispatch('click'),
    report: (frame, payload) => messages.forEach((callback) => callback({ origin: 'https://x.com', source: frame.contentWindow, data: payload })),
  };
}

const model = (index, preset = null) => ({ id: `column-${index}`, sourceUrl: 'https://x.com/home', lastUrl: 'https://x.com/home', width: 480, preset });
const savedWorkspace = (columns) => ({ version: 2, initialized: true, settings: {}, columns });

test('new workspace opens the requested five columns and resolves Likes without a Home load', async () => {
  const app = await openWorkspace();
  const saved = app.data[storageKey];
  assert.deepEqual(saved.columns.map((column) => column.preset), ['home', 'following', 'topic:0', 'likes', null]);
  assert.equal(saved.columns[4].sourceUrl, 'https://x.com/explore');
  assert.equal(app.columns().length, 5);
  assert.equal(app.frames().length, 4);
  app.report(app.frames()[0], { type: 'tweetdeckx-account-handle', handle: 'example' });
  assert.equal(app.frames().length, 5);
  assert.equal(app.columns()[3].querySelector('iframe').src, 'https://x.com/example/likes');
});

test('old default order migrates once, preserving existing Likes and first timeline', async () => {
  const columns = ['home', 'following', 'topic:0', 'topic:1', 'likes'].map((preset, index) => model(index, preset));
  const app = await openWorkspace(savedWorkspace(columns));
  const migrated = app.data[storageKey];
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.columns.slice(0, 4).map((column) => column.id), ['column-0', 'column-1', 'column-2', 'column-4']);
  assert.equal(migrated.columns[4].sourceUrl, 'https://x.com/explore');
  const reopened = await openWorkspace(migrated);
  assert.deepEqual(reopened.data[storageKey], migrated);
});

test('custom columns and intentionally empty workspaces are preserved', async () => {
  const custom = savedWorkspace([model(0), model(1, 'topic:1')]);
  const app = await openWorkspace(custom);
  assert.deepEqual(app.data[storageKey], custom);
  assert.equal((await openWorkspace(savedWorkspace([]))).columns().length, 0);
});

test('hidden columns load only on reveal and repeated switches retain the frame', async () => {
  const app = await openWorkspace(savedWorkspace(Array.from({ length: 6 }, (_, index) => model(index))));
  assert.equal(app.frames().length, 5);
  app.select(5);
  assert.equal(app.frames().length, 6);
  assert.equal(app.columns()[5].classList.contains('is-layout-hidden'), false);
  const frame = app.columns()[5].querySelector('iframe');
  app.click('layout-columns-button');
  assert.equal(app.columns()[5].classList.contains('is-layout-hidden'), true);
  app.select(5);
  assert.equal(app.columns()[5].querySelector('iframe'), frame);
  assert.equal(app.frames().length, 6);
});

test('selection is immediate, expansion switches in place and Escape collapses it', async () => {
  const app = await openWorkspace();
  const frames = app.frames();
  app.select(0);
  app.click('expand-column-button');
  assert.equal(app.columns()[0].classList.contains('is-expanded'), true);
  app.select(1);
  assert.equal(app.columns()[0].classList.contains('is-expanded'), false);
  assert.equal(app.columns()[1].classList.contains('is-expanded'), true);
  assert.deepEqual(app.frames(), frames);
  app.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(app.document.body.classList.contains('workspace-has-expanded'), false);
  assert.equal(app.columns()[1].classList.contains('is-expanded'), false);
});

test('enabling sync prepares hidden columns and reduced motion skips animations', async () => {
  const app = await openWorkspace(savedWorkspace(Array.from({ length: 6 }, (_, index) => model(index))), { reducedMotion: true });
  assert.equal(app.frames().length, 5);
  app.click('scroll-sync-button');
  assert.equal(app.frames().length, 6);
  app.select(0);
  app.click('expand-column-button');
  assert.ok(app.columns().every((column) => column.querySelector('.column-frame-surface').animations.length === 0));
});

test('removing an expanded column cleans up its frame, timer and overlay', async () => {
  const app = await openWorkspace();
  app.select(0);
  app.click('expand-column-button');
  app.click('close-column-button');
  assert.equal(app.columns().length, 4);
  assert.equal(app.frames().length, 3);
  assert.equal(app.timers.size, 3);
  assert.equal(app.document.body.classList.contains('workspace-has-expanded'), false);
});
