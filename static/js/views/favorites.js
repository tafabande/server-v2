/**
 * MediaHub — Favorites View
 * Shows media items favorited by the user.
 */
import { api, player, router } from '../app.js';
import { toast, formatDuration, thumbUrl, isAdultApproved, showAdultAccessDialog } from '../utils.js';

export class FavoritesView {
    constructor(container) {
        this.container = container;
        this._items = [];
        this._categories = [];
        this._activeCategory = null;
        this._collapsedSubfolders = new Set();
    }

    async render() {
        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg">
                <div>
                    <h1 class="page-title">Favorites</h1>
                    <p class="page-subtitle">Your collection of liked media</p>
                </div>
                <button id="fav-play-all" class="btn btn-accent shadow-sm" title="Play all favorites">▶ Play All</button>
            </div>

            <div class="library-controls surface mb-md" id="fav-controls-container" style="display:none">
                <div id="fav-filter-tabs" class="tabs" style="margin-bottom:0; border-bottom:none"></div>
            </div>
            
            <div id="favorites-grid-container">
                <div class="skeleton-grid">
                    ${Array(8).fill().map(() => `
                        <div class="skeleton-card">
                            <div class="skeleton-poster shimmer-bg"></div>
                            <div class="skeleton-title shimmer-bg"></div>
                            <div class="skeleton-meta shimmer-bg"></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.getElementById('fav-play-all')?.addEventListener('click', () => this._playAllFavorites());
        await this._loadFavorites();
    }

    _playAllFavorites() {
        if (this._items.length === 0) {
            toast('No favorites to play.', 'warning');
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
        toast(`Playing ${this._items.length} favorites`, 'success');
    }

    _getSubfolder(item) {
        const parts = item.relative_path.split('/');
        if (parts.length > 2) {
            return parts.slice(1, -1).join('/');
        }
        return '';
    }

    async _loadFavorites() {
        try {
            const res = await api.getFavorites();
            const items = Array.isArray(res) ? res : (res?.items || []);
            this._items = items;

            const categories = [...new Set(items.map(m => m.category).filter(c => c))];
            this._categories = categories;
            if (!this._activeCategory || !categories.includes(this._activeCategory)) {
                this._activeCategory = null;
            }

            this._renderTabs();
            this._applyFilters();
        } catch (err) {
            const grid = document.getElementById('favorites-grid');
            if (grid) grid.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    _renderTabs() {
        const controls = document.getElementById('fav-controls-container');
        const tabsContainer = document.getElementById('fav-filter-tabs');
        if (!controls || !tabsContainer) return;

        if (this._categories.length === 0) {
            controls.style.display = 'none';
            return;
        }
        controls.style.display = 'block';

        const allActive = this._activeCategory === null ? 'active' : '';
        let html = `<button class="tab ${allActive}" data-category="all">All Collections</button>`;

        this._categories.forEach(cat => {
            const active = this._activeCategory === cat ? 'active' : '';
            html += `<button class="tab ${active}" data-category="${cat}">${cat}</button>`;
        });

        tabsContainer.innerHTML = html;

        tabsContainer.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const cat = tab.dataset.category;
                this._activeCategory = cat === 'all' ? null : cat;
                this._renderTabs();
                this._applyFilters();
            });
        });
    }

    _applyFilters() {
        let filtered = this._items;
        if (this._activeCategory) {
            filtered = this._items.filter(m => m.category === this._activeCategory);
        }
        this._renderGrid(filtered);
    }

    _renderGrid(items) {
        const container = document.getElementById('favorites-grid-container');
        if (!container) return;

        if (!items || items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❤️</div>
                    <p>No favorites found.</p>
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
                    <div class="subfolder-content ${collapsedClass} yt-grid">
                        ${subfolderItems.map(m => {
                const originalIdx = this._items.indexOf(m);
                return this._renderCard(m, originalIdx);
            }).join('')}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        container.querySelectorAll('.subfolder-header').forEach(header => {
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

        this._bindCards(container);
    }

    _renderCard(media, index) {
        const thumb = thumbUrl(media);
        const dur = formatDuration(media.duration_seconds);

        return `
            <div class="media-card ${media.adult_only ? 'is-adult' : ''}" data-index="${index}">
                <div class="media-card-poster">
                    <img class="media-card-thumb" src="${thumb}" alt="${media.title}" loading="lazy" onerror="this.src='/static/placeholder.svg'">
                    <span class="media-badge duration-badge">${dur}</span>
                    <div class="media-card-actions">
                        <button class="play-action-btn">▶</button>
                    </div>
                    <div class="media-card-badges">
                        <button class="favorite-toggle-btn active" title="Remove from favorites">❤️</button>
                    </div>
                </div>
                <div class="media-card-info">
                    <h3 class="media-title">${media.title}</h3>
                    <div class="media-meta">
                        <span>${dur}</span>
                        <span class="dot">·</span>
                        <span>${media.video_codec?.toUpperCase() || 'VIDEO'}</span>
                    </div>
                </div>
            </div>
        `;
    }

    _bindCards(container) {
        container.querySelectorAll('.media-card').forEach(card => {
            const idx = parseInt(card.dataset.index);
            const media = this._items[idx];

            card.querySelector('.play-action-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (media.adult_only && !isAdultApproved()) {
                    showAdultAccessDialog();
                    return;
                }
                player.play(this._items, idx);
            });

            card.addEventListener('click', () => {
                if (media.adult_only && !isAdultApproved()) {
                    showAdultAccessDialog();
                    return;
                }
                player.play(this._items, idx);
            });

            card.querySelector('.favorite-toggle-btn')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await api.toggleFavorite(media.id);
                    toast('Removed from favorites', 'success');
                    this._loadFavorites(); // Refresh list
                } catch (err) {
                    toast(err.message, 'error');
                }
            });
        });
    }

    destroy() { }
}
