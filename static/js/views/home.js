/**
 * MediaHub — Home View (Netflix-like Experience)
 * Shows a featured Hero spotlight banner, continue watching, trending,
 * my list, and categories with horizontal scroll rows and hover previews.
 */
import { api, player, router } from '../app.js';
import { toast, formatDuration, formatDate, thumbUrl, debounce, isAdultApproved, isNsfwEnabled, showAdultAccessDialog, escapeHtml, homeCacheKey, clearContentCaches, prefetchThumbnails } from '../utils.js';

export class HomeView {
    constructor(container) {
        this.container = container;
        this.rowsOffset = 0;
        this.loadingMore = false;
        this.hoverTimeout = null;
        this.previewVideo = null;

        // Videos pagination state
        this.videosPage = 1;
        this.videosLoading = false;
        this.hasMoreVideos = true;
        this.videosList = [];
    }

    async render() {
        this.rowsOffset = 0;
        this.loadingMore = false;
        this.videosPage = 1;
        this.videosLoading = false;
        this.hasMoreVideos = true;
        this.videosList = [];

        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg" style="position: relative; z-index: 10;">
                <div>
                    <h1 class="page-title">Home</h1>
                </div>
                <div class="search-bar" style="margin-bottom:0; position:relative; max-width: 320px;">
                    <input id="home-search" class="input" type="text" placeholder="Search..." autocomplete="off">
                    <div id="search-suggestions" class="search-suggestions"></div>
                </div>
            </div>
            
            <div id="request-banner-container"></div>
            
            <!-- Hero section -->
            <div id="hero-banner" class="hero mb-lg" style="display:none;">
                <div class="hero-backdrop"></div>
                <div class="hero-gradient"></div>
                <div class="hero-content">
                    <div class="hero-badges">
                        <span class="badge badge-accent" id="hero-badge-type">Featured</span>
                        <span class="badge badge-muted" id="hero-badge-codec">HD</span>
                    </div>
                    <h2 class="hero-title"></h2>
                    <p class="hero-synopsis"></p>
                    <div class="hero-meta">
                        <span class="hero-year"></span>
                        <span class="hero-duration"></span>
                    </div>
                    <div class="hero-buttons">
                        <button class="btn btn-accent hero-play-btn">▶ Play</button>
                        <button class="btn btn-ghost hero-mylist-btn">+ My List</button>
                    </div>
                    <div class="hero-resume" style="display:none;">
                        <span>Resume from <span class="hero-resume-position"></span></span>
                    </div>
                </div>
            </div>

            <!-- Smart Sections / Search results -->
            <div id="smart-sections">
                <div class="skeleton-row">
                    <div class="skeleton-row-title shimmer-bg"></div>
                    <div class="skeleton-row-items">
                        ${Array(4).fill().map(() => `
                            <div class="skeleton-row-card">
                                <div class="skeleton-poster shimmer-bg"></div>
                                <div class="skeleton-title shimmer-bg"></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <!-- Flat Videos Grid -->
            <div id="home-videos-section" class="mt-lg" style="display:none;">
                <h2 class="row-title mb-md">Videos</h2>
                <div id="home-videos-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;"></div>
                <div id="home-videos-sentinel" style="height:20px; margin-top:20px;"></div>
            </div>
        `;

        const searchInput = document.getElementById('home-search');
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                const q = e.target.value.trim();
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
        }

        await this._loadRequestAlerts();
        await this._loadSmartHome();
        this._attachScrollListeners();
        this._setupHoverPreviews();
    }

    async _showSuggestions(query) {
        const target = document.getElementById('search-suggestions');
        if (!target) return;

        try {
            const results = await api.getSearch(query);
            if (!results || results.length === 0) {
                target.classList.remove('active');
                return;
            }

            target.innerHTML = results.slice(0, 8).map(m => `
                <div class="suggestion-item" data-id="${m.id}">
                    <img src="${thumbUrl(m)}" class="suggestion-thumb shimmer-bg" loading="lazy" style="opacity:0; transition: opacity 0.3s ease;" onload="this.style.opacity=1; this.classList.remove('shimmer-bg');" onerror="this.onerror=null; this.src='/static/placeholder.svg'; this.style.opacity=1; this.classList.remove('shimmer-bg');">
                    <div class="suggestion-info">
                        <div class="suggestion-title">${escapeHtml(m.title)}</div>
                        <div class="suggestion-meta">${m.duration_seconds ? formatDuration(m.duration_seconds) + ' · ' : ''}${escapeHtml(m.video_codec || 'VIDEO')}</div>
                    </div>
                </div>
            `).join('');

            target.classList.add('active');

            target.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    const id = parseInt(item.dataset.id);
                    const media = results.find(m => m.id === id);
                    if (media) {
                        if (media.adult_only && !isAdultApproved()) {
                            showAdultAccessDialog();
                        } else {
                            player.play([media], 0);
                        }
                    }
                    target.classList.remove('active');
                });
            });

        } catch (err) { console.error('Search error:', err); }
    }

    async _loadRequestAlerts() {
        const bannerContainer = document.getElementById('request-banner-container');
        if (!bannerContainer) return;

        try {
            const requests = await api.getRequests();
            const sortedReqs = requests.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
            const latestReq = sortedReqs[0];

            if (latestReq) {
                const storageKey = `dismissed_req_${latestReq.id}`;
                const isDismissed = localStorage.getItem(storageKey);

                if (!isDismissed) {
                    let bannerHtml = '';
                    const title = latestReq.request_type === 'adult_elevation' ? '🔞 18+ Account Elevation' : `📁 Folder Access ("${latestReq.target_path?.split('/').pop() || ''}")`;

                    if (latestReq.status === 'pending') {
                        bannerHtml = `
                            <div class="surface rounded mb-md flex-between fade-in" id="req-banner-${latestReq.id}" style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 12px 16px; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%; position: relative; z-index: 5;">
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <span style="font-size: 1.5rem; line-height: 1;">⏳</span>
                                    <div>
                                        <strong style="color: var(--warning);">Access Request Pending Review</strong>
                                        <div class="text-muted text-xs" style="margin-top: 2px;">
                                            Your request for <strong>${escapeHtml(title)}</strong> is currently pending administrator review.
                                        </div>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <button class="btn btn-sm btn-ghost view-profile-btn">View Profile</button>
                                    <button class="dismiss-banner-btn" style="background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:1.5rem; line-height:1;">&times;</button>
                                </div>
                            </div>
                        `;
                    } else if (latestReq.status === 'denied') {
                        bannerHtml = `
                            <div class="surface rounded mb-md flex-between fade-in" id="req-banner-${latestReq.id}" style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 12px 16px; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%; position: relative; z-index: 5;">
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <span style="font-size: 1.5rem; line-height: 1;">❌</span>
                                    <div>
                                        <strong style="color: var(--error);">Access Request Denied</strong>
                                        <div class="text-muted text-xs" style="margin-top: 2px;">
                                            Your request for <strong>${escapeHtml(title)}</strong> was denied. Reason: <span style="font-style: italic;">"${escapeHtml(latestReq.admin_comment || 'No reason provided')}"</span>
                                        </div>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <button class="btn btn-sm btn-ghost view-profile-btn">View Profile</button>
                                    <button class="dismiss-banner-btn" style="background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:1.5rem; line-height:1;">&times;</button>
                                </div>
                            </div>
                        `;
                    } else if (latestReq.status === 'approved') {
                        bannerHtml = `
                            <div class="surface rounded mb-md flex-between fade-in" id="req-banner-${latestReq.id}" style="background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.2); padding: 12px 16px; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%; position: relative; z-index: 5;">
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <span style="font-size: 1.5rem; line-height: 1;">🎉</span>
                                    <div>
                                        <strong style="color: var(--success);">Access Request Approved!</strong>
                                        <div class="text-muted text-xs" style="margin-top: 2px;">
                                            Your request for <strong>${escapeHtml(title)}</strong> has been APPROVED! Enjoy full access.
                                        </div>
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

    async _loadSmartHome() {
        const target = document.getElementById('smart-sections');
        if (!target) return;

        const cacheKey = homeCacheKey();
        const cacheTimeKey = `${cacheKey}_time`;
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTime = localStorage.getItem(cacheTimeKey);

        let hero = null;
        let rows = [];

        const now = Date.now();
        if (cachedData && cachedTime && (now - parseInt(cachedTime) < 5 * 60 * 1000)) {
            try {
                const parsed = JSON.parse(cachedData);
                hero = parsed.hero;
                rows = parsed.rows || [];
                this.rowsOffset = rows.length;
                console.log('Loading home feed from cache');
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }

        if (!rows.length) {
            try {
                const [heroData, rowsData] = await Promise.all([
                    api.getHeroContent(),
                    api.getHomeRows(0)
                ]);
                hero = heroData;
                rows = rowsData || [];
                this.rowsOffset = rows.length;

                localStorage.setItem(cacheKey, JSON.stringify({ hero, rows }));
                localStorage.setItem(cacheTimeKey, now.toString());
            } catch (err) {
                console.error('Home load error:', err);
                target.innerHTML = `<div class="empty-state"><p>Error loading home feed: ${escapeHtml(err.message)}</p></div>`;
                return;
            }
        }

        // Prefetch Hero backdrop and top row items for instant visual feedback
        if (hero) {
            const img = new Image();
            img.src = thumbUrl(hero.id);
        }
        if (rows.length > 0) {
            prefetchThumbnails(rows[0].items, 10);
        }

        if (hero) {
            this._renderHero(hero);
        }

        target.innerHTML = '';
        if (rows.length > 0) {
            const rowsContainer = document.createElement('div');
            rowsContainer.className = 'rows-container';
            rowsContainer.id = 'rows-container';
            target.appendChild(rowsContainer);

            for (const row of rows) {
                rowsContainer.appendChild(this._createRow(row));
            }

            this._bindRowClickHandlers(rowsContainer, rows);
        }

        // Show flat videos section and load videos
        const vSec = document.getElementById('home-videos-section');
        if (vSec) vSec.style.display = 'block';
        await this._loadVideos();

        // Verify if completely empty after videos are loaded
        if (!rows.length && this.videosList.length === 0) {
            target.innerHTML = `
                <div class="empty-state" style="margin-top: 40px;">
                    <div class="empty-icon">📂</div>
                    <h3>No media detected</h3>
                    <p>We couldn't find any media in your library. Automatically scanning your folders in the background...</p>
                    <div class="flex-center gap-md mt-lg">
                        <button class="btn btn-accent" id="home-rescan-btn" disabled>Scanning Library in Background...</button>
                        <button class="btn btn-ghost" onclick="location.reload()">Refresh Page</button>
                    </div>
                </div>
            `;
            if (vSec) vSec.style.display = 'none';

            // Auto trigger scan
            api.rescan().then(() => {
                toast('Library indexed automatically!', 'success');
                clearContentCaches();
                setTimeout(() => location.reload(), 1500);
            }).catch(err => {
                const btn = document.getElementById('home-rescan-btn');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Retry Scan';
                    btn.onclick = () => location.reload();
                }
                toast(err.message, 'error');
            });
        }
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
        if (badgeType) {
            badgeType.textContent = 'Featured';
        }

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
                    if (!mylist) {
                        mylist = await api.createPlaylist("My List", "My favorite movies and shows");
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
            resumeDiv.style.display = 'inline-block';
            resumePosEl.textContent = this._formatTime(hero.resume_position);
        } else if (resumeDiv) {
            resumeDiv.style.display = 'none';
        }

        heroDiv.style.display = 'block';
    }

    _createRow(row) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'home-row';
        rowDiv.innerHTML = `
            <h2 class="row-title">${escapeHtml(row.title)}</h2>
            <div class="row-scroll">
                <div class="row-items">
                    ${row.items.map(item => this._createCard(item, row.type)).join('')}
                </div>
            </div>
        `;

        const scrollContainer = rowDiv.querySelector('.row-scroll');
        const leftBtn = document.createElement('button');
        leftBtn.className = 'scroll-btn left';
        leftBtn.innerHTML = '‹';
        leftBtn.onclick = () => scrollContainer.scrollBy({ left: -360, behavior: 'smooth' });

        const rightBtn = document.createElement('button');
        rightBtn.className = 'scroll-btn right';
        rightBtn.innerHTML = '›';
        rightBtn.onclick = () => scrollContainer.scrollBy({ left: 360, behavior: 'smooth' });

        rowDiv.appendChild(leftBtn);
        rowDiv.appendChild(rightBtn);

        return rowDiv;
    }

    _createCard(item, rowType) {
        const progressHtml = (item.progress && rowType === 'resume')
            ? `<div class="card-progress"><div class="card-progress-bar" style="width: ${item.progress * 100}%"></div></div>`
            : '';

        const duration = item.duration ? this._formatDuration(item.duration) : '';

        return `
            <div class="home-card" data-id="${item.id}" data-title="${escapeHtml(item.title)}" style="will-change: transform;">
                <div class="card-poster" style="aspect-ratio: 16/9;">
                    <img src="${thumbUrl(item.id)}" alt="${escapeHtml(item.title)}" class="shimmer-bg" loading="lazy" style="opacity:0; transition: opacity 0.3s ease;" onload="this.style.opacity=1; this.classList.remove('shimmer-bg');" onerror="this.onerror=null; this.src='/static/placeholder.svg'; this.style.opacity=1; this.classList.remove('shimmer-bg');">
                    ${progressHtml}
                    ${duration ? `<span class="media-badge duration-badge">${duration}</span>` : ''}
                    <div class="card-hover-info">
                        <button class="card-play-btn">▶</button>
                    </div>
                </div>
                <div class="media-card-info">
                    <h3 class="media-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
                    ${item.year ? `<div class="media-meta"><span>${escapeHtml(String(item.year))}</span></div>` : ''}
                </div>
            </div>
        `;
    }

    _bindRowClickHandlers(container, rows) {
        container.querySelectorAll('.home-row').forEach((rowEl, rowIdx) => {
            const rowData = rows.at(rowIdx);
            rowEl.querySelectorAll('.home-card').forEach((card, cardIdx) => {
                card.addEventListener('click', (e) => {
                    const id = parseInt(card.dataset.id);
                    const list = rowData.items.map(item => ({ id: item.id, title: item.title, duration_seconds: item.duration }));
                    const resumePos = (rowData.type === 'resume') ? (rowData.items.at(cardIdx).progress * rowData.items.at(cardIdx).duration) : 0;

                    player.play(list, cardIdx, resumePos);
                });
            });
        });
    }

    _setupHoverPreviews() {
        this.container.addEventListener('mouseenter', (e) => {
            const card = e.target.closest('.home-card, .media-card');
            if (!card) return;

            if (this.hoverTimeout) {
                clearTimeout(this.hoverTimeout);
            }
            this._cleanupPreview();

            this.hoverTimeout = setTimeout(() => {
                const mediaId = card.dataset.id || card.dataset.mediaId;
                const posterImg = card.querySelector('img');
                if (!mediaId) return;
                const previewUrl = `/api/media/${mediaId}/preview`;

                this.previewVideo = document.createElement('video');
                this.previewVideo.src = previewUrl;
                this.previewVideo.muted = true;
                this.previewVideo.autoplay = true;
                this.previewVideo.loop = true;
                this.previewVideo.className = 'card-preview-video';

                // Silently clean up if the file isn't previewable (e.g. HLS-only MKV)
                this.previewVideo.addEventListener('error', () => {
                    this._cleanupPreview(card, posterImg);
                });

                Object.assign(this.previewVideo.style, {
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    zIndex: '2',
                });

                const posterContainer = card.querySelector('.card-poster, .media-card-poster');
                if (posterContainer) {
                    posterContainer.style.position = 'relative';
                    posterContainer.appendChild(this.previewVideo);
                }
                if (posterImg) posterImg.style.opacity = '0.1';

                this.previewVideo.play().catch(() => console.log('Autoplay blocked'));

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

        // Global safeguard: remove any other playing previews
        document.querySelectorAll('.card-preview-video').forEach(video => {
            try {
                video.pause();
                video.src = '';
                video.load();
                video.remove();
            } catch (e) { }
        });

        if (posterImg) {
            posterImg.style.opacity = '1';
        } else {
            document.querySelectorAll('.home-card img, .media-card img').forEach(img => {
                img.style.opacity = '1';
            });
        }
    }

    _attachScrollListeners() {
        this._observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.videosLoading && this.hasMoreVideos) {
                this._loadVideos();
            }
        }, { rootMargin: '400px' });

        const sentinel = document.getElementById('home-videos-sentinel');
        if (sentinel) this._observer.observe(sentinel);
    }

    async _loadVideos() {
        if (this.videosLoading || !this.hasMoreVideos) return;
        this.videosLoading = true;

        const grid = document.getElementById('home-videos-grid');
        if (grid && this.videosPage === 1) {
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
                page: this.videosPage,
                per_page: 48,
                sort: 'created_at',
                order: 'desc'
            });

            const videos = res.items || [];
            if (this.videosPage === 1 && grid) {
                grid.innerHTML = '';
            }

            if (videos.length === 0) {
                this.hasMoreVideos = false;
                if (this.videosPage === 1 && grid) {
                    grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><p>No videos found.</p></div>';
                }
                this.videosLoading = false;
                return;
            }

            const startIndex = this.videosList.length;
            this.videosList.push(...videos);

            const fragment = document.createDocumentFragment();
            videos.forEach((video, index) => {
                const globalIndex = startIndex + index;
                const card = document.createElement('div');
                card.className = 'home-card';
                card.dataset.id = video.id;
                card.dataset.index = globalIndex;
                card.style.willChange = 'transform';
                card.style.width = '100%';
                card.style.margin = '0';

                const title = video.title || video.filename;
                const dur = video.duration_seconds ? this._formatDuration(video.duration_seconds) : '';
                const thumb = thumbUrl(video);

                card.innerHTML = `
                    <div class="card-poster" style="aspect-ratio: 16/9; position: relative;">
                        <img src="${thumb}" alt="${escapeHtml(title)}" class="media-card-thumb shimmer-bg" loading="lazy" style="opacity:0; transition: opacity 0.3s ease; width:100%; height:100%; object-fit:cover;" onload="this.style.opacity=1; this.classList.remove('shimmer-bg');" onerror="this.onerror=null; this.src='/static/placeholder.svg'; this.style.opacity=1; this.classList.remove('shimmer-bg');">
                        ${dur ? `<span class="media-badge duration-badge">${dur}</span>` : ''}
                        <div class="card-hover-info">
                            <button class="card-play-btn">▶</button>
                        </div>
                    </div>
                    <div class="media-card-info" style="padding-top: 8px;">
                        <h3 class="media-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                        ${video.year ? `<div class="media-meta"><span>${escapeHtml(String(video.year))}</span></div>` : ''}
                    </div>
                `;

                card.addEventListener('click', () => {
                    if (video.adult_only && !isAdultApproved()) {
                        showAdultAccessDialog();
                        return;
                    }
                    const list = this.videosList.map(item => ({ id: item.id, title: item.title || item.filename, duration_seconds: item.duration_seconds }));
                    player.play(list, globalIndex);
                });

                fragment.appendChild(card);
            });

            grid.appendChild(fragment);

            if (videos.length < 48) {
                this.hasMoreVideos = false;
            } else {
                this.videosPage++;
            }
        } catch (err) {
            console.error("Failed to load flat videos grid", err);
            if (this.videosPage === 1 && grid) {
                grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><p>Error loading videos: ${escapeHtml(err.message)}</p></div>`;
            }
        } finally {
            this.videosLoading = false;
        }
    }

    async _filterSearch(query) {
        const q = query.toLowerCase().trim();
        const target = document.getElementById('smart-sections');
        const hero = document.getElementById('hero-banner');
        const vSec = document.getElementById('home-videos-section');
        if (!target) return;

        if (!q) {
            if (hero) hero.style.display = 'block';
            if (vSec) vSec.style.display = 'block';
            await this._loadSmartHome();
            return;
        }

        if (hero) hero.style.display = 'none';
        if (vSec) vSec.style.display = 'none';
        target.innerHTML = `
            <div class="skeleton-grid">
                ${Array(8).fill().map(() => `
                    <div class="skeleton-card">
                        <div class="skeleton-poster shimmer-bg"></div>
                        <div class="skeleton-title shimmer-bg"></div>
                        <div class="skeleton-meta shimmer-bg"></div>
                    </div>
                `).join('')}
            </div>
        `;

        try {
            const results = await api.getSearch(q);
            if (!results || results.length === 0) {
                target.innerHTML = `<div class="empty-state"><p>No results found for "${escapeHtml(q)}"</p></div>`;
                return;
            }

            target.innerHTML = `
                <div style="margin-left: 0;">
                    <div class="section-title">Search Results for "${escapeHtml(q)}"</div>
                    <div class="yt-grid">
                        ${results.map((m) => `
                            <div class="media-card" data-id="${m.id}" data-title="${escapeHtml(m.title)}">
                                <div class="media-card-poster">
                                    <img class="media-card-thumb shimmer-bg" src="${thumbUrl(m)}" alt="${escapeHtml(m.title)}" loading="lazy" style="opacity:0; transition: opacity 0.3s ease;" onload="this.style.opacity=1; this.classList.remove('shimmer-bg');" onerror="this.onerror=null; this.src='/static/placeholder.svg'; this.style.opacity=1; this.classList.remove('shimmer-bg');">
                                    ${m.duration_seconds ? `<span class="media-badge duration-badge">${formatDuration(m.duration_seconds)}</span>` : ''}
                                    <div class="media-card-actions">
                                        <button class="btn-icon btn-play">▶</button>
                                    </div>
                                </div>
                                <div class="media-card-info">
                                    <h3 class="media-title">${escapeHtml(m.title)}</h3>
                                    <div class="media-meta">
                                        ${m.duration_seconds ? `<span>${formatDuration(m.duration_seconds)}</span><span class="dot">·</span>` : ''}
                                        <span>${escapeHtml(m.video_codec?.toUpperCase() || 'VIDEO')}</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            target.querySelectorAll('.media-card').forEach((card, idx) => {
                card.addEventListener('click', () => {
                    const m = results[idx];
                    if (m && m.adult_only && !isAdultApproved()) {
                        showAdultAccessDialog();
                        return;
                    }
                    const list = results.map(item => ({ id: item.id, title: item.title, duration_seconds: item.duration_seconds }));
                    player.play(list, idx);
                });
            });
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>Search error: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    _formatDuration(seconds) {
        if (!seconds) return '';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
    }

    _formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    destroy() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        if (this.previewVideo) {
            this.previewVideo.pause();
            this.previewVideo.remove();
            this.previewVideo = null;
        }
    }
}
