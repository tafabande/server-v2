/**
 * MediaHub — Library View
 * Full grid of all media, sortable and filterable.
 * Optimized with batch rendering and debounced search.
 */
import { api, player, router } from '../app.js';
import { formatDuration, formatBytes, thumbUrl, toast, debounce, isAdultApproved, showAdultAccessDialog } from '../utils.js';export class LibraryView {
    constructor(container) { 
        this.container = container; 
        this._allMedia = []; 
        this._filteredItems = [];
        this._viewMode = localStorage.getItem('lib_view_mode') || 'grid'; 
        this._collapsedSubfolders = new Set();
    }

    async render() {
        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg">
                <div>
                    <h1 class="page-title">Library</h1>
                    <p class="page-subtitle">Your collection, perfectly organized</p>
                </div>
                <div class="flex gap-sm">
                    <div class="search-bar" style="margin-bottom:0">
                        <input id="lib-search" class="input" type="text" placeholder="Search titles...">
                    </div>
                    <select id="lib-sort" class="select" style="width:auto; min-width:120px">
                        <option value="title">Alphabetical</option>
                        <option value="date">Recently Added</option>
                        <option value="size">File Size</option>
                        <option value="duration">Runtime</option>
                    </select>
                    <button id="lib-play-all" class="btn btn-accent shadow-sm" title="Play current list">▶ Play All</button>
                    <button id="lib-toggle" class="btn btn-ghost" title="Toggle view">
                        ${this._viewMode === 'grid' ? '☰' : '▦'}
                    </button>
                </div>
            </div>
            
            <div class="library-controls surface mb-md">
                <div id="lib-filter-tabs" class="tabs" style="margin-bottom:0; border-bottom:none"></div>
            </div>

            <div id="lib-content" class="fade-in">
                <div class="loading-state">
                    <div class="spinner"></div>
                    <span>Indexing library...</span>
                </div>
            </div>
        `;

        const searchInput = document.getElementById('lib-search');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(() => this._applyFilters(), 300));
        }
        
        document.getElementById('lib-sort')?.addEventListener('change', () => this._applyFilters());
        document.getElementById('lib-toggle')?.addEventListener('click', () => this._toggleView());
        document.getElementById('lib-play-all')?.addEventListener('click', () => this._playAll());

        await this._loadMedia();
    }

    _getSubfolder(item) {
        const parts = item.relative_path.split('/');
        if (parts.length > 2) {
            return parts.slice(1, -1).join('/');
        }
        return '';
    }

    async _loadMedia() {
        try {
            const groups = await api.getLibrary();
            this._allMedia = groups.flatMap(g => g.items.map(m => ({ ...m, _category: g.label })));
            this._categories = [...new Set(this._allMedia.map(m => m._category))];
            this._activeCategory = null;

            this._renderTabs();
            this._applyFilters();
        } catch (err) {
            const target = document.getElementById('lib-content');
            if (target) {
                target.innerHTML =
                    `<div class="empty-state">
                        <div class="empty-icon">📁</div>
                        <h3>Connection Error</h3>
                        <p>${err.message}</p>
                    </div>`;
            }
        }
    }

    _renderTabs() {
        const tabs = document.getElementById('lib-filter-tabs');
        if (!tabs) return;
        
        tabs.innerHTML = `
            <button class="tab active" data-cat="">All Collections <span class="tab-count">${this._allMedia.length}</span></button>
            ${this._categories.map(c => {
                const count = this._allMedia.filter(m => m._category === c).length;
                return `<button class="tab" data-cat="${c}">${c} <span class="tab-count">${count}</span></button>`;
            }).join('')}
        `;

        tabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;
            tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            this._activeCategory = tab.dataset.cat || null;
            this._applyFilters();
        });
    }

    _applyFilters() {
        const query = (document.getElementById('lib-search')?.value || '').toLowerCase();
        const sort = document.getElementById('lib-sort')?.value || 'title';

        let items = [...this._allMedia];

        if (this._activeCategory) {
            items = items.filter(m => m._category === this._activeCategory);
        }

        if (query) {
            items = items.filter(m => m.title.toLowerCase().includes(query));
        }

        items.sort((a, b) => {
            switch (sort) {
                case 'date': return (b.id || 0) - (a.id || 0);
                case 'size': return (b.file_size || 0) - (a.file_size || 0);
                case 'duration': return (b.duration_seconds || 0) - (a.duration_seconds || 0);
                default: return a.title.localeCompare(b.title);
            }
        });

        this._filteredItems = items;
        
        const target = document.getElementById('lib-content');
        if (!target) return;
        target.innerHTML = '';
        
        if (items.length === 0) {
            target.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>No results found</h3>
                    <p>Try adjusting your filters or search query.</p>
                </div>`;
            return;
        }

        const groups = {};
        items.forEach(m => {
            const sub = this._getSubfolder(m) || 'Main Folder';
            if (!groups[sub]) groups[sub] = [];
            groups[sub].push(m);
        });

        const sortedSubfolders = Object.keys(groups).sort((a, b) => {
            if (a === 'Main Folder') return -1;
            if (b === 'Main Folder') return 1;
            return a.localeCompare(b);
        });

        let html = '';
        sortedSubfolders.forEach(subfolderName => {
            const subfolderItems = groups[subfolderName];
            const isCollapsed = this._collapsedSubfolders.has(subfolderName);
            const collapsedClass = isCollapsed ? 'collapsed' : '';
            
            html += `
                <div class="subfolder-section" data-subfolder="${subfolderName}">
                    <div class="subfolder-header ${collapsedClass}">
                        <span class="subfolder-toggle-icon">▼</span>
                        <span class="subfolder-name">📁 ${subfolderName}</span>
                        <span class="subfolder-count">${subfolderItems.length} items</span>
                    </div>
                    <div class="subfolder-content ${collapsedClass}">
                        ${this._viewMode === 'grid' ? `
                            <div class="gallery-grid">
                                ${subfolderItems.map(m => this._renderCardHtml(m)).join('')}
                            </div>
                        ` : `
                            <div class="surface" style="padding:0; overflow-x:auto;">
                                <div class="table-wrap">
                                    <table class="table">
                                        <thead>
                                            <tr>
                                                <th style="width: 48px"></th>
                                                <th>Title</th>
                                                <th>Category</th>
                                                <th>Duration</th>
                                                <th>Size</th>
                                                <th>Codec</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${subfolderItems.map(m => this._renderTableRowHtml(m)).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `}
                    </div>
                </div>
            `;
        });

        target.innerHTML = html;

        target.querySelectorAll('.subfolder-header').forEach(header => {
            header.addEventListener('click', () => {
                const section = header.closest('.subfolder-section');
                const subfolderName = section.dataset.subfolder;
                const content = section.querySelector('.subfolder-content');
                
                if (this._collapsedSubfolders.has(subfolderName)) {
                    this._collapsedSubfolders.delete(subfolderName);
                    header.classList.remove('collapsed');
                    content.classList.remove('collapsed');
                } else {
                    this._collapsedSubfolders.add(subfolderName);
                    header.classList.add('collapsed');
                    content.classList.add('collapsed');
                }
            });
        });

        this._bindItemActions(target);
    }

    _renderCardHtml(m) {
        const isAdmin = this._isAdmin();
        return `
            <div class="media-card ${m.adult_only ? 'is-adult' : ''}" data-media-id="${m.id}">
                <div class="media-card-poster">
                    <img class="media-card-thumb" src="${thumbUrl(m)}" alt="" loading="lazy" onerror="this.src='/static/placeholder.svg'">
                    <div class="media-card-overlay">
                        <button class="play-action-btn">▶</button>
                    </div>
                    <div class="media-card-badges">
                        <button class="favorite-toggle-btn ${m.is_favorite ? 'active' : ''}" title="Toggle Favorite">
                            ${m.is_favorite ? '❤️' : '🤍'}
                        </button>
                        ${m.requires_pin ? '<span class="badge badge-warning" title="Locked">🔒</span>' : ''}
                        ${m.adult_only ? '<span class="badge badge-danger" title="18+">🔞</span>' : ''}
                        ${isAdmin ? '<button class="admin-delete-btn" title="Admin: Delete Media">🗑</button>' : ''}
                    </div>
                </div>
                <div class="media-card-body">
                    <div class="media-card-title" title="${m.title}">${m.title}</div>
                    <div class="media-card-meta">
                        <span>${formatDuration(m.duration_seconds)}</span>
                        <span class="dot">·</span>
                        <span>${formatBytes(m.file_size)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    _renderTableRowHtml(m) {
        const isAdmin = this._isAdmin();
        return `
            <tr class="media-row ${m.adult_only ? 'is-adult' : ''}" data-media-id="${m.id}">
                <td class="text-center">
                    <div class="mini-thumb">
                        <img src="${thumbUrl(m)}" onerror="this.style.display='none'">
                    </div>
                </td>
                <td>
                    <div class="flex-align gap-sm">
                        <button class="favorite-toggle-btn-small ${m.is_favorite ? 'active' : ''}" title="Favorite">
                            ${m.is_favorite ? '❤️' : '🤍'}
                        </button>
                        <strong>${m.title}</strong>
                        ${m.requires_pin ? '<span class="text-warning">🔒</span>' : ''}
                        ${m.adult_only ? '<span class="text-danger">🔞</span>' : ''}
                    </div>
                </td>
                <td><span class="badge badge-muted">${m._category || '—'}</span></td>
                <td class="text-muted">${formatDuration(m.duration_seconds)}</td>
                <td class="text-muted">${formatBytes(m.file_size)}</td>
                <td>
                    <div class="flex-align gap-sm">
                        <span class="text-dim">${m.video_codec || '—'}</span>
                        ${isAdmin ? '<button class="btn btn-ghost btn-sm text-error admin-delete-btn" title="Delete">🗑</button>' : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    _bindItemActions(container) {
        const isAdmin = this._isAdmin();

        container.querySelectorAll('.media-card, tr.media-row').forEach(element => {
            const mediaId = element.dataset.mediaId;
            const m = this._filteredItems.find(item => item.id == mediaId);
            if (!m) return;

            element.querySelector('.favorite-toggle-btn, .favorite-toggle-btn-small')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleFavorite(m, e.currentTarget);
            });

            if (isAdmin) {
                element.querySelector('.admin-delete-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._deleteMedia(m);
                });
            }

            element.addEventListener('click', (e) => {
                if (e.target.closest('.favorite-toggle-btn') || e.target.closest('.favorite-toggle-btn-small') || e.target.closest('.admin-delete-btn')) {
                    return;
                }
                this._playMedia(m.id);
            });
        });
    }

    async _toggleFavorite(media, btn) {
        try {
            const res = await api.toggleFavorite(media.id);
            media.is_favorite = !media.is_favorite;
            btn.classList.toggle('active', media.is_favorite);
            btn.innerHTML = media.is_favorite ? '❤️' : '🤍';
            toast(res.message, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async _deleteMedia(media) {
        const yes = await confirm('Delete Media', `Permanently delete "${media.title}" from the library and disk?`);
        if (!yes) return;
        try {
            await api.deleteMedia(media.id);
            toast('Media deleted', 'success');
            this._allMedia = this._allMedia.filter(m => m.id !== media.id);
            this._applyFilters();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    _isAdmin() {
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        return user.role === 'admin' || user.role === 'super-admin';
    }

    _playMedia(mediaId) {
        const item = this._filteredItems.find(m => m.id == mediaId);
        if (item && item.adult_only && !isAdultApproved()) {
            showAdultAccessDialog();
            return;
        }
        const index = this._filteredItems.findIndex(m => m.id == mediaId);
        try { player.play(this._filteredItems, index); }
        catch { toast('Could not play', 'error'); }
    }

    _toggleView() {
        this._viewMode = this._viewMode === 'grid' ? 'table' : 'grid';
        localStorage.setItem('lib_view_mode', this._viewMode);
        const toggleBtn = document.getElementById('lib-toggle');
        if (toggleBtn) toggleBtn.textContent = this._viewMode === 'grid' ? '☰' : '▦';
        this._applyFilters();
    }

    _playAll() {
        if (this._filteredItems.length === 0) {
            toast('Nothing to play.', 'warning');
            return;
        }
        
        const adultItems = this._filteredItems.filter(m => m.adult_only);
        if (adultItems.length > 0 && !isAdultApproved()) {
             toast('Adult content hidden. Verify age to play all.', 'error', {
                label: 'Verify',
                onClick: () => showAdultAccessDialog()
            });
            const safeItems = this._filteredItems.filter(m => !m.adult_only);
            if (safeItems.length === 0) return;
            player.play(safeItems, 0);
        } else {
            player.play(this._filteredItems, 0);
        }
        toast(`Playing ${this._filteredItems.length} items`, 'success');
    }

    destroy() {}
}
