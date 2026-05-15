/**
 * MediaHub — Home View
 * Shows Continue Watching, Recently Added, and category rows.
 */
import { api, player } from '../app.js';
import { toast, formatDuration, thumbUrl } from '../utils.js';

export class HomeView {
    constructor(container) { this.container = container; }

    async render() {
        this.container.innerHTML = `
            <div class="flex-between mb-md">
                <div>
                    <h1 class="page-title">Home</h1>
                    <p class="page-subtitle">Your media at a glance</p>
                </div>
                <div class="search-bar">
                    <input id="home-search" class="input" type="text" placeholder="Search media... (Ctrl+K)">
                </div>
            </div>
            <div id="continue-section" hidden>
                <div class="section-title">Continue Watching</div>
                <div id="continue-track" class="gallery-track"></div>
            </div>
            <div id="library-rows">
                <div class="loading-state"><div class="spinner"></div> Loading library...</div>
            </div>
        `;

        document.getElementById('home-search').addEventListener('input', (e) => this._filterSearch(e.target.value));

        await Promise.all([this._loadContinue(), this._loadLibrary()]);
    }

    async _loadContinue() {
        try {
            const items = await api.getContinueWatching();
            if (!items || items.length === 0) return;

            const section = document.getElementById('continue-section');
            section.hidden = false;

            document.getElementById('continue-track').innerHTML = items.map(item => 
                this._renderCard(item.media, item.last_position_seconds)
            ).join('');

            this._bindCards(document.getElementById('continue-track'));
        } catch { /* Guest or no history */ }
    }

    async _loadLibrary() {
        try {
            const groups = await api.getLibrary();
            this._groups = groups;
            this._renderGroups(groups);
        } catch (err) {
            document.getElementById('library-rows').innerHTML = 
                `<div class="empty-state"><p>Could not load library: ${err.message}</p></div>`;
        }
    }

    _renderGroups(groups) {
        const target = document.getElementById('library-rows');
        if (!groups || groups.length === 0) {
            target.innerHTML = '<div class="empty-state"><p>No media found. Add files to the shared folder and rescan.</p></div>';
            return;
        }

        target.innerHTML = groups.map(group => `
            <div class="gallery-row">
                <div class="section-title">${group.label} <span class="badge badge-muted">${group.items.length}</span></div>
                <div class="gallery-track">${group.items.map(m => this._renderCard(m)).join('')}</div>
            </div>
        `).join('');

        this._bindCards(target);
    }

    _renderCard(media, resumePos = null) {
        const thumb = thumbUrl(media);
        const dur = formatDuration(media.duration_seconds);
        const resumeHtml = resumePos ? 
            `<div class="progress mt-sm"><div class="progress-fill" style="width: ${Math.round((resumePos / media.duration_seconds) * 100)}%"></div></div>` : '';

        return `
            <div class="media-card" data-media-id="${media.id}" data-media='${JSON.stringify(media).replace(/'/g, "&#39;")}'>
                <img class="media-card-thumb" src="${thumb}" alt="${media.title}" loading="lazy" onerror="this.style.display='none'">
                <div class="media-card-body">
                    <div class="media-card-title" title="${media.title}">${media.title}</div>
                    <div class="media-card-meta">${dur}${media.video_codec ? ' · ' + media.video_codec.toUpperCase() : ''}</div>
                    <div class="media-card-badges">
                        ${media.requires_pin ? '<span class="badge badge-warning">🔒</span>' : ''}
                        ${media.hls_status === 'ready' ? '<span class="badge badge-accent">HLS</span>' : ''}
                    </div>
                    ${resumeHtml}
                </div>
            </div>
        `;
    }

    _bindCards(container) {
        const cards = Array.from(container.querySelectorAll('.media-card'));
        const trackItems = cards.map(c => {
            try { return JSON.parse(c.dataset.media); }
            catch { return null; }
        }).filter(Boolean);

        cards.forEach((card, index) => {
            card.addEventListener('click', () => {
                try {
                    player.play(trackItems, index);
                } catch (err) {
                    toast('Could not play media', 'error');
                }
            });
        });
    }

    _filterSearch(query) {
        if (!this._groups) return;
        const q = query.toLowerCase().trim();
        if (!q) {
            this._renderGroups(this._groups);
            return;
        }

        const filtered = this._groups.map(g => ({
            ...g,
            items: g.items.filter(m => m.title.toLowerCase().includes(q))
        })).filter(g => g.items.length > 0);

        this._renderGroups(filtered);
    }

    destroy() {}
}
