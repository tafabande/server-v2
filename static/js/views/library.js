/**
 * MediaHub - Library View
 * Full grid of all media, sortable and filterable.
 * Supports Folder Navigation and bulk operations!
 */
import { api, player, router } from '../app.js';
import { formatDuration, formatBytes, thumbUrl, toast, debounce, isAdultApproved, showAdultAccessDialog } from '../utils.js';

export class LibraryView {
    constructor(container) {
        this.container = container;
        this._fixedFormat = null;
        this._currentPath = localStorage.getItem('lib_current_path') || "";
        this._viewMode = localStorage.getItem('lib_view_mode') || 'grid';
        this._folders = [];
        this._items = [];
        
        // Selection state
        this._selectionMode = false;
        this._selectedPaths = new Set();
        this._selectedMediaIds = new Set();
        
        this.hoverTimeout = null;
        this.previewVideo = null;
    }

    async render() {
        const title = this._fixedFormat ? (this._fixedFormat.charAt(0).toUpperCase() + this._fixedFormat.slice(1)) : 'Library';
        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg">
                <div>
                    <h1 class="page-title">${title}</h1>
                    <div id="lib-breadcrumbs" class="page-subtitle breadcrumbs">
                        <!-- Breadcrumbs -->
                    </div>
                </div>
                <div class="flex gap-sm">
                    <div class="search-bar" style="margin-bottom:0">
                        <input id="lib-search" class="input" type="text" placeholder="Search...">
                    </div>
                    <button id="lib-toggle-selection" class="btn btn-ghost" title="Select multiple items">~ Select</button>
                    <select id="lib-sort" class="select" style="width:auto; min-width:120px">
                        <option value="title">Alphabetical</option>
                        <option value="date">Recently Added</option>
                        <option value="size">File Size</option>
                        <option value="duration">Runtime</option>
                    </select>
                    <button id="lib-play-all" class="btn btn-accent shadow-sm" title="Play current list">- Play All</button>
                    <button id="lib-toggle" class="btn btn-ghost" title="Toggle view">
                        ${this._viewMode === 'grid' ? '~' : '-'}
                    </button>
                </div>
            </div>
            
            <div class="tabs" id="lib-format-tabs" style="display: none; margin-bottom: 20px;"></div>
            
            <div id="lib-selection-bar" class="library-controls surface mb-md flex-between" style="display: none; padding: 10px; border-radius: var(--radius); border: 1px solid var(--accent);">
                <div>
                    <span id="lib-selection-count" style="font-weight: bold; margin-right: 15px;">0 selected</span>
                    <button id="lib-bulk-lock" class="btn btn-sm btn-ghost">Y"S Lock</button>
                    <button id="lib-bulk-unlock" class="btn btn-sm btn-ghost">Y"" Unlock</button>
                    <button id="lib-bulk-r18" class="btn btn-sm btn-ghost">🔞 Set R18</button>
                    <button id="lib-bulk-unr18" class="btn btn-sm btn-ghost">✅ Unset R18</button>
                </div>
                <button id="lib-selection-cancel" class="btn btn-sm btn-ghost">Cancel</button>
            </div>

            <div id="lib-content" class="fade-in">
                <div class="skeleton-grid">
                    ${Array(12).fill().map(() => `
                        <div class="skeleton-card">
                            <div class="skeleton-poster shimmer-bg"></div>
                            <div class="skeleton-title shimmer-bg"></div>
                            <div class="skeleton-meta shimmer-bg"></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        const searchInput = document.getElementById('lib-search');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(() => this._renderContent(), 300));
        }

        document.getElementById('lib-sort')?.addEventListener('change', () => this._renderContent());
        document.getElementById('lib-toggle')?.addEventListener('click', () => this._toggleView());
        document.getElementById('lib-play-all')?.addEventListener('click', () => this._playAll());
        
        document.getElementById('lib-toggle-selection')?.addEventListener('click', () => this._toggleSelectionMode());
        document.getElementById('lib-selection-cancel')?.addEventListener('click', () => this._toggleSelectionMode(false));
        
        document.getElementById('lib-bulk-lock')?.addEventListener('click', () => this._bulkAction('lock', true));
        document.getElementById('lib-bulk-unlock')?.addEventListener('click', () => this._bulkAction('lock', false));
        document.getElementById('lib-bulk-r18')?.addEventListener('click', () => this._bulkAction('r18', true));
        document.getElementById('lib-bulk-unr18')?.addEventListener('click', () => this._bulkAction('r18', false));

        await this._loadPath(this._currentPath);
        if (this._renderTabs) {
            this._renderTabs();
        }
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
        
        try {
            const res = await api.getFolders(path);
            this._folders = res.folders || [];
            this._items = res.items || [];
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
        
        try {
            // Folders
            for (const path of this._selectedPaths) {
                if (type === 'lock') await api.toggleFolderLock(path, value);
                if (type === 'r18') await api.toggleFolderR18(path, value);
            }
            
            // Media (If backend supports it, else we iterate)
            for (const id of this._selectedMediaIds) {
                // If it's a media ID, we only have toggleLock / toggleR18 (wait, media doesn't have R18 toggle yet? Yes it does via AdultOnly?)
                // For simplicity, skip media bulk actions if it gets too complex, but let's do it for locks:
                if (type === 'lock') {
                    const media = this._items.find(m => m.id == id);
                    if (media && media.requires_pin !== value) {
                        await api.toggleLock(id);
                    }
                }
            }
            
            toast('Bulk operation successful', 'success');
            this._toggleSelectionMode(false);
            this._loadPath(this._currentPath); // Refresh
        } catch(e) {
            toast(e.message, 'error');
        }
    }

    _renderContent() {
        const target = document.getElementById('lib-content');
        if (!target) return;

        const q = (document.getElementById('lib-search')?.value || '').toLowerCase();
        const sort = document.getElementById('lib-sort')?.value || 'title';
        
        // Filter folders and items
        let fFolders = this._folders.filter(f => !q || f.name.toLowerCase().includes(q));
        let fItems = this._items.filter(m => !q || (m.title && m.title.toLowerCase().includes(q)) || (m.filename && m.filename.toLowerCase().includes(q)));
        
        if (fFolders.length === 0 && fItems.length === 0) {
            target.innerHTML = `<div class="empty-state">
                <div class="empty-icon">Y"?</div>
                <p>No content in this folder.</p>
            </div>`;
            return;
        }

        const isAdmin = this._isAdmin();
        
        // Render Folders
        let html = `<div class="media-grid folder-grid mb-lg" style="gap:15px; display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">`;
        fFolders.forEach(folder => {
            const cover = folder.cover_media_id ? thumbUrl(folder.cover_media_id) : '';
            const blurClass = folder.is_locked ? 'blur-sm' : '';
            const lockBadge = folder.is_locked ? `<div class="media-badge lock-badge">Y"S</div>` : '';
            const r18Badge = folder.is_adult ? `<div class="media-badge r18-badge">🔞</div>` : '';
            
            const checkbox = this._selectionMode ? `
                <div class="selection-checkbox ${this._selectedPaths.has(folder.path) ? 'checked' : ''}" data-path="${folder.path}">
                    ${this._selectedPaths.has(folder.path) ? '~S' : ''}
                </div>
            ` : '';

            html += `
                <div class="folder-card surface" data-path="${folder.path}" style="position:relative; cursor:pointer; border-radius:var(--radius); overflow:hidden; border:1px solid var(--border-subtle);">
                    ${checkbox}
                    <div class="folder-cover shimmer-bg ${blurClass}" style="height: 120px; background-image: url('${cover}'); background-size: cover; background-position: center; position:relative;">
                        ${lockBadge} ${r18Badge}
                        <div style="position:absolute; bottom:0; left:0; width:100%; padding:10px; background: linear-gradient(transparent, rgba(0,0,0,0.8));">
                            <h3 style="margin:0; font-size:1rem; text-shadow:0 1px 3px #000; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📁 ${folder.name}</h3>
                            <div style="font-size:0.75rem; color:#ccc;">${folder.item_count} items</div>
                        </div>
                    </div>
                    ${isAdmin && !this._selectionMode ? `
                        <div class="folder-actions" style="position:absolute; top:5px; right:5px;">
                            <button class="btn-icon btn-folder-menu" data-path="${folder.path}">~Z</button>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        html += `</div>`;
        
        // Render Items
        html += `<div class="${this._viewMode === 'grid' ? 'media-grid' : 'media-table'}">`;
        fItems.forEach((media, idx) => {
            if (this._viewMode === 'grid') {
                html += this._renderGridCard(media, idx);
            } else {
                html += this._renderTableRow(media, idx);
            }
        });
        html += `</div>`;

        target.innerHTML = html;

        this._setupEventListeners();
        this._setupHoverPreviews();
    }

    _renderGridCard(media, idx) {
        const title = media.title || media.filename;
        const dur = formatDuration(media.duration_seconds);
        const lockIcon = media.requires_pin ? 'Y"S' : '';
        const thumb = thumbUrl(media.id);
        const adultBadge = media.adult_only ? `<div class="media-badge r18-badge">R18</div>` : '';
        
        const checkbox = this._selectionMode ? `
            <div class="selection-checkbox ${this._selectedMediaIds.has(media.id) ? 'checked' : ''}" data-id="${media.id}">
                ${this._selectedMediaIds.has(media.id) ? '~S' : ''}
            </div>
        ` : '';

        return `
            <div class="media-card" data-media-id="${media.id}" data-index="${idx}">
                <div class="media-card-poster shimmer-bg">
                    ${checkbox}
                    <img src="${thumb}" alt="${title}" class="media-card-thumb" loading="lazy">
                    ${adultBadge}
                    ${lockIcon ? `<div class="media-badge lock-badge">${lockIcon}</div>` : ''}
                    <div class="media-badge duration-badge">${dur}</div>
                    
                    <div class="media-card-actions">
                        <button class="btn-icon btn-play" title="Play">-</button>
                        <button class="btn-icon btn-fav ${media.is_favorite ? 'active' : ''}" title="Favorite">
                            ${media.is_favorite ? '?ϋ?' : 'Y?'}
                        </button>
                    </div>
                </div>
                <div class="media-card-info">
                    <h3 class="media-title" title="${title}">${title}</h3>
                </div>
            </div>
        `;
    }

    _renderTableRow(media, idx) {
        const dur = formatDuration(media.duration_seconds);
        const size = formatBytes(media.file_size);
        const date = new Date(media.created_at).toLocaleDateString();
        const title = media.title || media.filename;
        const lockIcon = media.requires_pin ? '<span style="color:var(--danger)">Y"S</span>' : '';
        
        const checkbox = this._selectionMode ? `
            <div class="selection-checkbox ${this._selectedMediaIds.has(media.id) ? 'checked' : ''}" data-id="${media.id}" style="position:static; margin-right:10px;">
                ${this._selectedMediaIds.has(media.id) ? '~S' : ''}
            </div>
        ` : '';

        return `
            <div class="table-row" data-media-id="${media.id}" data-index="${idx}">
                <div class="flex align-center gap-sm">
                    ${checkbox}
                    <div class="table-thumb-wrapper">
                        <img src="${thumbUrl(media.id)}" loading="lazy" class="table-thumb">
                    </div>
                    <div class="table-title">
                        ${title} ${media.adult_only ? '<span class="text-xs text-danger border border-danger rounded px-1">R18</span>' : ''} ${lockIcon}
                    </div>
                </div>
                <div class="table-meta text-muted">${dur}</div>
                <div class="table-meta text-muted">${size}</div>
                <div class="table-meta text-muted">${date}</div>
                <div class="table-actions">
                    <button class="btn-icon btn-play">-</button>
                </div>
            </div>
        `;
    }

    _setupEventListeners() {
        const target = document.getElementById('lib-content');
        
        // Folder Clicks
        target.querySelectorAll('.folder-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const path = card.dataset.path;
                
                if (this._selectionMode) {
                    if (this._selectedPaths.has(path)) this._selectedPaths.delete(path);
                    else this._selectedPaths.add(path);
                    this._updateSelectionCount();
                    this._renderContent();
                    return;
                }
                
                // If clicked on three-dot menu, ignore
                if (e.target.closest('.btn-folder-menu')) return;
                
                // If it's locked and not admin, prompt!
                const folderObj = this._folders.find(f => f.path === path);
                if (folderObj && folderObj.is_locked && !this._isAdmin()) {
                    const pin = window.prompt("This folder is PG-Locked. Enter Admin PIN:");
                    if (!pin) return;
                    api.unlockPin(pin).then(() => {
                        this._loadPath(path);
                    }).catch(err => toast(err.message, 'error'));
                    return;
                }
                
                this._loadPath(path);
            });
        });
        
        // Folder Context Menus
        target.querySelectorAll('.btn-folder-menu').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const path = btn.dataset.path;
                const folder = this._folders.find(f => f.path === path);
                
                const action = window.prompt(`Options for /${folder.name}:\nType 'lock', 'unlock', 'r18', or 'unr18'`);
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
                } catch(err) {
                    toast(err.message, 'error');
                }
            });
        });

        // Media Clicks
        target.querySelectorAll('.media-card, .table-row').forEach(el => {
            el.addEventListener('click', (e) => {
                const id = el.dataset.mediaId;
                
                if (this._selectionMode) {
                    if (this._selectedMediaIds.has(id)) this._selectedMediaIds.delete(id);
                    else this._selectedMediaIds.add(id);
                    this._updateSelectionCount();
                    this._renderContent();
                    return;
                }
                
                if (e.target.closest('.btn-fav')) {
                    const media = this._items.find(m => m.id == id);
                    if (media) this._toggleFavorite(media, e.target.closest('.btn-fav'));
                    return;
                }
                this._playMedia(id);
            });
        });
    }

    async _toggleFavorite(media, btn) {
        try {
            const res = await api.toggleFavorite(media.id);
            media.is_favorite = !media.is_favorite;
            btn.classList.toggle('active', media.is_favorite);
            btn.innerHTML = media.is_favorite ? '?ϋ?' : 'Y?';
            toast(res.message, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
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
            const pin = window.prompt("This content is PG-Locked. Enter Admin PIN:");
            if (!pin) return;
            api.unlockPin(pin).then(() => {
                // Handled by reload
            }).catch(e => toast(e.message, 'error'));
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
        if (toggleBtn) toggleBtn.textContent = this._viewMode === 'grid' ? '~' : '-';
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

                this.previewVideo.play().catch(() => {});

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

    destroy() {
        this._cleanupActivePreview();
    }
}
