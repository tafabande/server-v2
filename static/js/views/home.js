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
            <div id="hero-banner" class="mb-lg" style="display:none"></div>
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
            
            const allMedia = groups.flatMap(g => g.items);
            if (allMedia.length > 0) {
                const randomMedia = allMedia[Math.floor(Math.random() * allMedia.length)];
                this._renderHero(randomMedia);
            }

            this._renderGroups(groups);
        } catch (err) {
            document.getElementById('library-rows').innerHTML = 
                `<div class="empty-state"><p>Could not load library: ${err.message}</p></div>`;
        }
    }

    _renderHero(media) {
        const heroContainer = document.getElementById('hero-banner');
        heroContainer.style.display = 'block';
        
        heroContainer.innerHTML = `
            <div class="hero-card" style="position:relative; width:100%; height:45vh; min-height:300px; border-radius:12px; overflow:hidden; background:#000; cursor:pointer; box-shadow:0 8px 30px rgba(0,0,0,0.5)">
                <img src="${thumbUrl(media)}" style="position:absolute; width:100%; height:100%; object-fit:cover; opacity:0.4; z-index:1" onerror="this.style.opacity=0">
                <video id="hero-video" style="position:absolute; width:100%; height:100%; object-fit:cover; opacity:0; transition: opacity 1.5s ease; z-index:2" muted loop playsinline></video>
                <div style="position:absolute; bottom:0; left:0; right:0; padding:60px 24px 24px; background:linear-gradient(transparent, #050505 90%); z-index:3; display:flex; justify-content:space-between; align-items:flex-end">
                    <div>
                        <h2 style="font-size:2.5rem; font-weight:800; margin-bottom:8px; text-shadow:0 2px 10px rgba(0,0,0,0.8)">${media.title}</h2>
                        <p class="text-muted" style="text-shadow:0 1px 4px rgba(0,0,0,0.8)">${formatDuration(media.duration_seconds)} · ${media.video_codec || 'VIDEO'}</p>
                    </div>
                    <button class="btn btn-accent" style="border-radius:30px; padding:12px 24px; font-weight:700; box-shadow:0 4px 15px rgba(239, 68, 68, 0.4)">▶ Play Now</button>
                </div>
            </div>
        `;

        heroContainer.querySelector('.hero-card').addEventListener('click', () => {
            player.play(media);
        });

        // Autoplay silent video
        api.stream(media.id).then(res => {
            if (res && res.url) {
                const video = document.getElementById('hero-video');
                if (!video) return;
                
                if (res.mode === 'hls' && typeof Hls !== 'undefined' && Hls.isSupported()) {
                    this._heroHls = new Hls({ startLevel: 0 }); // lowest quality for background
                    this._heroHls.loadSource(res.url);
                    this._heroHls.attachMedia(video);
                    this._heroHls.on(Hls.Events.MANIFEST_PARSED, () => {
                        video.play().then(() => video.style.opacity = '0.6').catch(()=>{});
                    });
                } else {
                    video.src = res.url;
                    video.play().then(() => video.style.opacity = '0.6').catch(()=>{});
                }
            }
        }).catch(()=>{});
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

    destroy() {
        if (this._heroHls) {
            this._heroHls.destroy();
            this._heroHls = null;
        }
        const video = document.getElementById('hero-video');
        if (video) {
            video.pause();
            video.src = '';
        }
    }
}
