/**
 * MediaHub — Playlists View
 */
import { api, player } from '../app.js';
import { toast, confirm, formatDuration, thumbUrl } from '../utils.js';

export class PlaylistsView {
    constructor(container) { this.container = container; this._activePlaylist = null; }

    async render() {
        this.container.innerHTML = `
            <div class="flex-between mb-md">
                <div>
                    <h1 class="page-title">Playlists</h1>
                    <p class="page-subtitle">Organize your media</p>
                </div>
            </div>
            <div class="flex gap-md" style="align-items: flex-start;">
                <div style="min-width: 260px; max-width: 300px;">
                    <form id="create-playlist-form" class="surface mb-md">
                        <div class="form-group" style="margin-bottom:8px">
                            <input id="pl-title" class="input" placeholder="New playlist name..." required>
                        </div>
                        <button type="submit" class="btn btn-accent btn-sm" style="width:100%">Create Playlist</button>
                    </form>
                    <div id="playlists-list">
                        <div class="loading-state"><div class="spinner"></div></div>
                    </div>
                </div>
                <div style="flex:1">
                    <div id="playlist-detail">
                        <div class="empty-state"><p>Select a playlist</p></div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('create-playlist-form').addEventListener('submit', (e) => this._createPlaylist(e));
        await this._loadPlaylists();
    }

    async _loadPlaylists() {
        try {
            const res = await api.getPlaylists();
            const playlists = Array.isArray(res) ? res : (res?.items || []);
            const list = document.getElementById('playlists-list');

            if (!playlists || playlists.length === 0) {
                list.innerHTML = '<p class="text-muted text-sm" style="padding:8px">No playlists yet</p>';
                return;
            }

            list.innerHTML = playlists.map(pl => `
                <div class="nav-link" data-pl-id="${pl.id}" style="margin-bottom:2px">
                    <span class="nav-icon">☰</span>
                    <span class="nav-label">
                        <strong>${pl.title}</strong>
                        <span class="text-muted text-sm"> · ${pl.item_count} items</span>
                    </span>
                </div>
            `).join('');

            list.querySelectorAll('[data-pl-id]').forEach(el => {
                el.addEventListener('click', () => this._viewPlaylist(parseInt(el.dataset.plId)));
            });
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async _viewPlaylist(id) {
        this._activePlaylist = id;
        const detail = document.getElementById('playlist-detail');
        detail.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

        try {
            const pl = await api.getPlaylist(id);
            detail.innerHTML = `
                <div class="surface">
                    <div class="flex-between mb-md">
                        <div>
                            <h2 style="font-size:1.2rem; font-weight:700">${pl.title}</h2>
                            ${pl.description ? `<p class="text-muted text-sm">${pl.description}</p>` : ''}
                        </div>
                        <div class="flex gap-sm">
                            <button id="play-all-btn" class="btn btn-accent btn-sm">▶ Play All</button>
                            <button id="delete-pl-btn" class="btn btn-danger btn-sm">Delete</button>
                        </div>
                    </div>
                    ${pl.items.length === 0 ?
                    '<div class="empty-state"><p>Empty playlist — add media from the library</p></div>' :
                    `<div class="gallery-grid">${pl.items.map(m => `
                            <div class="media-card" data-media='${JSON.stringify(m).replace(/'/g, "&#39;")}'>
                                <img class="media-card-thumb" src="${thumbUrl(m)}" alt="" loading="lazy" onerror="this.style.display='none'">
                                <div class="media-card-body">
                                    <div class="media-card-title">${m.title}</div>
                                    <div class="media-card-meta">${formatDuration(m.duration_seconds)}</div>
                                </div>
                            </div>
                        `).join('')}</div>`
                }
                </div>
            `;

            detail.querySelectorAll('.media-card').forEach((card, index) => {
                card.addEventListener('click', () => {
                    try { player.play(pl.items, index); }
                    catch { toast('Could not play', 'error'); }
                });
            });

            document.getElementById('play-all-btn')?.addEventListener('click', () => {
                if (pl.items.length > 0) player.play(pl.items, 0);
            });

            document.getElementById('delete-pl-btn')?.addEventListener('click', async () => {
                const yes = await confirm('Delete Playlist', `Delete "${pl.title}"?`);
                if (!yes) return;
                try {
                    await api.deletePlaylist(id);
                    toast('Playlist deleted', 'success');
                    detail.innerHTML = '<div class="empty-state"><p>Select a playlist</p></div>';
                    await this._loadPlaylists();
                } catch (err) { toast(err.message, 'error'); }
            });
        } catch (err) {
            detail.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    async _createPlaylist(e) {
        e.preventDefault();
        const titleInput = document.getElementById('pl-title');
        const title = titleInput.value.trim();
        if (!title) return;

        try {
            await api.createPlaylist(title);
            titleInput.value = '';
            toast('Playlist created', 'success');
            await this._loadPlaylists();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    destroy() { }
}
