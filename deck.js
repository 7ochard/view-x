import autoAnimate from './auto-animate.mjs';

// Deck owns the horizontal canvas, ordering, and the single global action rail.
// Columns stay content-only; XAdapter owns all X-specific behavior.
(function () {
  'use strict';

  const { WorkspaceStorage, XAdapter, Column } = window.ViewX;
  const DEFAULT_COLUMNS = [
    { url: 'https://x.com/home', preset: 'home' },
    { url: 'https://x.com/home', preset: 'following' },
    { url: 'https://x.com/home', preset: 'topic:0' },
    { url: 'https://x.com/home', preset: 'topic:1' },
    // Replaced with the signed-in account's likes URL once X reports it.
    { url: 'https://x.com/home', preset: 'likes' },
  ];
  const DEFAULT_VISIBLE_COLUMN_COUNT = 5;

  function seedInitialWorkspace(workspace, storage) {
    const needsDefaultColumns = workspace.columns.length === 0 && (
      !workspace.initialized || workspace.version < 2
    );
    if (!needsDefaultColumns) return false;
    workspace.columns = DEFAULT_COLUMNS.map((definition) => storage.createColumn(definition.url, definition.preset));
    workspace.initialized = true;
    workspace.version = 2;
    return true;
  }

  class Deck {
    constructor({ workspace, storage, adapter }) {
      this.workspace = workspace;
      this.storage = storage;
      this.adapter = adapter;
      this.columns = new Map();
      this.selectedColumnId = null;
      this.draggedColumnId = null;
      this.selectorClickTimer = null;
      this.writeQueue = Promise.resolve();
      this.toastTimer = null;
      this.onViewportResize = () => this.applyColumnLayout();

      this.rail = document.querySelector('.workspace-bar');
      this.container = document.getElementById('columns-container');
      this.emptyState = document.getElementById('empty-state');
      this.columnNav = document.getElementById('column-nav');
      this.addTrigger = document.getElementById('add-column-trigger');
      this.addTriggerIcon = this.addTrigger.querySelector('i');
      this.layoutButton = document.getElementById('layout-columns-button');
      this.addForm = document.getElementById('add-column-form');
      this.addCard = this.addForm;
      this.urlInput = document.getElementById('column-url');
      this.formError = document.getElementById('form-error');
      this.expandButton = document.getElementById('expand-column-button');
      this.refreshButton = document.getElementById('refresh-column-button');
      this.closeButton = document.getElementById('close-column-button');
      this.appearanceButton = document.getElementById('appearance-button');
      this.appearanceIcon = document.getElementById('appearance-icon');
      this.hideAdsButton = document.getElementById('hide-ads-button');
      this.hideColumnHeaderButton = document.getElementById('hide-column-header-button');
      this.settingsButton = document.getElementById('settings-button');
      this.settingsPanel = document.getElementById('settings-panel');
      this.accentButtons = Array.from(document.querySelectorAll('.accent-swatch'));
      this.avatarImage = document.getElementById('x-avatar-image');
      this.avatarFallback = document.getElementById('x-avatar-fallback');
      this.toast = document.getElementById('toast');
    }

    mount() {
      this.applyTheme();
      this.updatePreferenceControls();
      this.columnMotion = autoAnimate(this.container, {
        duration: 160,
        easing: 'cubic-bezier(.2, .8, .2, 1)',
      });
      this.applyColumnLayout();
      this.updateAddTrigger(false);
      window.addEventListener('resize', this.onViewportResize);

      this.addTrigger.addEventListener('click', () => this.toggleAddForm());
      this.layoutButton.addEventListener('click', () => this.cycleColumnLayout());
      this.addForm.addEventListener('submit', (event) => this.addColumnFromForm(event));
      this.urlInput.addEventListener('input', () => this.clearFormError());
      this.settingsButton.addEventListener('click', () => this.toggleSettings());
      this.expandButton.addEventListener('click', () => this.getSelectedColumn()?.toggleExpand());
      this.refreshButton.addEventListener('click', () => this.getSelectedColumn()?.refresh());
      this.closeButton.addEventListener('click', () => {
        const column = this.getSelectedColumn();
        if (column) this.removeColumn(column.model.id);
      });

      document.addEventListener('click', (event) => {
        if (this.rail.contains(event.target) || this.addCard.contains(event.target)) return;
        this.closeAddForm();
        this.closeSettings();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        this.closeAddForm();
        this.closeSettings();
        this.clearFormError();
      });

      this.appearanceButton.addEventListener('click', () => {
        this.workspace.settings.theme = this.workspace.settings.theme === 'light' ? 'dark' : 'light';
        this.applyTheme();
        this.updatePreferenceControls();
        this.persist();
      });
      this.hideAdsButton.addEventListener('click', () => {
        this.workspace.settings.hideAds = !this.workspace.settings.hideAds;
        this.adapter.updateSettings(this.workspace.settings);
        this.updatePreferenceControls();
        this.persist();
      });
      this.hideColumnHeaderButton.addEventListener('click', () => {
        this.workspace.settings.hideColumnHeader = !this.workspace.settings.hideColumnHeader;
        this.adapter.updateSettings(this.workspace.settings);
        this.updatePreferenceControls();
        this.persist();
      });
      this.accentButtons.forEach((button) => {
        button.addEventListener('click', () => {
          this.workspace.settings.accent = button.dataset.accent;
          this.applyTheme();
          this.updatePreferenceControls();
          this.persist();
          this.closeSettings();
        });
      });

      this.workspace.columns.forEach((model) => this.mountColumn(model));
      this.applyColumnLayout();
      this.renderColumnNav();
      this.syncSelectionUI();
      this.updateEmptyState();

      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'tweetdeckx-update-available') {
          this.showToast(`TweetDeckX ${message.version} is available upstream.`);
        }
      });
      chrome.runtime.sendMessage({ type: 'tweetdeckx-check-update' }).catch(() => {});
    }

    applyTheme() {
      document.documentElement.dataset.theme = this.workspace.settings.theme === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.accent = this.workspace.settings.accent;
    }

    updatePreferenceControls() {
      this.appearanceButton.setAttribute('aria-pressed', String(this.workspace.settings.theme === 'light'));
      this.appearanceIcon.className = this.workspace.settings.theme === 'light' ? 'ri-sun-line' : 'ri-moon-line';
      this.hideAdsButton.setAttribute('aria-pressed', String(Boolean(this.workspace.settings.hideAds)));
      this.hideColumnHeaderButton.setAttribute('aria-pressed', String(Boolean(this.workspace.settings.hideColumnHeader)));
      this.accentButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.accent === this.workspace.settings.accent));
      });
    }

    getVisibleColumnCount() {
      const total = this.workspace.columns.length;
      if (total < 2) return total;
      const selected = Number(this.workspace.settings.layoutColumns);
      return Number.isInteger(selected) && selected >= 2 && selected <= total
        ? selected
        : Math.min(DEFAULT_VISIBLE_COLUMN_COUNT, total);
    }

    applyColumnLayout() {
      const total = this.workspace.columns.length;
      const visible = this.getVisibleColumnCount();
      const selected = Number(this.workspace.settings.layoutColumns);
      const hasLayoutOverride = total >= 2
        && Number.isInteger(selected)
        && selected >= 2
        && selected <= total;
      const hasAddCard = !this.addForm.hidden;
      const containerStyle = window.getComputedStyle(this.container);
      const horizontalPadding = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
      const availableWidth = Math.max(0, this.container.clientWidth - horizontalPadding);
      const slotCount = Math.max(visible + (hasAddCard ? 1 : 0), 1);
      // The five-column width is the canvas baseline. It tracks the available
      // browser space, so columns never depend on a fixed pixel minimum.
      const fiveColumnWidth = Math.max(1, Math.floor(availableWidth / 5));
      const responsiveWidth = Math.max(fiveColumnWidth, Math.floor(availableWidth / slotCount));

      this.container.style.setProperty('--layout-columns', String(Math.max(visible, 1)));
      this.container.style.setProperty('--responsive-column-min-width', `${fiveColumnWidth}px`);
      this.container.style.setProperty('--responsive-column-width', `${responsiveWidth}px`);
      this.container.classList.toggle('is-responsive-layout', total > 0 || hasAddCard);
      this.container.classList.toggle('is-add-card-open', hasAddCard);
      this.workspace.columns.forEach((model, index) => {
        this.columns.get(model.id)?.element.classList.toggle('is-layout-hidden', index >= visible);
      });
      const selectedIndex = this.workspace.columns.findIndex((model) => model.id === this.selectedColumnId);
      if (selectedIndex >= visible) this.selectColumn(null);
      this.layoutButton.disabled = total < 2;
      this.layoutButton.setAttribute(
        'aria-label',
        total < 2 ? 'Add another column to change layout' : `Show ${visible} columns at once`
      );
      this.layoutButton.setAttribute('aria-pressed', String(hasLayoutOverride));
    }

    cycleColumnLayout() {
      const total = this.workspace.columns.length;
      if (total < 2) return;
      const selected = Number(this.workspace.settings.layoutColumns);
      const hasSelection = Number.isInteger(selected) && selected >= 2 && selected <= total;
      if (!hasSelection || (selected >= total && total === DEFAULT_VISIBLE_COLUMN_COUNT)) {
        this.workspace.settings.layoutColumns = 2;
      } else if (selected >= total) {
        this.workspace.settings.layoutColumns = total <= DEFAULT_VISIBLE_COLUMN_COUNT ? 2 : null;
      } else {
        this.workspace.settings.layoutColumns = selected + 1;
      }
      this.applyColumnLayout();
      this.persist();
    }

    mountColumn(model) {
      const column = new Column({
        model,
        adapter: this.adapter,
        onChange: () => this.persist(),
      });
      column.mount(this.container);
      if (this.addCard) this.container.insertBefore(column.element, this.addCard);
      this.columns.set(model.id, column);
      return column;
    }

    renderColumnNav() {
      this.columnNav.replaceChildren();
      this.workspace.columns.forEach((model, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'column-nav-button';
        button.dataset.columnId = model.id;
        button.draggable = true;
        if (index < 9) {
          const icon = document.createElement('i');
          icon.className = `ri-number-${index + 1}`;
          icon.setAttribute('aria-hidden', 'true');
          button.appendChild(icon);
        } else {
          button.textContent = String(index + 1);
        }
        button.setAttribute('aria-label', `Open column ${index + 1}`);
        button.classList.toggle('is-active', model.id === this.selectedColumnId);
        button.addEventListener('click', (event) => this.queueSelectorClick(event, model.id));
        button.addEventListener('dblclick', (event) => this.deleteFromSelector(event, model.id));
        button.addEventListener('dragstart', (event) => this.startDrag(event, model.id));
        button.addEventListener('dragover', (event) => this.overDrag(event, model.id));
        button.addEventListener('dragleave', () => button.classList.remove('is-drag-over'));
        button.addEventListener('drop', (event) => this.dropDrag(event, model.id));
        button.addEventListener('dragend', () => this.finishDrag());
        this.columnNav.appendChild(button);
      });
    }

    async addColumnFromForm(event) {
      event.preventDefault();
      try {
        const sourceUrl = this.adapter.normalizeUrl(this.urlInput.value);
        const model = this.storage.createColumn(sourceUrl);
        this.workspace.columns.push(model);
        if (this.workspace.columns.length > DEFAULT_VISIBLE_COLUMN_COUNT) {
          this.workspace.settings.layoutColumns = this.workspace.columns.length;
        }
        this.mountColumn(model);
        this.applyColumnLayout();
        this.renderColumnNav();
        this.syncSelectionUI();
        this.urlInput.value = '';
        this.clearFormError();
        this.closeAddForm();
        this.updateEmptyState();
        this.persist();
        requestAnimationFrame(() => this.container.scrollTo({ left: this.container.scrollWidth, behavior: 'smooth' }));
      } catch (error) {
        this.showFormError(error.message || 'Could not add this column.');
      }
    }

    removeColumn(columnId) {
      const column = this.columns.get(columnId);
      if (!column) return;
      column.destroy();
      this.columns.delete(columnId);
      this.workspace.columns = this.workspace.columns.filter((item) => item.id !== columnId);
      if (this.selectedColumnId === columnId) this.selectedColumnId = null;
      this.applyColumnLayout();
      if (!document.querySelector('.workspace-column.is-expanded')) document.body.classList.remove('workspace-has-expanded');
      this.renderColumnNav();
      this.syncSelectionUI();
      this.updateEmptyState();
      this.persist();
    }

    selectColumn(columnId, { reveal = false } = {}) {
      this.selectedColumnId = columnId && this.columns.has(columnId) ? columnId : null;
      this.syncSelectionUI();
      if (reveal && this.getSelectedColumn()) {
        this.getSelectedColumn().element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }

    syncSelectionUI() {
      this.columnNav.querySelectorAll('.column-nav-button').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.columnId === this.selectedColumnId);
      });
      const hasSelectedColumn = Boolean(this.getSelectedColumn());
      [this.expandButton, this.refreshButton, this.closeButton].forEach((button) => {
        button.disabled = !hasSelectedColumn;
      });
    }

    getSelectedColumn() {
      return this.selectedColumnId ? this.columns.get(this.selectedColumnId) : null;
    }

    handleColumnClick(columnId) {
      this.selectColumn(columnId);
    }

    queueSelectorClick(event, columnId) {
      event.preventDefault();
      this.cancelSelectorClick();
      this.selectorClickTimer = window.setTimeout(() => {
        this.selectorClickTimer = null;
        if (!this.draggedColumnId) this.selectColumn(columnId, { reveal: true });
      }, 200);
    }

    deleteFromSelector(event, columnId) {
      event.preventDefault();
      event.stopPropagation();
      this.cancelSelectorClick();
      this.removeColumn(columnId);
    }

    cancelSelectorClick() {
      if (this.selectorClickTimer === null) return;
      window.clearTimeout(this.selectorClickTimer);
      this.selectorClickTimer = null;
    }

    handleNavigate(columnId, url) {
      const column = this.columns.get(columnId);
      if (column) column.setLastUrl(url);
    }

    handleLightbox(columnId, opened) {
      const column = this.columns.get(columnId);
      if (!column) return;
      column.toggleExpand(opened);
    }

    handleAccount(handle, avatarUrl) {
      if (avatarUrl) this.setAvatar(avatarUrl);
      const likesUrl = this.adapter.normalizeUrl(`https://x.com/${handle}/likes`);
      let changed = false;
      this.workspace.columns.filter((model) => model.preset === 'likes').forEach((model) => {
        if (model.accountHandle === handle) return;
        const shouldRefresh = model.lastUrl !== likesUrl || model.sourceUrl !== likesUrl;
        model.accountHandle = handle;
        if (shouldRefresh) {
          model.sourceUrl = likesUrl;
          model.lastUrl = likesUrl;
          this.columns.get(model.id)?.refresh();
        }
        changed = true;
      });
      if (changed) this.persist();
    }

    setAvatar(rawUrl) {
      try {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' || !/^(?:(?:pbs|abs)\.)?twimg\.com$/i.test(url.hostname)) return;
        this.avatarImage.onload = () => {
          this.avatarImage.hidden = false;
          this.avatarFallback.hidden = true;
        };
        this.avatarImage.onerror = () => {
          this.avatarImage.removeAttribute('src');
          this.avatarImage.hidden = true;
          this.avatarFallback.hidden = false;
        };
        this.avatarImage.hidden = true;
        this.avatarFallback.hidden = false;
        this.avatarImage.src = url.toString();
      } catch (error) {
        // Keep the X fallback mark when X does not expose an avatar yet.
      }
    }

    startDrag(event, columnId) {
      this.cancelSelectorClick();
      this.draggedColumnId = columnId;
      this.columns.get(columnId)?.element.classList.add('is-dragging');
      event.currentTarget.classList.add('is-dragging');
      document.body.classList.add('is-reordering');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', columnId);
    }

    overDrag(event, targetId) {
      if (!this.draggedColumnId || this.draggedColumnId === targetId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      event.currentTarget.classList.add('is-drag-over');
    }

    dropDrag(event, targetId) {
      event.preventDefault();
      event.currentTarget.classList.remove('is-drag-over');
      if (!this.draggedColumnId || this.draggedColumnId === targetId) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      this.reorderColumns(this.draggedColumnId, targetId, event.clientY > bounds.top + bounds.height / 2);
      this.finishDrag();
    }

    finishDrag() {
      this.draggedColumnId = null;
      document.body.classList.remove('is-reordering');
      this.container.querySelectorAll('.is-dragging').forEach((item) => item.classList.remove('is-dragging'));
      this.columnNav.querySelectorAll('.is-dragging, .is-drag-over').forEach((item) => {
        item.classList.remove('is-dragging', 'is-drag-over');
      });
    }

    reorderColumns(fromId, targetId, placeAfter) {
      const fromIndex = this.workspace.columns.findIndex((column) => column.id === fromId);
      const targetIndex = this.workspace.columns.findIndex((column) => column.id === targetId);
      if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;
      const [moved] = this.workspace.columns.splice(fromIndex, 1);
      let insertionIndex = targetIndex + (placeAfter ? 1 : 0);
      if (fromIndex < insertionIndex) insertionIndex -= 1;
      this.workspace.columns.splice(insertionIndex, 0, moved);

      const movedElement = this.columns.get(fromId).element;
      const targetElement = this.columns.get(targetId).element;
      if (placeAfter) this.container.insertBefore(movedElement, targetElement.nextSibling);
      else this.container.insertBefore(movedElement, targetElement);
      this.applyColumnLayout();
      this.renderColumnNav();
      this.syncSelectionUI();
      this.persist();
    }

    updateEmptyState() {
      this.emptyState.classList.toggle('is-hidden', this.workspace.columns.length > 0);
    }

    persist() {
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.storage.save(this.workspace))
        .catch(() => this.showToast('Workspace changes could not be saved.'));
      return this.writeQueue;
    }

    toggleAddForm() {
      if (this.addForm.hidden) this.openAddForm();
      else this.closeAddForm();
    }

    openAddForm() {
      if (this.addForm.hidden) this.addForm.hidden = false;
      this.updateAddTrigger(true);
      this.closeSettings();
      this.applyColumnLayout();
      this.addCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      setTimeout(() => this.urlInput.focus(), 0);
    }

    closeAddForm() {
      const wasOpen = !this.addForm.hidden;
      this.addForm.hidden = true;
      this.updateAddTrigger(false);
      if (wasOpen) this.applyColumnLayout();
    }

    updateAddTrigger(isOpen) {
      this.addTrigger.setAttribute('aria-expanded', String(isOpen));
      this.addTrigger.setAttribute('aria-label', isOpen ? 'Close add column' : 'Add column');
      this.addTriggerIcon.className = isOpen ? 'ri-subtract-line' : 'ri-add-line';
    }

    toggleSettings() {
      const opening = this.settingsPanel.hidden;
      this.settingsPanel.hidden = !opening;
      this.settingsButton.setAttribute('aria-expanded', String(opening));
      this.closeAddForm();
    }

    closeSettings() {
      this.settingsPanel.hidden = true;
      this.settingsButton.setAttribute('aria-expanded', 'false');
    }

    showFormError(message) {
      this.formError.textContent = message;
      this.formError.classList.add('is-visible');
    }

    clearFormError() {
      this.formError.textContent = '';
      this.formError.classList.remove('is-visible');
    }

    showToast(message) {
      this.toast.textContent = message;
      this.toast.hidden = false;
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => { this.toast.hidden = true; }, 8_000);
    }
  }

  async function init() {
    const storage = new WorkspaceStorage();
    const workspace = await storage.load();
    // Layout is a transient view choice: every new extension page starts in
    // the five-column workspace view rather than restoring 2/3/4 columns.
    workspace.settings.layoutColumns = null;
    const seeded = seedInitialWorkspace(workspace, storage);
    if (seeded) await storage.save(workspace);

    let deck;
    const adapter = new XAdapter({
      settings: workspace.settings,
      onNavigate: (columnId, url) => deck.handleNavigate(columnId, url),
      onLightbox: (columnId, opened) => deck.handleLightbox(columnId, opened),
      onColumnClick: (columnId) => deck.handleColumnClick(columnId),
      onRateLimit: () => deck.showToast('X is rate limiting requests. Loading is temporarily paused.'),
      onAccount: (handle, avatarUrl) => deck.handleAccount(handle, avatarUrl),
      onAvatar: (avatarUrl) => deck.setAvatar(avatarUrl),
    });
    deck = new Deck({ workspace, storage, adapter });
    deck.mount();
  }

  init().catch((error) => {
    console.error('[View-X] failed to initialize:', error);
    const errorElement = document.getElementById('form-error');
    errorElement.textContent = 'View-X could not open this workspace.';
    errorElement.classList.add('is-visible');
  });
})();
