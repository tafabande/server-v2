/**
 * MediaHub — Home View (State-Driven Component System)
 * Overhauled to decouple logic and UI, fix memory leaks, and add cache versioning.
 */
import { api, player, router } from '../app.js';
import { toast, formatDuration, formatDate, thumbUrl, debounce, isAdultApproved, showAdultAccessDialog, escapeHtml, homeCacheKey, clearContentCaches, prefetchThumbnails } from '../utils.js';

export class HomeView {
    constructor(container) {
        this.container = container;
        this.rowsOffset = 0;
        this.hoverTimeout = null;
        this._hoverHandler = null;
        
        this.previewVideo = document.createElement('video');
        this.previewVideo.muted = true;
        this.previewVideo.autoplay = true;
        this.previewVideo.loop = true;
        this.previewVideo.setAttribute('playsinline', '');
        this.previewVideo.className = 'card-preview-video';
        Object.assign(this.previewVideo.style, {
            position: 'absolute', top: '0', left: '0',
            width: '100%', height: '100%', objectFit: 'cover',
            borderRadius: '0', zIndex: '2',
            display: 'none', pointerEvents: 'none'
        });
        this.previewVideo.addEventListener('error', () => {
            this.previewVideo.style.display = 'none';
            if (this._activePosterImg) this._activePosterImg.style.opacity = '1';
        });
        container.appendChild(this.previewVideo);

        this._abortController = new AbortController();
        this._searchSeq = 0;

        // State object
        this.state = {
            hero: null,
            rows: [],
            videosList: [],
            videosPage: 1,
            videosLoading: false,
            hasMoreVideos: true,
            filterContext: 'all'
        };

        this._globalKeydownHandler = this._globalKeydownHandler.bind(this);
    }

    _normalizeMedia(m) {
        return {
            id: m.id,
            title: m.title || m.filename || 'Unknown',
            duration: m.duration_seconds || m.duration || 0,
            progress: m.progress || 0,
            resume_position: m.resume_position || m.progress * (m.duration_seconds || m.duration || 0) || 0,
            year: m.year || '',
            path: m.path || '',
            adult_only: !!m.adult_only,
            video_codec: m.video_codec || ''
        };
    }

    async render() {
        this.container.innerHTML = `
            <div class="home-layout">
                <div class="filter-sidebar">
                    <h3 style="font-size: 0.85rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Explore</h3>
                    <div id="smart-sidebar-sections" style="display: flex; flex-direction: column; gap: 4px;">
                        <div class="skeleton-title shimmer-bg" style="width: 80%; height: 20px; margin-bottom: 8px;"></div>
                        <div class="skeleton-title shimmer-bg" style="width: 60%; height: 20px;"></div>
                    </div>
                </div>

                <div class="home-feed-content" style="display: flex; flex-direction: column; width: 100%;">
                    <div class="primary-search-container">
                        <div class="primary-search-wrapper">
                            <input id="home-search" class="primary-search-input" type="text" placeholder="Search library (Press / to focus)" autocomplete="off">
                            <button id="home-search-clear" class="search-clear-btn">&times;</button>
                            <div id="search-suggestions" class="search-suggestions" style="top: 60px; left: 0; right: 0; position: absolute;"></div>
                        </div>
                        <button class="btn btn-ghost" id="home-search-filters">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                        </button>
                    </div>

                    <div id="home-feed-body" style="padding: 24px;">
                        <div id="request-banner-container"></div>
                        <div id="smart-sections"></div>
                        
                        <div id="hero-banner" class="hero-compact mb-lg hidden">
                            <div class="hero-backdrop" style="position:absolute; top:0; left:0; right:0; bottom:0; background-size:cover; background-position:center;"></div>
                            <div class="hero-gradient" style="position:absolute; top:0; left:0; right:0; bottom:0; background: linear-gradient(0deg, var(--bg) 0%, rgba(0,0,0,0.4) 100%);"></div>
                            <div class="hero-content">
                                <div class="hero-badges" style="margin-bottom: 8px;">
                                    <span class="badge badge-accent" id="hero-badge-type">Featured</span>
                                    <span class="badge badge-muted" id="hero-badge-codec">HD</span>
                                </div>
                                <h2 class="hero-title"></h2>
                                <p class="hero-synopsis" style="margin: 8px 0; color: var(--text-muted); font-size: 0.95rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;"></p>
                                <div class="hero-meta" style="margin-bottom: 16px; font-size: 0.9rem;">
                                    <span class="hero-year"></span> • <span class="hero-duration"></span>
                                </div>
                                <div class="hero-buttons" style="display:flex; gap:8px;">
                                    <button class="btn btn-accent hero-play-btn">▶ Play</button>
                                    <button class="btn btn-ghost hero-mylist-btn">+ My List</button>
                                </div>
                                <div class="hero-resume hidden" style="margin-top: 8px; font-size: 0.85rem; color: var(--accent); background: transparent; border: 1px solid var(--border); padding: 4px 8px;">
                                    <span>Resume from <span class="hero-resume-position"></span></span>
                                </div>
                            </div>
                        </div>

                        <div id="home-videos-section">
                            <h2 id="grid-context-title" class="row-title mb-md">All Videos</h2>
                            <div id="home-videos-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;"></div>
                            <div id="home-videos-sentinel" style="height:20px; margin-top:20px;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._setupSearch();
        document.addEventListener('keydown', this._globalKeydownHandler);

        await this._loadRequestAlerts();
        await this._loadSmartHome();
        this._attachScrollListeners();
        this._setupHoverPreviews();
    }

    _setupSearch() {
        const searchInput = document.getElementById('home-search');
        const searchClear = document.getElementById('home-search-clear');
        
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                const q = e.target.value.trim();
                if (q.length > 0 && searchClear) searchClear.classList.add('visible');
                else if (searchClear) searchClear.classList.remove('visible');
                
                if (q.length > 1) this._showSuggestions(q);
                else document.getElementById('search-suggestions')?.classList.remove('active');
            }, 200));

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const q = e.target.value.trim();
                    this._filterSearch(q);
                    document.getElementById('search-suggestions')?.classList.remove('active');
                }
            });

            searchInput.addEventListener('blur', () => {
                setTimeout(() => document.getElementById('search-suggestions')?.classList.remove('active'), 200);
            });
            
            if (searchClear) {
                searchClear.addEventListener('click', () => {
                    searchInput.value = '';
                    searchClear.classList.remove('visible');
                    document.getElementById('search-suggestions')?.classList.remove('active');
                    this._filterSearch('');
                });
            }
        }
    }

    _globalKeydownHandler(e) {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            const input = document.getElementById('home-search');
            if (input) input.focus();
        }
    }

    async _showSuggestions(query) {
        const suggestionsDiv = document.getElementById('search-suggestions');
        if (!suggestionsDiv) return;

        this._searchSeq++;
        const seq = this._searchSeq;

        try {
            const results = await api.getSearch(query.toLowerCase());
            if (seq !== this._searchSeq) return;
            if (results && results.length > 0) {
                const topResults = results.slice(0, 5);
                suggestionsDiv.innerHTML = topResults.map(r => `
                    <div class="suggestion-item" data-id="${r.id}">
                        <span class="suggestion-title">${escapeHtml(r.title)}</span>
                    </div>
                `).join('');
                
                suggestionsDiv.querySelectorAll('.suggestion-item').forEach(item => {
                    item.addEventListener('click', () => {
                        this._filterSearch(query);
                        suggestionsDiv.classList.remove('active');
                    });
                });
                
                suggestionsDiv.classList.add('active');
            } else {
                suggestionsDiv.classList.remove('active');
            }
        } catch (e) {
            suggestionsDiv.classList.remove('active');
        }
    }

    async _loadRequestAlerts() {
        try {
            const bannerContainer = document.getElementById('request-banner-container');
            if (!bannerContainer) return;

            const res = await api.getRequests();
            const requests = Array.isArray(res) ? res : (res?.items || []);
            const recent = requests.filter(r => new Date(r.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
            
            for (const r of recent) {
                const storageKey = `ack_req_${r.id}_${r.status}`;
                if (localStorage.getItem(storageKey)) continue;

                if (r.status === 'approved' || r.status === 'denied') {
                    const title = r.request_type === 'adult_elevation' ? '18+ Access Request' : `Folder Access: /${r.target_path ? r.target_path.split('/').pop() : 'unknown'}`;
                    
                    let bannerHtml = '';
                    if (r.status === 'approved') {
                        bannerHtml = `
                            <div class="status-banner status-banner--success mb-md flex-between" style="border: 1px solid var(--success); background: rgba(16, 185, 129, 0.05); padding: 12px 16px;">
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <div style="font-size: 1.5rem;">✅</div>
                                    <div>
                                        <strong style="color: var(--success);">Access Request Approved!</strong>
                                        <div class="text-muted text-xs" style="margin-top: 2px;">Your request for <strong>${escapeHtml(title)}</strong> has been APPROVED!</div>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <button class="btn btn-sm btn-ghost view-profile-btn">View Profile</button>
                                    <button class="dismiss-banner-btn" style="background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:1.5rem; line-height:1;">&times;</button>
                                </div>
                            </div>
                        `;
                    }

                    if (bannerHtml) {
                        bannerContainer.innerHTML = bannerHtml;
                        bannerContainer.querySelector('.dismiss-banner-btn')?.addEventListener('click', () => {
                            localStorage.setItem(storageKey, 'true');
                            bannerContainer.innerHTML = '';
                            toast('Alert dismissed', 'info');
                        });
                        bannerContainer.querySelector('.view-profile-btn')?.addEventListener('click', () => {
                            router.navigate('/profile');
                        });
                    }
                }
            }
        } catch (bannerErr) {
            console.error("Failed to load request banner alerts", bannerErr);
        }
    }

    async _loadSmartHomeData() {
        const cacheKey = homeCacheKey();
        const cacheTimeKey = `${cacheKey}_time_v1`; // v1 versioning
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTime = localStorage.getItem(cacheTimeKey);

        const now = Date.now();
        if (cachedData && cachedTime && (now - parseInt(cachedTime) < 5 * 60 * 1000)) {
            try {
                const parsed = JSON.parse(cachedData);
                if (parsed.v === 1) return parsed;
            } catch (e) {
                localStorage.removeItem(cacheKey);
                localStorage.removeItem(cacheTimeKey);
            }
        }

        const [hero, rows] = await Promise.all([
            api.getHeroContent({ signal: this._abortController.signal }),
            api.getHomeRows(0, { signal: this._abortController.signal })
        ]);
        
        const data = { v: 1, hero, rows: rows || [] };
        localStorage.setItem(cacheKey, JSON.stringify(data));
        localStorage.setItem(cacheTimeKey, now.toString());
        return data;
    }

    async _loadSmartHome() {
        const target = document.getElementById('smart-sections');
        if (!target) return;

        let data;
        try {
            data = await this._loadSmartHomeData();
        } catch (err) {
            if (err.name !== 'AbortError') {
                target.innerHTML = `<div class="empty-state"><p>Error loading home feed: ${escapeHtml(err.message)}</p></div>`;
            }
            return;
        }

        this.state.hero = data.hero ? this._normalizeMedia(data.hero) : null;
        this.state.rows = data.rows;
        this.rowsOffset = data.rows.length;

        if (this.state.hero) {
            const img = new Image();
            img.src = thumbUrl(this.state.hero.id);
        }
        if (this.state.rows.length > 0) {
            prefetchThumbnails(this.state.rows[0].items, 10);
        }

        if (this.state.hero) {
            this._renderHero(this.state.hero);
        }

        this._renderSidebar();

        const vSec = document.getElementById('home-videos-section');
        if (vSec) vSec.classList.remove('hidden');
        await this._loadVideos();

        if (!this.state.rows.length && this.state.videosList.length === 0) {
            this._renderEmptyState();
        }
    }

    _renderEmptyState() {
        const target = document.getElementById('smart-sections');
        const vSec = document.getElementById('home-videos-section');
        if (!target) return;

        target.innerHTML = `
            <div class="empty-state" style="margin-top: 40px;">
                <div class="empty-icon">📂</div>
                <h3>No media detected</h3>
                <p>We couldn't find any media in your library. Automatically scanning your folders in the background...</p>
                <div class="flex-center gap-md mt-lg">
                    <button class="btn btn-accent" id="home-rescan-btn" disabled>Scanning Library in Background...</button>
                    <button class="btn btn-ghost" id="home-refresh-btn">Refresh Page</button>
                </div>
            </div>
        `;
        if (vSec) vSec.classList.add('hidden');

        const refreshBtn = document.getElementById('home-refresh-btn');
        if (refreshBtn) refreshBtn.onclick = () => { window.appInstance.init().then(() => router.navigate('/')); };

        api.rescan().then(() => {
            toast('Library indexed automatically!', 'success');
            clearContentCaches();
            setTimeout(() => { window.appInstance.init().then(() => router.navigate('/')); }, 1500);
        }).catch(err => {
            const btn = document.getElementById('home-rescan-btn');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Retry Scan';
                btn.onclick = () => { window.appInstance.init().then(() => router.navigate('/')); };
            }
            toast(err.message, 'error');
        });
    }

    _renderSidebar() {
        const sidebarSections = document.getElementById('smart-sidebar-sections');
        if (!sidebarSections) return;
        
        sidebarSections.innerHTML = `
            <div class="sidebar-link active" data-id="all">
                <span>All Videos</span>
            </div>
        `;
        
        for (const row of this.state.rows) {
            const link = document.createElement('div');
            link.className = 'sidebar-link';
            link.dataset.id = row.title;
            link.innerHTML = `<span>${escapeHtml(row.title)}</span>`;
            
            link.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                this.state.filterContext = row.title;
                
                document.getElementById('grid-context-title').textContent = row.title;
                const sentinel = document.getElementById('home-videos-sentinel');
                if (sentinel) sentinel.style.display = 'none';
                
                this._renderFeed(row);
            });
            sidebarSections.appendChild(link);
        }
        
        const allLink = sidebarSections.querySelector('[data-id="all"]');
        if (allLink) {
            allLink.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
                allLink.classList.add('active');
                this.state.filterContext = 'all';
                
                document.getElementById('grid-context-title').textContent = 'All Videos';
                const sentinel = document.getElementById('home-videos-sentinel');
                if (sentinel) sentinel.style.display = 'block';
                
                this.state.videosPage = 1;
                this.state.videosList = [];
                this.state.hasMoreVideos = true;
                this._loadVideos();
            });
        }
    }

    _renderFeed(row) {
        const grid = document.getElementById('home-videos-grid');
        if (!grid) return;
        
        grid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        row.items.forEach((rawItem, idx) => {
            const item = this._normalizeMedia(rawItem);
            const card = document.createElement('div');
            card.className = 'home-card';
            card.dataset.id = item.id;
            card.style.willChange = 'transform';
            card.style.width = '100%';
            card.innerHTML = this._createCard(item, row.type);
            
            const list = row.items.map(i => this._normalizeMedia(i));
            this._attachCardEvents(card, item, list, idx);
            if (row.type === 'resume') {
                card.onclick = (e) => {
                    e.stopPropagation();
                    const resumePos = item.progress * item.duration;
                    player.play(list, idx, resumePos);
                };
            }
            fragment.appendChild(card);
        });
        grid.appendChild(fragment);
    }

    _renderHero(hero) {
        const heroDiv = document.getElementById('hero-banner');
        if (!heroDiv) return;

        const backdrop = heroDiv.querySelector('.hero-backdrop');
        if (backdrop && hero.id) {
            backdrop.style.backgroundImage = `url('${thumbUrl(hero.id)}')`;
        }

        heroDiv.querySelector('.hero-title').textContent = hero.title;
        heroDiv.querySelector('.hero-synopsis').textContent = hero.synopsis || '';
        heroDiv.querySelector('.hero-year').textContent = hero.year || '';
        heroDiv.querySelector('.hero-duration').textContent = this._formatDuration(hero.duration);

        const badgeType = heroDiv.querySelector('#hero-badge-type');
        if (badgeType) badgeType.textContent = 'Featured';

        const playBtn = heroDiv.querySelector('.hero-play-btn');
        if (playBtn) {
            playBtn.onclick = () => {
                player.play([{ id: hero.id, title: hero.title, duration_seconds: hero.duration }], 0);
            };
        }

        const mylistBtn = heroDiv.querySelector('.hero-mylist-btn');
        if (mylistBtn) {
            mylistBtn.onclick = async () => {
                try {
                    const playlists = await api.getPlaylists();
                    let mylist = playlists.find(p => p.title === "My List");
                    if (!mylist) mylist = await api.createPlaylist("My List", "My favorite movies and shows");
                    
                    const pData = await api.getPlaylist(mylist.id);
                    if (pData && pData.items && pData.items.some(i => i.id === hero.id)) {
                        toast('Already in My List', 'info');
                        mylistBtn.textContent = '✓ In My List';
                        return;
                    }

                    await api.addToPlaylist(mylist.id, hero.id);
                    toast('Added to My List', 'success');
                    mylistBtn.textContent = '✓ In My List';
                    clearContentCaches();
                } catch (e) {
                    toast(e.message || 'Could not add to My List', 'error');
                }
            };
        }

        const resumeDiv = heroDiv.querySelector('.hero-resume');
        const resumePosEl = heroDiv.querySelector('.hero-resume-position');
        if (hero.resume_position > 0 && resumeDiv && resumePosEl) {
            resumeDiv.classList.remove('hidden');
            resumeDiv.style.display = 'inline-block';
            resumePosEl.textContent = this._formatTime(hero.resume_position);
        } else if (resumeDiv) {
            resumeDiv.classList.add('hidden');
            resumeDiv.style.display = '';
        }

        heroDiv.classList.remove('hidden');
    }

    _attachCardEvents(card, item, list, idx) {
        card.addEventListener('click', () => {
            if (item.adult_only && !isAdultApproved()) {
                showAdultAccessDialog();
                return;
            }
            player.play(list, idx);
        });

        const playBtn = card.querySelector('.card-action-play');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                player.play([{ id: item.id, title: item.title, duration_seconds: item.duration }], 0);
            });
        }

        const saveBtn = card.querySelector('.card-action-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const ps = await api.getPlaylists();
                    let m = ps.find(p => p.title === 'My List');
                    if (!m) m = await api.createPlaylist('My List', 'Favorites');
                    
                    const pData = await api.getPlaylist(m.id);
                    if (pData && pData.items && pData.items.some(i => i.id === item.id)) {
                        toast('Already in My List', 'info');
                        return;
                    }

                    await api.addToPlaylist(m.id, item.id);
                    toast('Added to My List', 'success');
                } catch (err) {
                    toast(err.message, 'error');
                }
            });
        }

        const infoBtn = card.querySelector('.card-action-info');
        if (infoBtn) {
            infoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                location.hash = '#explorer?path=' + encodeURIComponent(item.path || '');
            });
        }
    }

    _createCard(item, rowType) {
        const progressHtml = (item.progress && rowType === 'resume')
            ? `<div class="card-progress"><div class="card-progress-bar" style="width: ${item.progress * 100}%"></div></div>`
            : '';

        const dur = item.duration ? this._formatDuration(item.duration) : '';

        return `
            <div class="card-poster" style="aspect-ratio: 16/9; position: relative;">
                <img src="${thumbUrl(item.id)}" alt="${escapeHtml(item.title)}" class="media-card-thumb" loading="lazy" style="opacity:0; transition: opacity 0.3s ease; width:100%; height:100%; object-fit:cover;" onload="this.style.opacity=1;" onerror="this.onerror=null; this.src='/static/placeholder.svg'; this.style.opacity=1;">
                ${progressHtml}
                ${dur ? `<span class="media-badge duration-badge">${dur}</span>` : ''}
                <div class="card-hover-info">
                    <button class="card-play-btn">▶</button>
                </div>
            </div>
            <div class="card-actions-row hidden">
                <button class="btn btn-xs btn-accent card-action-play">▶ Play</button>
                <button class="btn btn-xs btn-ghost card-action-save">+ List</button>
                <button class="btn btn-xs btn-ghost card-action-info">ℹ</button>
            </div>
            <div class="media-card-info" style="padding-top: 8px;">
                <h3 class="media-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
                ${item.year ? `<div class="media-meta"><span>${escapeHtml(String(item.year))}</span></div>` : ''}
            </div>
        `;
    }

    _setupHoverPreviews() {
        if (this._hoverHandler) {
            this.container.removeEventListener('mouseenter', this._hoverHandler, true);
        }

        const cleanupPreview = () => {
            this.previewVideo.pause();
            this.previewVideo.style.display = 'none';
            if (this._activePosterImg) {
                this._activePosterImg.style.opacity = '1';
                this._activePosterImg = null;
            }
            if (this.previewVideo.parentNode) {
                try { this.previewVideo.parentNode.removeChild(this.previewVideo); } catch(err){}
            }
        };

        this._hoverHandler = (e) => {
            const card = e.target.closest('.home-card');
            if (!card) return;

            if (this.hoverTimeout) clearTimeout(this.hoverTimeout);

            this.hoverTimeout = setTimeout(() => {
                cleanupPreview();

                const mediaId = card.dataset.id;
                const posterContainer = card.querySelector('.card-poster');
                this._activePosterImg = card.querySelector('img');
                if (!mediaId || !posterContainer) return;

                posterContainer.appendChild(this.previewVideo);
                
                const targetUrl = `/api/media/${mediaId}/preview`;
                if (!this.previewVideo.src.endsWith(targetUrl)) {
                    this.previewVideo.src = targetUrl;
                }
                
                this.previewVideo.style.display = 'block';
                if (this._activePosterImg) this._activePosterImg.style.opacity = '0.1';
                
                this.previewVideo.play().catch(() => {});
                
                const mouseLeaveHandler = () => {
                    cleanupPreview();
                };
                
                card.addEventListener('mouseleave', mouseLeaveHandler, { once: true });

            }, 500);

            card.addEventListener('mouseleave', () => {
                if (this.hoverTimeout) {
                    clearTimeout(this.hoverTimeout);
                    this.hoverTimeout = null;
                }
            }, { once: true });
        };
        this.container.addEventListener('mouseenter', this._hoverHandler, true);
    }

    _attachScrollListeners() {
        this._observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.state.videosLoading && this.state.hasMoreVideos && !this._abortController.signal.aborted) {
                this._loadVideos();
            }
        }, { rootMargin: '400px' });

        const sentinel = document.getElementById('home-videos-sentinel');
        if (sentinel) this._observer.observe(sentinel);
    }

    async _loadVideos() {
        if (this.state.videosLoading || !this.state.hasMoreVideos) return;
        this.state.videosLoading = true;

        const grid = document.getElementById('home-videos-grid');
        if (grid && this.state.videosPage === 1) {
            grid.innerHTML = `
                ${Array(10).fill().map(() => `
                    <div class="skeleton-card" style="width: 100%;">
                        <div class="skeleton-poster shimmer-bg" style="aspect-ratio: 16/9;"></div>
                        <div class="skeleton-title shimmer-bg"></div>
                    </div>
                `).join('')}
            `;
        }

        try {
            const res = await api.getLibrary({
                page: this.state.videosPage,
                per_page: 48,
                sort: 'created_at',
                order: 'desc'
            }, { signal: this._abortController.signal });

            const videos = res.items || [];
            if (this.state.videosPage === 1 && grid) grid.innerHTML = '';

            if (videos.length === 0) {
                this.state.hasMoreVideos = false;
                if (this.state.videosPage === 1 && grid) {
                    grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><p>No videos found.</p></div>';
                }
                this.state.videosLoading = false;
                return;
            }

            const startIndex = this.state.videosList.length;
            this.state.videosList.push(...videos.map(v => this._normalizeMedia(v)));

            const fragment = document.createDocumentFragment();
            videos.forEach((rawVideo, index) => {
                const video = this._normalizeMedia(rawVideo);
                const globalIndex = startIndex + index;
                const card = document.createElement('div');
                card.className = 'home-card';
                card.dataset.id = video.id;
                card.dataset.index = globalIndex;
                card.style.willChange = 'transform';
                card.style.width = '100%';
                card.style.margin = '0';
                card.innerHTML = this._createCard(video, 'default');

                this._attachCardEvents(card, video, this.state.videosList, globalIndex);
                fragment.appendChild(card);
            });

            grid.appendChild(fragment);

            if (videos.length < 48) {
                this.state.hasMoreVideos = false;
            } else {
                this.state.videosPage++;
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Failed to load flat videos grid", err);
                if (this.state.videosPage === 1 && grid) {
                    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>Error loading videos: ${escapeHtml(err.message)}</p></div>`;
                }
            }
        } finally {
            this.state.videosLoading = false;
        }
    }

    async _filterSearch(query) {
        const q = query.toLowerCase().trim();
        const target = document.getElementById('smart-sections');
        const hero = document.getElementById('hero-banner');
        const vSec = document.getElementById('home-videos-section');
        const gridTitle = document.getElementById('grid-context-title');
        const sentinel = document.getElementById('home-videos-sentinel');
        
        if (!target) return;

        if (!q) {
            if (hero) hero.style.display = 'block';
            if (vSec) vSec.style.display = 'block';
            this._renderSidebar();
            const allLink = document.querySelector('.sidebar-link[data-id="all"]');
            if (allLink) allLink.click();
            if (sentinel && this._observer) this._observer.observe(sentinel);
            return;
        }

        if (sentinel && this._observer) this._observer.unobserve(sentinel);
        if (hero) hero.style.display = 'none';
        if (vSec) vSec.style.display = 'block';
        if (gridTitle) gridTitle.textContent = `Search Results for "${q}"`;
        
        const grid = document.getElementById('home-videos-grid');
        const searchSentinel = document.getElementById('home-videos-sentinel');
        if (searchSentinel) searchSentinel.style.display = 'none';
        
        if (grid) {
            grid.innerHTML = `
                ${Array(8).fill().map(() => `
                    <div class="skeleton-card" style="width: 100%;">
                        <div class="skeleton-poster shimmer-bg" style="aspect-ratio: 16/9;"></div>
                        <div class="skeleton-title shimmer-bg"></div>
                    </div>
                `).join('')}
            `;
        }

        this._searchSeq++;
        const seq = this._searchSeq;
        
        try {
            const results = await api.getSearch(q);
            if (seq !== this._searchSeq) return;
            if (!results || results.length === 0) {
                if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>No results found for "${escapeHtml(q)}"</p></div>`;
                return;
            }

            if (grid) {
                grid.innerHTML = '';
                const fragment = document.createDocumentFragment();
                const normalizedResults = results.map(r => this._normalizeMedia(r));
                
                grid.innerHTML = normalizedResults.map(item => `
                    <div class="home-card" data-id="${item.id}" style="will-change: transform; width: 100%; margin: 0;">
                        ${this._createCard(item, 'default')}
                    </div>
                `).join('');

                grid.querySelectorAll('.home-card').forEach((card, idx) => {
                    const item = normalizedResults[idx];
                    this._attachCardEvents(card, item, normalizedResults, idx);
                });
            }
        } catch (err) {
            if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>Search error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    _formatDuration(seconds) {
        if (!seconds) return '';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours) return `${hours}h ${minutes}m`;
        if (minutes) return `${minutes}m`;
        return `${Math.floor(seconds)}s`;
    }

    _formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    destroy() {
        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
            this.hoverTimeout = null;
        }
        if (this._abortController) {
            this._abortController.abort();
        }
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        if (this.previewVideo) {
            this.previewVideo.pause();
            this.previewVideo.remove();
            this.previewVideo = null;
        }
        if (this._hoverHandler) {
            this.container.removeEventListener('mouseenter', this._hoverHandler, true);
            this._hoverHandler = null;
        }
        document.removeEventListener('keydown', this._globalKeydownHandler);
    }
}
