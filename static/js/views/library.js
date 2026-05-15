/**
 * MediaHub — Library View
 * Full grid of all media, sortable and filterable.
 */
import { api, player } from '../app.js';
import { formatDuration, formatBytes, thumbUrl, toast } from '../utils.js';

export class LibraryView {
    constructor(container) { this.container = container; this._allMedia = []; this._viewMode = 'grid'; }

    async render() {
        this.container.innerHTML = `
            <div class="flex-between mb-md">
                <div>
                    <h1 class="page-title">Library</h1>
                    <p class="page-subtitle">All media in one place</p>
                </div>
                <div class="flex gap-sm">
                    <div class="search-bar" style="margin-bottom:0">
                        <input id="lib-search" class="input" type="text" placeholder="Filter...">
                    </div>
                    <select id="lib-sort" class="select" style="width:auto; min-width:120px">
                        <option value="title">Title</option>
                        <option value="date">Newest</option>
                        <option value="size">Largest</option>
                        <option value="duration">Longest</option>
                    </select>
                    <button id="lib-toggle" class="btn btn-ghost" title="Toggle view">▦</button>
                </div>
            </div>
            <div id="lib-filter-tabs" class="tabs"></div>
            <div id="lib-content">
                <div class="loading-state"><div class="spinner"></div> Loading...</div>
            </div>
        `;

        document.getElementById('lib-search').addEventListener('input', () => this._applyFilters());
        document.getElementById('lib-sort').addEventListener('change', () => this._applyFilters());
        document.getElementById('lib-toggle').addEventListener('click', () => this._toggleView());

        await this._loadMedia();
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
            document.getElementById('lib-content').innerHTML =
                `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    _renderTabs() {
        const tabs = document.getElementById('lib-filter-tabs');
        tabs.innerHTML = `
            <button class="tab active" data-cat="">All (${this._allMedia.length})</button>
            ${this._categories.map(c => {
                const count = this._allMedia.filter(m => m._category === c).length;
                return `<button class="tab" data-cat="${c}">${c} (${count})</button>`;
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

        this._renderItems(items);
    }

    _renderItems(items) {
        const target = document.getElementById('lib-content');
        if (items.length === 0) {
            target.innerHTML = '<div class="empty-state"><p>No media matches your filter.</p></div>';
            return;
        }

        if (this._viewMode === 'grid') {
            target.innerHTML = `<div class="gallery-grid">${items.map(m => `
                <div class="media-card" data-media='${JSON.stringify(m).replace(/'/g, "&#39;")}'>
                    <img class="media-card-thumb" src="${thumbUrl(m)}" alt="" loading="lazy" onerror="this.style.display='none'">
                    <div class="media-card-body">
                        <div class="media-card-title">${m.title}</div>
                        <div class="media-card-meta">${formatDuration(m.duration_seconds)} · ${formatBytes(m.file_size)}</div>
                    </div>
                </div>
            `).join('')}</div>`;
        } else {
            target.innerHTML = `
                <div class="surface" style="padding:0; overflow:hidden;">
                    <table class="table">
                        <thead><tr><th>Title</th><th>Category</th><th>Duration</th><th>Size</th><th>Codec</th></tr></thead>
                        <tbody>${items.map(m => `
                            <tr class="media-row" data-media='${JSON.stringify(m).replace(/'/g, "&#39;")}' style="cursor:pointer">
                                <td><strong>${m.title}</strong></td>
                                <td><span class="badge badge-muted">${m._category || '—'}</span></td>
                                <td>${formatDuration(m.duration_seconds)}</td>
                                <td>${formatBytes(m.file_size)}</td>
                                <td class="text-muted">${m.video_codec || '—'}</td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>
            `;
        }

        target.querySelectorAll('.media-card, .media-row').forEach((el, index) => {
            el.addEventListener('click', () => {
                try { player.play(items, index); }
                catch { toast('Could not play', 'error'); }
            });
        });
    }

    _toggleView() {
        this._viewMode = this._viewMode === 'grid' ? 'table' : 'grid';
        document.getElementById('lib-toggle').textContent = this._viewMode === 'grid' ? '▦' : '☰';
        this._applyFilters();
    }

    destroy() {}
}
