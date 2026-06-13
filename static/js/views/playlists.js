/**
 * MediaHub — Playlists View
 * Simple playlist list with Favorites pre-loaded.
 * Add button in top-right corner, no descriptions.
 */
import { api, player } from '../app.js';
import { toast, confirm, formatDuration, thumbUrl, showPinDialog, escapeHtml } from '../utils.js';

export class PlaylistsView {
    constructor(container) {
        this.container = container;
        this._activePlaylistId = null;
        this._playlists = [];
        this.hoverTimeout = null;
        this.previewVideo = null;
    }

    async render() {
        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg" style="position: relative; z-index: 10; align-items: center;">
                <h1 class="page-title">Playlists</h1>
                <button id="btn-add-playlist" class="btn btn-accent btn-sm" style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:1.1rem;line-height:1;">＋</span> New Playlist
                </button>
            </div>

            <!-- Inline create form (hidden by default) -->
            <div id="create-playlist-panel" style="display:none; margin-bottom: 16px;">
                <div class="surface" style="padding:16px; border-radius: var(--radius); border: 1px solid var(--border-subtle);">
                    <div class="form-group" style="margin-bottom:10px">
                        <input id="pl-title-input" class="input" placeholder="Playlist name..." required style="width:100%;">
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button id="btn-cancel-create" class="btn btn-ghost btn-sm">Cancel</button>
                        <button id="btn-confirm-create" class="btn btn-accent btn-sm">Create</button>
                    </div>
                </div>
            </div>

            <div style="display:flex;gap:20px;align-items:flex-start;">
                <!-- Playlist sidebar list -->
                <div id="playlists-sidebar" style="min-width:240px;max-width:260px;width:100%;">
                    <div class="loading-state"><div class="spinner"></div></div>
                </div>
                <!-- Playlist detail panel -->
                <div id="playlist-detail" style="flex:1; min-width:0;">
                    <div class="empty-state"><p>Select a playlist to view its contents</p></div>
                </div>
            </div>
        `;

        document.getElementById('btn-add-playlist')?.addEventListener('click', () => {
            const panel = document.getElementById('create-playlist-panel');
            if (panel) { panel.style.display = 'block'; document.getElementById('pl-title-input')?.focus(); }
        });

        document.getElementById('btn-cancel-create')?.addEventListener('click', () => {
            const panel = document.getElementById('create-playlist-panel');
            if (panel) { panel.style.display = 'none'; document.getElementById('pl-title-input').value = ''; }
        });

        document.getElementById('btn-confirm-create')?.addEventListener('click', () => this._createPlaylist());

        document.getElementById('pl-title-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._createPlaylist();
            if (e.key === 'Escape') document.getElementById('btn-cancel-create')?.click();
        });

        await this._loadPlaylists();
        this._setupHoverPreviews();
    }

    async _createPlaylist() {
        const input = document.getElementById('pl-title-input');
        const title = input?.value.trim();
        if (!title) { toast('Playlist name is required', 'warning'); return; }

        try {
            const pl = await api.createPlaylist(title, '');
            input.value = '';
            document.getElementById('create-playlist-panel').style.display = 'none';
            toast('Playlist created', 'success');
            await this._loadPlaylists();
            this._selectPlaylist(pl.id);
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async _loadPlaylists() {
        const sidebar = document.getElementById('playlists-sidebar');
        if (!sidebar) return;

        try {
            let playlists = await api.getPlaylists();
            playlists = Array.isArray(playlists) ? playlists : (playlists?.items || []);

            // Ensure "Favorites" playlist exists as the first entry
            let favPl = playlists.find(p => p.title === 'Favorites');
            if (!favPl) {
                favPl = await api.createPlaylist('Favorites', '');
                playlists.unshift(favPl);
            } else {
                // Ensure Favorites is first
                playlists = [favPl, ...playlists.filter(p => p.id !== favPl.id)];
            }

            this._playlists = playlists;

            sidebar.innerHTML = playlists.map(pl => `
                <div class="playlist-list-item nav-link ${this._activePlaylistId === pl.id ? 'active' : ''}"
                     data-pl-id="${pl.id}"
                     style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--radius);margin-bottom:4px;cursor:pointer;transition:background 0.15s;">
                    <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                        <span style="font-size:1.1rem;">${pl.title === 'Favorites' ? '❤️' : '📁'}</span>
                        <div style="min-width:0;">
                            <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(pl.title)}</div>
                            <div class="text-muted text-xs">${pl.item_count ?? 0} items</div>
                        </div>
                    </div>
                    ${pl.title !== 'Favorites' ? `<button class="btn-icon btn-delete-pl" data-pl-id="${pl.id}" title="Delete" style="color:var(--text-muted);font-size:0.85rem;opacity:0.6;padding:4px 6px;flex-shrink:0;">✕</button>` : ''}
                </div>
            `).join('');

            sidebar.querySelectorAll('[data-pl-id]').forEach(el => {
                // Only trigger select on non-delete-button clicks
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.btn-delete-pl')) return;
                    this._selectPlaylist(parseInt(el.dataset.plId));
                });
            });

            sidebar.querySelectorAll('.btn-delete-pl').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = parseInt(btn.dataset.plId);
                    const pl = this._playlists.find(p => p.id === id);
                    const yes = await confirm('Delete Playlist', `Delete "${pl?.title}"?`);
                    if (!yes) return;
                    try {
                        await api.deletePlaylist(id);
                        toast('Playlist deleted', 'success');
                        if (this._activePlaylistId === id) {
                            this._activePlaylistId = null;
                            const detail = document.getElementById('playlist-detail');
                            if (detail) detail.innerHTML = '<div class="empty-state"><p>Select a playlist to view its contents</p></div>';
                        }
                        await this._loadPlaylists();
                    } catch (err) { toast(err.message, 'error'); }
                });
            });

            // Auto-select first playlist (Favorites)
            if (!this._activePlaylistId && this._playlists.length > 0) {
                this._selectPlaylist(this._playlists[0].id);
            } else if (this._activePlaylistId) {
                this._selectPlaylist(this._activePlaylistId);
            }

        } catch (err) {
            sidebar.innerHTML = `<div class="empty-state"><p>Error loading playlists: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    async _selectPlaylist(id) {
        this._activePlaylistId = id;

        // Highlight active in sidebar
        document.querySelectorAll('.playlist-list-item').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.plId) === id);
        });

        const detail = document.getElementById('playlist-detail');
        if (!detail) return;
        detail.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

        try {
            const pl = await api.getPlaylist(id);

            detail.innerHTML = `
                <div class="surface" style="padding:16px;border-radius:var(--radius);">
                    <div class="flex-between mb-md" style="align-items:center;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-size:1.4rem;">${pl.title === 'Favorites' ? '❤️' : '📁'}</span>
                            <div>
                                <h2 style="font-size:1.1rem;font-weight:700;margin:0;">${escapeHtml(pl.title)}</h2>
                                <div class="text-muted text-xs">${pl.items?.length ?? 0} items</div>
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            ${pl.items?.length > 0 ? `<button id="btn-play-all" class="btn btn-accent btn-sm">▶ Play All</button>` : ''}
                            ${pl.title !== 'Favorites' ? `<button id="btn-rename-pl" class="btn btn-ghost btn-sm">Rename</button>` : ''}
                        </div>
                    </div>

                    <!-- Rename inline form -->
                    <div id="rename-pl-panel" style="display:none;margin-bottom:12px;">
                        <div style="display:flex;gap:8px;">
                            <input id="rename-pl-input" class="input input-sm" value="${escapeHtml(pl.title)}" style="flex:1;">
                            <button id="btn-save-rename" class="btn btn-accent btn-sm">Save</button>
                            <button id="btn-cancel-rename" class="btn btn-ghost btn-sm">Cancel</button>
                        </div>
                    </div>

                    ${pl.items?.length === 0
                        ? '<div class="empty-state" style="padding:40px 0;"><p>No items in this playlist yet.<br>Add media from your Library.</p></div>'
                        : `<div class="yt-grid-8" id="pl-items-grid">
                            ${pl.items.map((m, idx) => this._renderCard(m, idx, pl.id)).join('')}
                           </div>`
                    }
                </div>
            `;

            document.getElementById('btn-play-all')?.addEventListener('click', () => {
                if (pl.items?.length > 0) player.play(pl.items, 0);
            });

            document.getElementById('btn-rename-pl')?.addEventListener('click', () => {
                document.getElementById('rename-pl-panel').style.display = 'block';
                document.getElementById('rename-pl-input')?.focus();
            });

            document.getElementById('btn-cancel-rename')?.addEventListener('click', () => {
                document.getElementById('rename-pl-panel').style.display = 'none';
            });

            document.getElementById('btn-save-rename')?.addEventListener('click', async () => {
                const newTitle = document.getElementById('rename-pl-input')?.value.trim();
                if (!newTitle) { toast('Name required', 'warning'); return; }
                try {
                    await api.updatePlaylist(id, newTitle, '');
                    toast('Playlist renamed', 'success');
                    await this._loadPlaylists();
                } catch (err) { toast(err.message, 'error'); }
            });

            // Bind card events
            detail.querySelectorAll('.pl-media-card').forEach(card => {
                card.addEventListener('click', async (e) => {
                    const idx = parseInt(card.dataset.index);
                    const media = pl.items[idx];

                    if (e.target.closest('.btn-remove')) {
                        e.stopPropagation();
                        try {
                            await api.removeFromPlaylist(id, media.id);
                            toast('Removed from playlist', 'success');
                            
                            // Remove from DOM and array to prevent stutter
                            card.remove();
                            pl.items.splice(idx, 1);
                            
                            // Update remaining indexes
                            detail.querySelectorAll('.pl-media-card').forEach(c => {
                                let cIdx = parseInt(c.dataset.index);
                                if (cIdx > idx) c.dataset.index = cIdx - 1;
                            });
                            
                            // Update count in header
                            const countEl = detail.querySelector('.flex-between .text-muted.text-xs');
                            if (countEl) countEl.textContent = `${pl.items.length} items`;
                            
                            // Refresh sidebar stats silently
                            this._loadPlaylists();
                        } catch (err) { toast(err.message, 'error'); }
                        return;
                    }

                    if (e.target.closest('.btn-download')) {
                        e.stopPropagation();
                        this._download(media);
                        return;
                    }

                    if (e.target.closest('.btn-fav')) {
                        e.stopPropagation();
                        try {
                            const res = await api.toggleFavorite(media.id);
                            const isFav = res.status === 'added';
                            media.is_favorite = isFav;
                            const btn = e.target.closest('.btn-fav');
                            btn.classList.toggle('active', isFav);
                            btn.innerHTML = isFav ? '❤️' : '♡';
                            toast(res.message, 'success');
                        } catch (err) { toast(err.message, 'error'); }
                        return;
                    }

                    try { player.play(pl.items, idx); }
                    catch { toast('Could not play', 'error'); }
                });
            });

        } catch (err) {
            detail.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    _renderCard(m, index, playlistId) {
        const title = m.title || m.filename;
        const dur = formatDuration(m.duration_seconds);
        const thumb = thumbUrl(m);
        const isFav = m.is_favorite;

        return `
            <div class="pl-media-card group relative flex flex-col gap-2 cursor-pointer transition-all duration-300 hover:scale-[1.02]" data-index="${index}" data-media-id="${m.id}" style="will-change:transform;">
                <div class="media-card-poster relative aspect-[2/3] overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low">
                    <img src="${thumb}" alt="${escapeHtml(title)}" class="media-card-thumb shimmer-bg w-full h-full object-cover" loading="lazy"
                         style="opacity:0;transition:opacity 0.3s ease;"
                         onload="this.style.opacity=1;this.classList.remove('shimmer-bg');"
                         onerror="this.onerror=null;this.src='/static/placeholder.svg';this.style.opacity=1;this.classList.remove('shimmer-bg');">
                    ${m.adult_only ? '<div class="absolute top-2 left-2 px-2 py-0.5 bg-error text-on-error font-bold text-[10px] rounded uppercase tracking-widest shadow-md">R18</div>' : ''}
                    
                    <!-- Hover Overlay -->
                    <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div class="w-14 h-14 bg-primary rounded-full flex items-center justify-center shadow-lg text-on-primary btn-play">
                            <span class="material-symbols-outlined text-4xl fill-icon" data-icon="play_arrow" style="pointer-events:none;">play_arrow</span>
                        </div>
                        <button class="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-black/40 backdrop-blur-md rounded-full text-primary border border-white/10 btn-fav ${isFav ? 'active' : ''}" title="Favorite">
                            <span class="material-symbols-outlined text-[20px] ${isFav ? 'fill-icon' : ''}" data-icon="favorite">favorite</span>
                        </button>
                        <button class="absolute top-2 right-12 w-8 h-8 flex items-center justify-center bg-black/40 backdrop-blur-md rounded-full text-primary border border-white/10 btn-remove" title="Remove">
                            <span class="material-symbols-outlined text-[20px]" data-icon="close" style="pointer-events:none;">close</span>
                        </button>
                    </div>
                </div>
                <div class="media-card-info flex flex-col px-1">
                    <h3 class="media-title font-bold text-on-surface font-body-md line-clamp-1" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                    <div class="media-meta flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
                        <span>${dur}</span>
                        <span>${escapeHtml(m.video_codec?.toUpperCase() || 'VIDEO')}</span>
                    </div>
                </div>
            </div>
        `;
    }

    async _download(media) {
        let url = `/api/media/${media.id}/download`;
        if (media.requires_pin) {
            const pin = await showPinDialog('Enter PIN to download:');
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

    _setupHoverPreviews() {
        this.container.addEventListener('mouseenter', (e) => {
            const card = e.target.closest('.pl-media-card');
            if (!card) return;
            if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
            this._cleanupPreview();

            this.hoverTimeout = setTimeout(() => {
                const mediaId = card.dataset.mediaId;
                const posterImg = card.querySelector('img');
                if (!mediaId) return;

                this.previewVideo = document.createElement('video');
                this.previewVideo.src = `/api/media/${mediaId}/preview`;
                this.previewVideo.muted = true;
                this.previewVideo.autoplay = true;
                this.previewVideo.loop = true;
                this.previewVideo.setAttribute('playsinline', '');
                this.previewVideo.setAttribute('webkit-playsinline', '');
                this.previewVideo.className = 'card-preview-video';
                this.previewVideo.addEventListener('error', () => this._cleanupPreview());
                Object.assign(this.previewVideo.style, {
                    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                    objectFit: 'cover', borderRadius: 'var(--radius)', zIndex: '2'
                });

                const poster = card.querySelector('.media-card-poster');
                if (poster) { poster.style.position = 'relative'; poster.appendChild(this.previewVideo); }
                if (posterImg) posterImg.style.opacity = '0.1';
                this.previewVideo.play().catch(() => {});

                card.addEventListener('mouseleave', () => { this._cleanupPreview(); if (posterImg) posterImg.style.opacity = '1'; }, { once: true });
            }, 500);

            card.addEventListener('mouseleave', () => {
                if (this.hoverTimeout) { clearTimeout(this.hoverTimeout); this.hoverTimeout = null; }
            }, { once: true });
        }, true);
    }

    _cleanupPreview() {
        if (this.hoverTimeout) { clearTimeout(this.hoverTimeout); this.hoverTimeout = null; }
        if (this.previewVideo) {
            try { this.previewVideo.pause(); this.previewVideo.src = ''; this.previewVideo.remove(); } catch (e) {}
            this.previewVideo = null;
        }
        document.querySelectorAll('.card-preview-video').forEach(v => {
            try { v.pause(); v.src = ''; v.remove(); } catch (e) {}
        });
    }

    destroy() { this._cleanupPreview(); }
}
