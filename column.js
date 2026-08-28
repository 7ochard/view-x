// A single View-X content surface. Global actions live in Deck's left rail;
// Column owns only iframe lifecycle, local resize, and transient expansion.
(function () {
  'use strict';

  class Column {
    constructor({ model, adapter, onChange } = {}) {
      this.model = model;
      this.adapter = adapter;
      this.onChange = onChange || (() => {});
      this.element = null;
      this.resizeState = null;
      this.refreshTimer = null;
      this.onKeyDown = this.handleKeyDown.bind(this);
    }

    mount(parent) {
      const element = document.createElement('article');
      element.className = 'workspace-column';
      element.dataset.columnId = this.model.id;

      const frameSurface = document.createElement('div');
      frameSurface.className = 'column-frame-surface';
      const loading = document.createElement('div');
      loading.className = 'column-loading';
      loading.textContent = 'Loading X';
      frameSurface.appendChild(loading);
      element.appendChild(frameSurface);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'column-resize-handle';
      resizeHandle.tabIndex = 0;
      resizeHandle.setAttribute('role', 'separator');
      resizeHandle.setAttribute('aria-orientation', 'vertical');
      resizeHandle.setAttribute('aria-label', 'Resize column');
      resizeHandle.addEventListener('pointerdown', (event) => this.startResize(event));
      resizeHandle.addEventListener('keydown', (event) => this.resizeByKeyboard(event));
      element.appendChild(resizeHandle);

      const collapseButton = document.createElement('button');
      collapseButton.className = 'column-collapse-button';
      collapseButton.type = 'button';
      collapseButton.setAttribute('aria-label', 'Return to workspace');
      collapseButton.innerHTML = '<i class="ri-arrow-turn-forward-line" aria-hidden="true"></i>';
      collapseButton.addEventListener('click', () => this.toggleExpand(false));
      element.appendChild(collapseButton);

      this.element = element;
      this.applyWidth(this.model.width, false);
      parent.appendChild(element);

      const frame = this.adapter.createFrame(this.model);
      frame.addEventListener('load', () => loading.remove(), { once: true });
      frameSurface.appendChild(frame);

      this.refreshTimer = window.setInterval(() => this.adapter.burst(this.model.id), 300_000);
      document.addEventListener('keydown', this.onKeyDown);
      return element;
    }

    refresh() {
      this.adapter.refresh(this.model.id, this.model.lastUrl);
    }

    setLastUrl(url) {
      if (this.model.lastUrl === url) return;
      this.model.lastUrl = url;
      this.onChange(this);
    }

    applyWidth(width, persist) {
      this.model.width = width;
      if (this.element) {
        this.element.style.setProperty('--column-width', `${width}px`);
        this.element.style.flexBasis = `${width}px`;
        this.element.style.width = `${width}px`;
      }
      this.adapter.updateColumnWidth(this.model.id, width);
      if (persist) this.onChange(this);
    }

    startResize(event) {
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      this.resizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: this.model.width,
      };
      this.element.classList.add('is-resizing');
      const move = (moveEvent) => this.moveResize(moveEvent);
      const end = (endEvent) => {
        if (!this.resizeState || endEvent.pointerId !== this.resizeState.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        this.finishResize();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    }

    moveResize(event) {
      if (!this.resizeState || event.pointerId !== this.resizeState.pointerId) return;
      const width = Math.max(
        window.ViewX.MIN_COLUMN_WIDTH,
        Math.min(window.ViewX.MAX_COLUMN_WIDTH, this.resizeState.startWidth + event.clientX - this.resizeState.startX)
      );
      this.applyWidth(width, false);
    }

    finishResize() {
      if (!this.resizeState) return;
      this.resizeState = null;
      this.element.classList.remove('is-resizing');
      this.applyWidth(Math.round(this.model.width), true);
    }

    resizeByKeyboard(event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -20 : 20;
      const next = Math.max(
        window.ViewX.MIN_COLUMN_WIDTH,
        Math.min(window.ViewX.MAX_COLUMN_WIDTH, this.model.width + delta)
      );
      this.applyWidth(next, true);
    }

    toggleExpand(force) {
      if (!this.element) return;
      const shouldExpand = typeof force === 'boolean' ? force : !this.element.classList.contains('is-expanded');
      if (shouldExpand) {
        document.querySelectorAll('.workspace-column.is-expanded').forEach((column) => {
          if (column !== this.element) column.classList.remove('is-expanded');
        });
      }
      this.element.classList.toggle('is-expanded', shouldExpand);
      document.body.classList.toggle('workspace-has-expanded', shouldExpand);
    }

    handleKeyDown(event) {
      if (event.key === 'Escape' && this.element && this.element.classList.contains('is-expanded')) {
        this.toggleExpand(false);
      }
    }

    destroy() {
      window.clearInterval(this.refreshTimer);
      document.removeEventListener('keydown', this.onKeyDown);
      if (this.element && this.element.classList.contains('is-expanded')) {
        document.body.classList.remove('workspace-has-expanded');
      }
      this.adapter.destroy(this.model.id);
      if (this.element) this.element.remove();
      this.element = null;
    }
  }

  window.ViewX = window.ViewX || {};
  window.ViewX.Column = Column;
})();
