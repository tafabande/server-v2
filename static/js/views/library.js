/**
 * MediaHub - Library View
 * Full grid of all media, sortable and filterable.
 * Supports Folder Navigation and bulk operations!
 */
import { api, player, router } from '../app.js';
import { formatDuration, formatBytes, thumbUrl, toast, debounce, isAdultApproved, showAdultAccessDialog, showPinDialog, prefetchThumbnails, confirm, prompt, escapeHtml } from '../utils.js';

export class LibraryView {
    constructor(container) {
        this.container = container;
        this._fixedFormat = null;
        this._currentPath = localStorage.getItem('lib_current_path') || "";
        this._viewMode = localStorage.getItem('lib_view_mode') || 'table';
        this._folders = [];
        this._items = [];

        // Selection state
        this._selectionMode = false;
        this._selectedPaths = new Set();
        this._selectedMediaIds = new Set();
        this._lastSelectedMediaIndex = null;

        this.hoverTimeout = null;
        this.previewVideo = null;
        this._renderedCount = 0;
        this._observer = null;
        this._pageSize = 50;

        // Upload permissions and state
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        this._canUpload = user.role === 'admin' || user.role === 'family';
        this._queue = [];
        this._problems = [];
        this._dragDepth = 0;
        this._uploading = false;
    }

    async render() {
        const title = this._titleOverride || (this._fixedFormat ? (this._fixedFormat.charAt(0).toUpperCase() + this._fixedFormat.slice(1)) : 'Library');
        const isAdmin = this._isAdmin();

        if (!this.container.querySelector('.view-header')) {
            this.container.innerHTML = `
                <!-- Sticky 2-Row Header -->
                <div class="view-header" style="position: sticky; top: 0; z-index: 50; background: var(--bg); padding-bottom: 12px; border-bottom: 1px solid var(--border);">
                    <!-- Row 1: Identity & Search -->
                    <div class="flex-between mb-sm" style="align-items: center;">
                        <div style="flex-shrink: 0;">
                            <h1 class="page-title" style="margin-bottom: 4px;">${title}</h1>
                            <div id="lib-breadcrumbs" class="page-subtitle breadcrumbs"></div>
                        </div>
                        <div class="search-bar" style="margin-bottom:0; flex-grow: 1; max-width: 600px; margin-left: 24px;">
                            <input id="lib-search" class="input" type="text" placeholder="Search library..." style="width: 100%;">
                        </div>
                    </div>
                    
                    <!-- Row 2: Actions Toolbar -->
                    <div class="flex-between" style="align-items: center;">
                        <div class="flex gap-sm">
                            <select id="lib-sort" class="select" style="width:auto; min-width:100px">
                                <option value="title">A-Z</option>
                                <option value="date">Newest</option>
                                <option value="size">Size</option>
                                <option value="duration">Duration</option>
                            </select>
                            <button id="lib-sort-dir" class="btn btn-ghost btn-sm" title="Reverse Order" data-rev="false" style="padding: 0 8px;">⬇️</button>
                            <button id="lib-toggle" class="btn btn-ghost btn-sm" title="Toggle view">
                                ${this._viewMode === 'grid' ? '☰' : '▦'}
                            </button>
                        </div>
                        <div class="flex gap-sm">
                            <button id="lib-play-all" class="btn btn-accent btn-sm" title="Play All">▶ Play All</button>
                            ${this._canUpload ? `<button id="lib-toggle-upload" class="btn btn-ghost btn-sm" title="Upload">📤 Upload</button>` : ''}
                            ${isAdmin ? `<button id="lib-toggle-selection" class="btn btn-ghost btn-sm" title="Select">☑ Select</button>` : ''}
                        </div>
                    </div>
                </div>
                
                ${this._canUpload ? `
                <div id="lib-upload-panel" class="fade-in" style="display: none; padding: 24px 0; border-bottom: 1px solid var(--border);">
                    <div class="flex-between mb-sm">
                        <div class="section-title" style="margin-bottom: 0;">Upload Media</div>
                        <button id="upload-close-btn" class="btn-close" style="font-size: 1.2rem; cursor: pointer; background:none; border:none; color:var(--text-muted);">&times;</button>
                    </div>
                    
                    <!-- Step 1: Dropzone -->
                    <div id="upload-dropzone" class="upload-dropzone" style="border: 2px dashed var(--border); border-radius: var(--radius); padding: 32px; text-align: center; background: rgba(255,255,255,0.02); transition: all 0.2s; cursor: pointer; margin-bottom: 16px;">
                        <strong style="font-size: 1.1rem;">Drag & Drop files here</strong>
                        <p style="margin: 8px 0 0; color: var(--text-muted);">or click to browse files</p>
                        <input id="upload-file-input" type="file" hidden multiple>
                    </div>

                    <!-- Step 2: Details (Collapsible/Hidden by default) -->
                    <div id="upload-details-step" style="display: none; padding: 16px; background: var(--bg-hover); border-radius: var(--radius);">
                        <div style="font-weight: 600; margin-bottom: 12px; font-size: 0.9rem;">Upload Details</div>
                        <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 16px;">
                            <div class="form-group" style="flex: 1;">
                                <label style="display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">Destination Path</label>
                                <input id="upload-path" class="input" type="text" placeholder="Movies/Season 01" value="" style="width: 100%;">
                            </div>
                            <div class="form-group" style="width: 150px;">
                                <label style="display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">Folder PIN (if locked)</label>
                                <input id="upload-pin" class="input" type="password" placeholder="Optional" style="width: 100%;">
                            </div>
                            <div class="form-group" style="width: 120px;">
                                <label style="display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">Content Rating</label>
                                <select id="upload-rating" class="select" style="width: 100%;">
                                    <option value="sfw">Safe (SFW)</option>
                                    <option value="nsfw">Adult (18+)</option>
                                </select>
                            </div>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px;">
                            <div>
                                <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px;">Upload Queue</div>
                                <div id="upload-queue" style="max-height: 150px; overflow-y: auto; font-size: 0.8rem; display: flex; flex-direction: column; gap: 6px;">
                                    <div class="text-muted" style="font-style: italic;">No files selected.</div>
                                </div>
                            </div>
                            <div style="border-left: 1px solid var(--border); padding-left: 16px;">
                                <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px;">Recent Problems</div>
                                <div id="current_problems" style="max-height: 100px; overflow-y: auto; font-size: 0.75rem; display: flex; flex-direction: column; gap: 4px;">
                                    <div class="text-muted" style="font-style: italic;">No problems.</div>
                                </div>
                            </div>
                        </div>

                        <div class="flex gap-sm mt-md" style="justify-content: flex-end;">
                            <button id="upload-clear-btn" class="btn btn-ghost btn-sm">Clear Queue</button>
                            <button id="upload-start-btn" class="btn btn-accent btn-sm">Start Upload</button>
                        </div>
                    </div>
                </div>
                ` : ''}

                ${isAdmin ? `
                <div id="lib-selection-bar" class="fade-in flex-between" style="display: none; padding: 12px 0; border-bottom: 1px solid var(--accent); margin-top: 8px;">
                    <div class="flex gap-sm" style="align-items:center">
                        <span id="lib-selection-count" style="font-weight: 700; color: var(--accent);">0 selected</span>
                        <div style="width: 1px; height: 16px; background: var(--border); margin: 0 8px;"></div>
                        <button id="lib-bulk-lock" class="btn btn-sm btn-ghost">🔒 Lock</button>
                        <button id="lib-bulk-unlock" class="btn btn-sm btn-ghost">🔓 Unlock</button>
                        <button id="lib-bulk-r18" class="btn btn-sm btn-ghost">🔞 R18</button>
                        <button id="lib-bulk-unr18" class="btn btn-sm btn-ghost">✅ Safe</button>
                    </div>
                    <button id="lib-selection-cancel" class="btn btn-sm btn-ghost">Cancel</button>
                </div>` : ''}

                <div id="lib-content" class="fade-in" style="margin-top: 16px;">
                    <div class="skeleton-grid">
                        ${Array(8).fill().map(() => `
                            <div class="skeleton-card">
                                <div class="skeleton-poster shimmer-bg"></div>
                                <div class="skeleton-title shimmer-bg"></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div id="lib-sentinel" style="height: 20px;"></div>
            `;

            const searchInput = document.getElementById('lib-search');
            if (searchInput) {
                searchInput.addEventListener('input', debounce(() => this._renderContent(), 300));
            }

            document.getElementById('lib-sort')?.addEventListener('change', () => this._renderContent());
            document.getElementById('lib-sort-dir')?.addEventListener('click', (e) => {
                const btn = e.currentTarget;
                const isRev = btn.dataset.rev === 'true';
                btn.dataset.rev = !isRev;
                btn.textContent = !isRev ? '⬆️' : '⬇️';
                this._renderContent();
            });
            document.getElementById('lib-toggle')?.addEventListener('click', () => this._toggleView());
            document.getElementById('lib-play-all')?.addEventListener('click', () => this._playAll());

            if (this._canUpload) {
                document.getElementById('lib-toggle-upload')?.addEventListener('click', () => this._toggleUploadPanel());
                this._setupUploadEvents();
            }

            if (isAdmin) {
                document.getElementById('lib-toggle-selection')?.addEventListener('click', () => this._toggleSelectionMode());
                document.getElementById('lib-selection-cancel')?.addEventListener('click', () => this._toggleSelectionMode(false));
                document.getElementById('lib-bulk-lock')?.addEventListener('click', () => this._bulkAction('lock', true));
                document.getElementById('lib-bulk-unlock')?.addEventListener('click', () => this._bulkAction('lock', false));
                document.getElementById('lib-bulk-r18')?.addEventListener('click', () => this._bulkAction('r18', true));
                document.getElementById('lib-bulk-unr18')?.addEventListener('click', () => this._bulkAction('r18', false));
            }
            this._setupInfiniteScroll();
        } else {
            // DOM Diffing: Update title without rebuilding shell
            const titleEl = this.container.querySelector('.page-title');
            if (titleEl) titleEl.textContent = title;
        }

        await this._loadPath(this._currentPath);
    }

    _setupInfiniteScroll() {
        if (this._observer) {
            this._observer.disconnect();
        }
        this._observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && this._filteredItems && this._renderedCount < this._filteredItems.length) {
                this._renderNextBatch();
            }
        }, { rootMargin: '400px' });

        const sentinel = document.getElementById('lib-sentinel');
        if (sentinel) this._observer.observe(sentinel);
    }

    _renderBreadcrumbs() {
        const bc = document.getElementById('lib-breadcrumbs');
        if (!bc) return;

        if (!this._currentPath) {
            bc.innerHTML = `<span class="breadcrumb-item active">Root</span>`;
            return;
        }

        let html = `<a href="#" class="breadcrumb-link" data-path="">Root</a>`;
        const parts = this._currentPath.split('/');
        let cur = "";

        for (let i = 0; i < parts.length; i++) {
            cur += (i === 0 ? "" : "/") + parts[i];
            html += ` <span class="breadcrumb-sep">/</span> `;
            if (i === parts.length - 1) {
                html += `<span class="breadcrumb-item active">${parts[i]}</span>`;
            } else {
                html += `<a href="#" class="breadcrumb-link" data-path="${cur}">${parts[i]}</a>`;
            }
        }

        bc.innerHTML = html;

        bc.querySelectorAll('.breadcrumb-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this._loadPath(e.target.dataset.path);
            });
        });
    }

    async _loadPath(path) {
        this._currentPath = path;
        localStorage.setItem('lib_current_path', path);
        this._renderBreadcrumbs();

        const pathInput = document.getElementById('upload-path');
        if (pathInput) {
            pathInput.value = path;
        }
        this._syncDestinationLabel(path);

        const target = document.getElementById('lib-content');
        if (target) {
            target.innerHTML = `
                <div class="skeleton-grid fade-in">
                    ${Array(8).fill().map(() => `
                        <div class="skeleton-card">
                            <div class="skeleton-poster shimmer-bg"></div>
                            <div class="skeleton-title shimmer-bg"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        try {
            const res = await (typeof api.getFolders === 'function' ? api.getFolders(path) : api._fetch(`/media/folders?path=${encodeURIComponent(String(path))}`));
            this._folders = res.folders || [];
            this._items = res.items || [];

            prefetchThumbnails(this._items, 10);
            this._renderContent();
        } catch (err) {
            const target = document.getElementById('lib-content');
            if (target) {
                target.innerHTML =
                    `<div class="empty-state">
                        <div class="empty-icon">Y"?</div>
                        <h3>Connection Error</h3>
                        <p>${err.message}</p>
                    </div>`;
            }
        }
    }

    _toggleSelectionMode(force = null) {
        this._selectionMode = force !== null ? force : !this._selectionMode;
        this._selectedPaths.clear();
        this._selectedMediaIds.clear();
        this._lastSelectedMediaIndex = null;

        document.getElementById('lib-selection-bar').style.display = this._selectionMode ? 'flex' : 'none';
        document.getElementById('lib-toggle-selection').classList.toggle('btn-accent', this._selectionMode);

        this._renderContent();
    }

    _updateSelectionCount() {
        const count = this._selectedPaths.size + this._selectedMediaIds.size;
        document.getElementById('lib-selection-count').textContent = `${count} selected`;
    }

    async _bulkAction(type, value) {
        if (this._selectedPaths.size === 0 && this._selectedMediaIds.size === 0) return;

        let confirmationMessage = '';
        if (type === 'r18') {
            confirmationMessage = `Are you sure you want to mark ${this._selectedPaths.size + this._selectedMediaIds.size} item(s) as R18 / Adult Content?`;
        } else if (type === 'unr18') {
            confirmationMessage = `Are you sure you want to mark ${this._selectedPaths.size + this._selectedMediaIds.size} item(s) as Safe Content?`;
        }
        if (confirmationMessage && !(await confirm('Bulk Action Confirmation', confirmationMessage))) {
            return; // User cancelled
        }

        try {
            // Folders (Sequential for backend safety, or parallel)
            const folderPromises = Array.from(this._selectedPaths).map(path => {
                if (type === 'lock') return api.toggleFolderLock(path, value);
                if (type === 'r18') return api.toggleFolderR18(path, value);
                return Promise.resolve();
            });

            // Media items
            const mediaPromises = Array.from(this._selectedMediaIds).map(id => {
                if (type === 'lock') {
                    const media = this._items.find(m => String(m.id) === id);
                    if (media && media.requires_pin !== value) {
                        return api.toggleLock(id);
                    }
                }
                return Promise.resolve();
            });

            await Promise.all([...folderPromises, ...mediaPromises]);

            toast('Bulk operation successful', 'success');
            this._toggleSelectionMode(false);
            this._loadPath(this._currentPath); // Refresh
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    _renderContent() {
        const target = document.getElementById('lib-content');
        if (!target) return;

        const q = (document.getElementById('lib-search')?.value || '').toLowerCase();
        const sort = document.getElementById('lib-sort')?.value || 'title';
        const reverse = document.getElementById('lib-sort-dir')?.dataset.rev === 'true';

        // Filter folders and items
        let fFolders = this._folders.filter(f => !q || f.name.toLowerCase().includes(q));
        let fItems = this._items.filter(m => !q || (m.title && m.title.toLowerCase().includes(q)) || (m.filename && m.filename.toLowerCase().includes(q)));

        // Always sort folders alphabetically
        fFolders.sort((a, b) => a.name.localeCompare(b.name));

        // Apply selected sort to media items
        if (sort === 'date') {
            fItems.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        } else if (sort === 'size') {
            fItems.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));
        } else if (sort === 'duration') {
            fItems.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
        } else {
            fItems.sort((a, b) => (a.title || a.filename || '').localeCompare(b.title || b.filename || ''));
        }

        if (reverse) {
            fItems.reverse();
            fFolders.reverse();
        }
        this._filteredItems = fItems;

        if (fFolders.length === 0 && fItems.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = `
                <div class="empty-icon">Y"?</div>
                <h2>Hapana chinhu pano! Doko mo nai yo.</h2>
                <p style="margin-top: 8px;">No content in this folder.</p>
            `;
            target.replaceChildren(emptyDiv);
            return;
        }

        const isAdmin = this._isAdmin();

        // 1. Maintain a persistent structure in lib-content
        let foldersContainer = document.getElementById('lib-folder-container');
        let itemsGrid = document.getElementById('lib-items-grid');

        if (!foldersContainer) {
            target.innerHTML = `
                <div id="lib-folder-container" class="folder-list mb-lg"></div>
                <div id="lib-items-grid" class="mode-${this._viewMode}"></div>
            `;
            foldersContainer = document.getElementById('lib-folder-container');
            itemsGrid = document.getElementById('lib-items-grid');
        } else {
            // Update mode class if toggled
            itemsGrid.className = `mode-${this._viewMode}`;
        }

        // 2. Render Folders (List Rows)
        foldersContainer.innerHTML = '';
        if (fFolders.length > 0) {
            fFolders.forEach(folder => {
                const blurClass = folder.is_locked ? 'blur-sm' : '';
                const lockBadge = folder.is_locked ? `🔒 ` : '';
                const r18Badge = folder.is_adult ? `🔞 ` : '';
                
                const folderCard = document.createElement('div');
                folderCard.className = 'folder-row';
                folderCard.dataset.path = folder.path;

                if (this._selectionMode && this._selectedPaths.has(folder.path)) {
                    folderCard.classList.add('selected');
                }

                folderCard.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                        <span style="font-size: 1.2rem;">📁</span>
                        <div style="flex-grow: 1;">
                            <h3 style="margin:0; font-size:1rem; color: var(--text);">
                                ${lockBadge}${r18Badge}${escapeHtml(folder.name)}
                            </h3>
                            <div style="font-size:0.8rem; color:var(--text-muted);">${folder.item_count} items</div>
                        </div>
                        ${isAdmin && !this._selectionMode ? `
                            <button class="btn-icon btn-folder-menu" data-path="${folder.path}" style="width:32px;height:32px;font-size:1.2rem;">⋮</button>
                        ` : ''}
                    </div>
                `;
                foldersContainer.appendChild(folderCard);
            });
        }

        // 3. Reset Media Pagination & Render First Batch
        itemsGrid.innerHTML = '';
        this._renderedCount = 0;
        
        if (fItems.length > 0) {
            this._renderNextBatch();
        }

        if (!this._listenersBound) {
            this._setupEventListeners();
            this._setupHoverPreviews();
            this._setupMediaEventListeners(itemsGrid);
            this._listenersBound = true;
        }
        
        this._reapplySelectionVisuals();
    }

    _setupMediaEventListeners(itemsGrid) {
        if (!itemsGrid) return;
        itemsGrid.addEventListener('click', (e) => {
            const card = e.target.closest('.media-card, .table-row');
            if (!card) return;

            const mediaId = card.dataset.mediaId;
            const media = this._filteredItems.find(m => String(m.id) === String(mediaId));
            if (!media) return;

            if (this._selectionMode) {
                e.preventDefault();
                if (this._selectedMediaIds.has(String(media.id))) {
                    this._selectedMediaIds.delete(String(media.id));
                    card.style.opacity = '1';
                    card.style.border = '';
                } else {
                    this._selectedMediaIds.add(String(media.id));
                    card.style.opacity = '0.5';
                    card.style.border = '1px solid var(--accent)';
                }
                this._updateSelectionCount();
                return;
            }

            const favBtn = e.target.closest('.btn-fav');
            if (favBtn) {
                e.stopPropagation();
                this._toggleFavorite(media, favBtn);
                return;
            }

            const downloadBtn = e.target.closest('.btn-download');
            if (downloadBtn) {
                e.stopPropagation();
                this._downloadMedia(media);
                return;
            }

            const playBtn = e.target.closest('.btn-play');
            if (playBtn) {
                e.stopPropagation();
                this._playMedia(mediaId);
                return;
            }

            // Click on the card itself (not on a specific button)
            if (!e.target.closest('.media-card-actions, .table-actions')) {
                this._playMedia(mediaId);
            }
        });
    }

    _renderNextBatch() {
        const itemsGrid = document.getElementById('lib-items-grid');
        if (!itemsGrid || !this._filteredItems) return;

        const fragment = document.createDocumentFragment();
        const end = Math.min(this._renderedCount + this._pageSize, this._filteredItems.length);

        for (let i = this._renderedCount; i < end; i++) {
            const media = this._filteredItems[i];
            const itemEl = document.createElement('div');

            if (this._viewMode === 'grid') {
                itemEl.className = 'media-card';
                itemEl.dataset.mediaId = media.id;
                itemEl.dataset.index = i;

                const title = escapeHtml(media.title || media.filename);
                const dur = formatDuration(media.duration_seconds);
                const thumb = thumbUrl(media);
                const adultBadge = media.adult_only ? `<div class="media-badge r18-badge">R18</div>` : '';
                const lockBadge = media.requires_pin ? `<div class="media-badge lock-badge">🔒</div>` : '';

                itemEl.innerHTML = `
                    <div class="media-card-poster">
                        <img src="${thumb}" alt="${title}" class="media-card-thumb shimmer-bg" loading="lazy" style="opacity:0; transition: opacity 0.3s ease;" onload="this.style.opacity=1; this.classList.remove('shimmer-bg');" onerror="this.onerror=null; this.src='/static/placeholder.svg'; this.style.opacity=1; this.classList.remove('shimmer-bg');">
                        ${adultBadge}
                        ${lockBadge}
                        <span class="media-badge duration-badge">${dur}</span>
                        <!-- Action Buttons replace with single hover menu -->
                        <div class="media-card-actions">
                            <button class="btn-icon btn-play" title="Play">▶</button>
                            <div class="dropdown-container">
                                <button class="btn-icon btn-menu" title="Options">⋮</button>
                                <div class="dropdown-menu">
                                    <button class="btn-fav ${media.is_favorite ? 'active' : ''}">
                                        ${media.is_favorite ? '❤️ Unfavorite' : '♡ Favorite'}
                                    </button>
                                    <button class="btn-download">⬇ Download</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="media-card-info">
                        <h3 class="media-title" title="${title}">${title}</h3>
                        <div class="media-meta">
                            <span>${dur}</span>
                            <span class="dot">·</span>
                            <span>${media.video_codec?.toUpperCase() || 'VIDEO'}</span>
                        </div>
                    </div>
                `;
            } else {
                itemEl.className = 'table-row';
                itemEl.dataset.mediaId = media.id;
                itemEl.dataset.index = i;

                const dur = formatDuration(media.duration_seconds);
                const size = formatBytes(media.file_size);
                const title = escapeHtml(media.title || media.filename);

                itemEl.innerHTML = `
                    <div class="table-thumb-wrapper">
                        <img src="${thumbUrl(media)}" class="shimmer-bg" loading="lazy" style="opacity:0; transition: opacity 0.3s ease;" onload="this.style.opacity=1; this.classList.remove('shimmer-bg');" onerror="this.onerror=null; this.src='/static/placeholder.svg'; this.style.opacity=1; this.classList.remove('shimmer-bg');">
                    </div>
                    <div class="table-title">
                        ${title}
                        ${media.adult_only ? '<span class="badge badge-error" style="font-size:0.6rem;margin-left:6px">R18</span>' : ''}
                        ${media.requires_pin ? '<span style="color:var(--error);margin-left:4px">🔒</span>' : ''}
                    </div>
                    <div class="table-meta">${dur}</div>
                    <div class="table-meta">${size}</div>
                    <div class="table-actions">
                        <button class="btn-icon btn-play" style="width:28px;height:28px;font-size:0.8rem">▶</button>
                        <div class="dropdown-container">
                            <button class="btn-icon btn-menu" style="width:28px;height:28px;font-size:0.8rem">⋮</button>
                            <div class="dropdown-menu">
                                <button class="btn-fav ${media.is_favorite ? 'active' : ''}">
                                    ${media.is_favorite ? '❤️ Unfavorite' : '♡ Favorite'}
                                </button>
                                <button class="btn-download">⬇ Download</button>
                            </div>
                        </div>
                    </div>
                `;
            }

            if (this._selectionMode && this._selectedMediaIds.has(String(media.id))) {
                itemEl.classList.add('selected');
            }

            fragment.appendChild(itemEl);
        }

        itemsGrid.appendChild(fragment);
        this._renderedCount = end;
    }

    _setupEventListeners() {
        const target = document.getElementById('lib-content');
        if (!target) return;

        target.addEventListener('click', async (e) => {
            const folderRow = e.target.closest('.folder-row');
            if (folderRow) {
                const path = folderRow.dataset.path;

                // Handle three-dot menu click
                const menuBtn = e.target.closest('.btn-folder-menu');
                if (menuBtn) {
                    e.stopPropagation();
                    const folder = this._folders.find(f => f.path === path);
                    const action = await prompt(`Folder Options`, `Options for /${folder.name}:\nType 'lock', 'unlock', 'r18', or 'unr18'`);
                    if (!action) return;

                    try {
                        if (action === 'lock') await api.toggleFolderLock(path, true);
                        else if (action === 'unlock') await api.toggleFolderLock(path, false);
                        else if (action === 'r18') await api.toggleFolderR18(path, true);
                        else if (action === 'unr18') await api.toggleFolderR18(path, false);
                        else {
                            toast("Invalid action", "warning");
                            return;
                        }
                        toast("Updated folder", "success");
                        this._loadPath(this._currentPath);
                    } catch (err) {
                        toast(err.message, 'error');
                    }
                    return;
                }

                // Normal folder click
                if (this._selectionMode) {
                    if (this._selectedPaths.has(path)) {
                        this._selectedPaths.delete(path);
                        folderRow.style.opacity = '1';
                        folderRow.style.border = '';
                    } else {
                        this._selectedPaths.add(path);
                        folderRow.style.opacity = '0.5';
                        folderRow.style.border = '1px solid var(--accent)';
                    }
                    this._updateSelectionCount();
                    return;
                }

                const folderObj = this._folders.find(f => f.path === path);
                if (folderObj && folderObj.is_locked && !this._isAdmin()) {
                    showPinDialog("This folder is PG-Locked. Enter Admin PIN:").then(pin => {
                        if (!pin) return;
                        api.unlockPin(pin).then(() => {
                            this._loadPath(path);
                        }).catch(err => toast(err.message, 'error'));
                    });
                    return;
                }

                this._loadPath(path);
            }
        });
    }

    _reapplySelectionVisuals() {
        const target = document.getElementById('lib-content');
        if (!target) return;

        target.querySelectorAll('.media-card, .table-row').forEach(el => {
            if (this._selectedMediaIds.has(el.dataset.mediaId)) {
                el.style.opacity = '0.5';
                el.style.border = '1px solid var(--accent)';
            } else {
                el.style.opacity = '1';
                el.style.border = '';
            }
        });
    }

    async _toggleFavorite(media, btn) {
        try {
            const res = await api.toggleFavorite(media.id);
            media.is_favorite = !media.is_favorite;
            btn.classList.toggle('active', media.is_favorite);
            btn.innerHTML = media.is_favorite ? '❤️' : '♡';
            toast(res.message, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async _downloadMedia(media) {
        let url = `/api/media/${media.id}/download`;
        if (media.requires_pin) {
            const pin = await showPinDialog("Enter PIN to download this PG-Locked media:");
            if (!pin) return;
            url += `?pin=${encodeURIComponent(pin)}`;
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = media.title || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    _isAdmin() {
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        return user.role === 'admin' || user.role === 'super-admin';
    }

    _playMedia(mediaId) {
        const item = this._items.find(m => m.id == mediaId);
        if (item && item.adult_only && !isAdultApproved()) {
            showAdultAccessDialog();
            return;
        }
        if (item && item.requires_pin && !this._isAdmin()) {
            showPinDialog("This content is PG-Locked. Enter Admin PIN:").then(pin => {
                if (!pin) return;
                api.unlockPin(pin).then(() => {
                    // Handled by reload
                }).catch(e => toast(e.message, 'error'));
            });
            return;
        }
        const index = this._items.findIndex(m => m.id == mediaId);
        try { player.play(this._items, index); }
        catch { toast('Could not play', 'error'); }
    }

    _toggleView() {
        this._viewMode = this._viewMode === 'grid' ? 'table' : 'grid';
        localStorage.setItem('lib_view_mode', this._viewMode);
        const toggleBtn = document.getElementById('lib-toggle');
        if (toggleBtn) toggleBtn.textContent = this._viewMode === 'grid' ? '☰' : '▦';
        this._renderContent();
    }

    _playAll() {
        if (this._items.length === 0) {
            toast('Nothing to play.', 'warning');
            return;
        }

        const adultItems = this._items.filter(m => m.adult_only);
        if (adultItems.length > 0 && !isAdultApproved()) {
            toast('Adult content hidden. Verify age to play all.', 'error', {
                label: 'Verify',
                onClick: () => showAdultAccessDialog()
            });
            const safeItems = this._items.filter(m => !m.adult_only);
            if (safeItems.length === 0) return;
            player.play(safeItems, 0);
        } else {
            player.play(this._items, 0);
        }
        toast(`Playing ${this._items.length} items`, 'success');
    }

    _setupHoverPreviews() {
        const contentArea = document.getElementById('lib-content');
        if (!contentArea) return;

        this._cleanupActivePreview();

        contentArea.addEventListener('mouseenter', (e) => {
            if (this._selectionMode) return; // Disable hover previews in select mode

            const card = e.target.closest('.media-card');
            if (!card) return;

            if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
            this._cleanupActivePreview();

            this.hoverTimeout = setTimeout(() => {
                const mediaId = card.dataset.mediaId;
                const posterImg = card.querySelector('.media-card-thumb');
                const previewUrl = `/api/media/${mediaId}/preview`;

                this.previewVideo = document.createElement('video');
                this.previewVideo.src = previewUrl;
                this.previewVideo.muted = true;
                this.previewVideo.autoplay = true;
                this.previewVideo.loop = true;
                this.previewVideo.setAttribute('playsinline', '');
                this.previewVideo.setAttribute('webkit-playsinline', '');
                this.previewVideo.className = 'card-preview-video';

                Object.assign(this.previewVideo.style, {
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: 'var(--radius)',
                    zIndex: '2',
                });

                const posterContainer = card.querySelector('.media-card-poster');
                if (posterContainer) {
                    posterContainer.style.position = 'relative';
                    posterContainer.appendChild(this.previewVideo);
                    if (posterImg) posterImg.style.opacity = '0.1';
                }

                this.previewVideo.play().catch(() => { });

                card.addEventListener('mouseleave', () => {
                    this._cleanupPreview(card, posterImg);
                }, { once: true });
            }, 500);

            card.addEventListener('mouseleave', () => {
                if (this.hoverTimeout) {
                    clearTimeout(this.hoverTimeout);
                    this.hoverTimeout = null;
                }
            }, { once: true });
        }, true);
    }

    _cleanupPreview(card, posterImg) {
        this._cleanupActivePreview();
        if (posterImg) posterImg.style.opacity = '1';
        else document.querySelectorAll('.media-card-thumb').forEach(img => img.style.opacity = '1');
    }

    _cleanupActivePreview() {
        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
            this.hoverTimeout = null;
        }
        if (this.previewVideo) {
            try {
                this.previewVideo.pause();
                this.previewVideo.src = '';
                this.previewVideo.load();
                this.previewVideo.remove();
            } catch (e) { }
            this.previewVideo = null;
        }
        document.querySelectorAll('.card-preview-video').forEach(video => {
            try {
                video.pause();
                video.src = '';
                video.load();
                video.remove();
            } catch (e) { }
        });
    }

    _toggleUploadPanel(force = null) {
        const panel = document.getElementById('lib-upload-panel');
        if (!panel) return;

        const nextVal = force !== null ? force : (panel.style.display === 'none');
        panel.style.display = nextVal ? 'block' : 'none';

        const toggleBtn = document.getElementById('lib-toggle-upload');
        if (toggleBtn) toggleBtn.classList.toggle('btn-accent', nextVal);

        if (nextVal) {
            const pathInput = document.getElementById('upload-path');
            if (pathInput) {
                pathInput.value = this._currentPath;
            }
            this._syncDestinationLabel(this._currentPath);
            pathInput?.focus();
        }
    }

    _setupUploadEvents() {
        if (!this._canUpload) return;

        const pathInput = document.getElementById('upload-path');
        const fileInput = document.getElementById('upload-file-input');
        const startBtn = document.getElementById('upload-start-btn');
        const clearBtn = document.getElementById('upload-clear-btn');
        const dropzone = document.getElementById('upload-dropzone');
        const closeBtn = document.getElementById('upload-close-btn');

        closeBtn?.addEventListener('click', () => this._toggleUploadPanel(false));

        dropzone?.addEventListener('click', (e) => {
            if (e.target !== fileInput) {
                fileInput?.click();
            }
        });

        pathInput?.addEventListener('input', (event) => {
            const value = event.target.value.trim();
            this._syncDestinationLabel(value);
        });

        fileInput?.addEventListener('change', (event) => {
            this._setFiles(event.target.files);
        });

        startBtn?.addEventListener('click', () => {
            this._startUpload();
        });

        clearBtn?.addEventListener('click', () => {
            this._clearSelection();
        });

        this._onDragEnter = (event) => {
            event.preventDefault();
            this._dragDepth += 1;
            dropzone?.classList.add('is-dragover');
        };

        this._onDragOver = (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        };

        this._onDragLeave = (event) => {
            event.preventDefault();
            this._dragDepth = Math.max(0, this._dragDepth - 1);
            if (this._dragDepth === 0) {
                dropzone?.classList.remove('is-dragover');
            }
        };

        this._onDrop = (event) => {
            event.preventDefault();
            this._dragDepth = 0;
            dropzone?.classList.remove('is-dragover');
            const files = event.dataTransfer?.files;
            if (files && files.length > 0) {
                this._setFiles(files);
            }
        };

        dropzone?.addEventListener('dragenter', this._onDragEnter);
        dropzone?.addEventListener('dragover', this._onDragOver);
        dropzone?.addEventListener('dragleave', this._onDragLeave);
        dropzone?.addEventListener('drop', this._onDrop);
    }

    _setFiles(fileList) {
        this._queue = Array.from(fileList || []).map((file) => ({
            file,
            state: 'ready',
            detail: 'Ready to upload',
        }));
        this._renderQueue();
        
        // Reveal Step 2
        if (this._queue.length > 0) {
            const detailsStep = document.getElementById('upload-details-step');
            if (detailsStep) detailsStep.style.display = 'block';
        }
    }

    _clearSelection() {
        this._queue = [];
        const fileInput = document.getElementById('upload-file-input');
        if (fileInput) fileInput.value = '';
        this._renderQueue();
        
        // Hide Step 2
        const detailsStep = document.getElementById('upload-details-step');
        if (detailsStep) detailsStep.style.display = 'none';
    }

    _syncDestinationLabel(value) {
        const label = document.getElementById('upload-dest-display');
        if (label) {
            label.textContent = value ? value : 'Root';
        }
    }

    _recordProblem(message, kind = 'error') {
        this._problems.unshift({
            message,
            kind,
            time: new Date().toISOString(),
        });
        this._problems = this._problems.slice(0, 6);
        this._renderProblems();
    }

    _renderQueue() {
        const target = document.getElementById('upload-queue');
        if (!target) return;

        if (this._queue.length === 0) {
            target.innerHTML = `<div class="text-muted" style="font-style: italic;">No files selected.</div>`;
            return;
        }

        target.innerHTML = this._queue.map((item) => {
            const statusLabel = item.state === 'done'
                ? 'Done'
                : item.state === 'error'
                    ? 'Failed'
                    : item.state === 'uploading'
                        ? 'Uploading'
                        : 'Ready';

            const statusClass = item.state === 'error' ? 'text-error' : item.state === 'done' ? 'text-success' : '';

            return `
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
                    <span class="${statusClass}" style="font-weight: 500;">${statusLabel}</span>
                </div>
            `;
        }).join('');
    }

    _renderProblems() {
        const target = document.getElementById('current_problems');
        if (!target) return;

        if (this._problems.length === 0) {
            target.innerHTML = `<div class="text-muted" style="font-style: italic;">No problems.</div>`;
            return;
        }

        target.innerHTML = this._problems.map((problem) => `
            <div style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px; color: var(--error); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(problem.message)}">
                <div>${escapeHtml(problem.message)}</div>
            </div>
        `).join('');
    }

    async _startUpload() {
        if (!this._canUpload) {
            this._recordProblem('Uploads are limited to admin and family accounts.', 'warning');
            toast('Upload access denied.', 'error');
            return;
        }

        if (this._uploading) {
            return;
        }

        if (this._queue.length === 0) {
            this._recordProblem('Choose at least one file before uploading.', 'warning');
            toast('Pick files first.', 'warning');
            return;
        }

        const pathInput = document.getElementById('upload-path');
        const pinInput = document.getElementById('upload-pin');
        const ratingInput = document.getElementById('upload-rating');
        const destination = (pathInput?.value || '').trim();
        const pin = (pinInput?.value || '').trim();
        const isAdult = ratingInput?.value === 'nsfw';
        const fileInput = document.getElementById('upload-file-input');
        const startBtn = document.getElementById('upload-start-btn');

        this._uploading = true;
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Uploading...';
        }

        const pendingItems = this._queue.filter((item) => item.state !== 'done');
        let successCount = 0;
        for (const item of pendingItems) {
            item.state = 'uploading';
            item.detail = 'Uploading...';
            this._renderQueue();

            try {
                await api.upload(destination, item.file, pin, isAdult);
                item.state = 'done';
                item.detail = 'Uploaded successfully';
                successCount += 1;
                toast(`Uploaded: ${item.file.name}`, 'success');
            } catch (err) {
                item.state = 'error';
                item.detail = err.message || 'Upload failed';
                this._recordProblem(`${item.file.name}: ${item.detail}`, 'error');
                toast(`Upload failed: ${item.file.name}`, 'error');
            }

            this._renderQueue();
        }

        this._uploading = false;
        if (startBtn) {
            startBtn.disabled = !this._canUpload;
            startBtn.textContent = 'Start Upload';
        }

        if (this._queue.every((item) => item.state === 'done')) {
            this._queue = [];
            if (fileInput) fileInput.value = '';
            this._renderQueue();
            if (successCount > 0) {
                toast(`Uploaded ${successCount} file${successCount === 1 ? '' : 's'}.`, 'success');
                await this._loadPath(this._currentPath);
            }
        } else {
            this._queue = this._queue.filter((item) => item.state === 'error');
            this._renderQueue();
            if (successCount > 0) {
                await this._loadPath(this._currentPath);
            }
        }
    }

    destroy() {
        this._cleanupActivePreview();
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    }
}
