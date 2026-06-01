/**
 * MediaHub — Home View (Netflix-like Experience)
 * Shows a featured Hero spotlight banner, continue watching, trending,
 * my list, and categories with horizontal scroll rows and hover previews.
 */
import { api, player, router } from '../app.js';
import { toast, formatDuration, formatDate, thumbUrl, debounce, isAdultApproved, showAdultAccessDialog } from '../utils.js';

export class HomeView {
    constructor(container) {
        this.container = container;
        this.rowsOffset = 0;
        this.loadingMore = false;
        this.hoverTimeout = null;
        this.previewVideo = null;
    }

    async render() {
        this.rowsOffset = 0;
        this.loadingMore = false;

        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg" style="position: relative; z-index: 10;">
                <div>
                    <h1 class="page-title">Home</h1>
                    <p class="page-subtitle">Curated for your LAN</p>
                </div>
                <div class="search-bar" style="margin-bottom:0; position:relative;">
                    <input id="home-search" class="input" type="text" placeholder="Quick find... (Ctrl+K)" autocomplete="off">
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
                        ${Array(6).fill().map(() => `
                            <div class="skeleton-row-card">
                                <div class="skeleton-poster shimmer-bg"></div>
                                <div class="skeleton-title shimmer-bg"></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="skeleton-row">
                    <div class="skeleton-row-title shimmer-bg"></div>
                    <div class="skeleton-row-items">
                        ${Array(6).fill().map(() => `
                            <div class="skeleton-row-card">
                                <div class="skeleton-poster shimmer-bg"></div>
                                <div class="skeleton-title shimmer-bg"></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
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
                    <img src="${thumbUrl(m)}" class="suggestion-thumb" onerror="this.src='/static/placeholder.svg'">
                    <div class="suggestion-info">
                        <div class="suggestion-title">${m.title}</div>
                        <div class="suggestion-meta">${m.duration_seconds ? formatDuration(m.duration_seconds) + ' · ' : ''}${m.video_codec || 'VIDEO'}</div>
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
                            player.play(media);
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
                    const title = latestReq.request_type === 'adult_elevation' ? '🔞 18+ Account Elevation' : `📁 Folder Access ("${latestReq.target_path?.split('/').pop()}")`;
                    
                    if (latestReq.status === 'pending') {
                        bannerHtml = `
                            <div class="surface rounded mb-md flex-between fade-in" id="req-banner-${latestReq.id}" style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 12px 16px; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%; position: relative; z-index: 5;">
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <span style="font-size: 1.5rem; line-height: 1;">⏳</span>
                                    <div>
                                        <strong style="color: var(--warning);">Access Request Pending Review</strong>
                                        <div class="text-muted text-xs" style="margin-top: 2px;">
                                            Your request for <strong>${title}</strong> is currently pending administrator review.
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
                                            Your request for <strong>${title}</strong> was denied. Reason: <span style="font-style: italic;">"${latestReq.admin_comment || 'No reason provided'}"</span>
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
                                            Your request for <strong>${title}</strong> has been APPROVED! Enjoy full access.
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

        const cacheKey = 'mediahub_home_cache';
        const cacheTimeKey = 'mediahub_home_cache_time';
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTime = localStorage.getItem(cacheTimeKey);
        
        let hero = null;
        let rows = [];

        const now = Date.now();
        if (cachedData && cachedTime && (now - parseInt(cachedTime) < 5 * 60 * 1000)) {
            try {
                const parsed = JSON.parse(cachedData);
                hero = parsed.hero;
                rows = parsed.rows;
                console.log('Loading home feed from cache');
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }

        if (!rows.length) {
            try {
                hero = await api.getHeroContent();
                rows = await api.getHomeRows(0);
                this.rowsOffset = rows.length;

                localStorage.setItem(cacheKey, JSON.stringify({ hero, rows }));
                localStorage.setItem(cacheTimeKey, now.toString());
            } catch (err) {
                console.error('Home load error:', err);
                target.innerHTML = `<div class="empty-state"><p>Error loading home feed: ${err.message}</p></div>`;
                return;
            }
        }

        if (hero) {
            this._renderHero(hero);
        }

        if (!rows.length) {
            target.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📂</div>
                    <h3>No media detected</h3>
                    <p>We couldn't find any media in your library. Add files to your shared folder and trigger a scan.</p>
                    <div class="flex-center gap-md mt-lg">
                        <button class="btn btn-accent" id="home-rescan-btn">Scan Library</button>
                        <button class="btn btn-ghost" onclick="location.reload()">Refresh Page</button>
                    </div>
                </div>
            `;
            document.getElementById('home-rescan-btn')?.addEventListener('click', async (e) => {
                e.currentTarget.disabled = true;
                e.currentTarget.textContent = 'Scanning...';
                try {
                    await api.rescan();
                    toast('Scan triggered successfully!', 'success');
                    localStorage.removeItem(cacheKey);
                    setTimeout(() => this._loadSmartHome(), 2000);
                } catch (err) {
                    toast(err.message, 'error');
                    e.currentTarget.disabled = false;
                    e.currentTarget.textContent = 'Scan Library';
                }
            });
            return;
        }

        target.innerHTML = '';
        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'rows-container';
        rowsContainer.id = 'rows-container';
        target.appendChild(rowsContainer);

        for (const row of rows) {
            rowsContainer.appendChild(this._createRow(row));
        }

        this._bindRowClickHandlers(rowsContainer, rows);
    }

    _renderHero(hero) {
        const heroDiv = document.getElementById('hero-banner');
        if (!heroDiv) return;

        const backdrop = heroDiv.querySelector('.hero-backdrop');
        if (backdrop) {
            backdrop.style.backgroundImage = `url('${hero.backdrop}')`;
        }

        heroDiv.querySelector('.hero-title').textContent = hero.title;
        heroDiv.querySelector('.hero-synopsis').textContent = hero.synopsis || '';
        heroDiv.querySelector('.hero-year').textContent = hero.year || '';
        heroDiv.querySelector('.hero-duration').textContent = this._formatDuration(hero.duration);
        
        const badgeType = heroDiv.querySelector('#hero-badge-type');
        if (badgeType) {
            badgeType.textContent = hero.type === 'resume' ? 'Continue Watching' : 'New Release';
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
                    localStorage.removeItem('mediahub_home_cache');
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
            <h2 class="row-title">${row.title}</h2>
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

        return `
            <div class="home-card" data-id="${item.id}" data-title="${item.title}" style="will-change: transform;">
                <div class="card-poster">
                    <img src="/static/placeholder.svg" data-src="${item.poster}" alt="${item.title}" class="lazy-poster">
                    ${progressHtml}
                    <div class="card-hover-info">
                        <button class="card-play-btn">▶</button>
                        <span class="card-year">${item.year || ''}</span>
                    </div>
                </div>
                <div class="card-title">${item.title}</div>
            </div>
        `;
    }

    _bindRowClickHandlers(container, rows) {
        const lazyImages = container.querySelectorAll('.lazy-poster');
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy-poster');
                        observer.unobserve(img);
                    }
                });
            });
            lazyImages.forEach(img => observer.observe(img));
        } else {
            lazyImages.forEach(img => img.src = img.dataset.src);
        }

        container.querySelectorAll('.home-row').forEach((rowEl, rowIdx) => {
            const rowData = rows[rowIdx];
            rowEl.querySelectorAll('.home-card').forEach((card, cardIdx) => {
                card.addEventListener('click', (e) => {
                    const id = parseInt(card.dataset.id);
                    const list = rowData.items.map(item => ({ id: item.id, title: item.title, duration_seconds: item.duration }));
                    const resumePos = (rowData.type === 'resume') ? (rowData.items[cardIdx].progress * rowData.items[cardIdx].duration) : 0;
                    
                    player.play(list, cardIdx, resumePos);
                });
            });
        });
    }

    _setupHoverPreviews() {
        const smartSections = document.getElementById('smart-sections');
        if (!smartSections) return;

        smartSections.addEventListener('mouseenter', (e) => {
            const card = e.target.closest('.home-card');
            if (!card) return;

            this.hoverTimeout = setTimeout(() => {
                const mediaId = card.dataset.id;
                const posterImg = card.querySelector('img');
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

                const posterContainer = card.querySelector('.card-poster');
                posterContainer.style.position = 'relative';
                posterContainer.appendChild(this.previewVideo);
                posterImg.style.opacity = '0.1';

                this.previewVideo.play().catch(() => console.log('Autoplay blocked'));

                card.addEventListener('mouseleave', () => {
                    this._cleanupPreview(card, posterImg);
                }, { once: true });
            }, 500);

            card.addEventListener('mouseleave', () => {
                clearTimeout(this.hoverTimeout);
            }, { once: true });
        }, true);
    }

    _cleanupPreview(card, posterImg) {
        if (this.previewVideo) {
            this.previewVideo.pause();
            this.previewVideo.remove();
            this.previewVideo = null;
        }
        if (posterImg) {
            posterImg.style.opacity = '1';
        }
    }

    _attachScrollListeners() {
        const scrollHandler = debounce(async () => {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) {
                await this._loadMoreRows();
            }
        }, 150);
        window.addEventListener('scroll', scrollHandler);
        this._scrollHandler = scrollHandler;
    }

    async _loadMoreRows() {
        if (this.loadingMore) return;
        this.loadingMore = true;

        try {
            const moreRows = await api.getHomeRows(this.rowsOffset);
            if (moreRows && moreRows.length > 0) {
                const rowsContainer = document.getElementById('rows-container');
                if (rowsContainer) {
                    for (const row of moreRows) {
                        rowsContainer.appendChild(this._createRow(row));
                    }
                    this.rowsOffset += moreRows.length;
                    
                    const cacheKey = 'mediahub_home_cache';
                    const cached = JSON.parse(localStorage.getItem(cacheKey) || '{"rows":[]}');
                    const mergedRows = [...cached.rows, ...moreRows];
                    this._bindRowClickHandlers(rowsContainer, mergedRows);
                    
                    localStorage.setItem(cacheKey, JSON.stringify({ hero: cached.hero, rows: mergedRows }));
                }
            }
        } catch (e) {
            console.error("Failed to load more rows on infinite scroll", e);
        } finally {
            this.loadingMore = false;
        }
    }

    async _filterSearch(query) {
        const q = query.toLowerCase().trim();
        const target = document.getElementById('smart-sections');
        const hero = document.getElementById('hero-banner');
        if (!target) return;

        if (!q) {
            if (hero) hero.style.display = 'block';
            await this._loadSmartHome();
            return;
        }

        if (hero) hero.style.display = 'none';
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
                target.innerHTML = `<div class="empty-state"><p>No results found for "${query}"</p></div>`;
                return;
            }

            target.innerHTML = `
                <div class="gallery-row" style="margin-left: 0;">
                    <div class="section-title">Search Results for "${query}"</div>
                    <div class="gallery-track results-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:20px; overflow:visible; padding:0;">
                        ${results.map((m) => `
                            <div class="home-card" data-id="${m.id}" data-title="${m.title}" style="width: 100%;">
                                <div class="card-poster">
                                    <img src="${thumbUrl(m)}" alt="${m.title}" onerror="this.src='/static/placeholder.svg'">
                                    <div class="card-hover-info">
                                        <button class="card-play-btn">▶</button>
                                    </div>
                                </div>
                                <div class="card-title">${m.title}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            target.querySelectorAll('.home-card').forEach((card, idx) => {
                card.addEventListener('click', () => {
                    const list = results.map(item => ({ id: item.id, title: item.title, duration_seconds: item.duration_seconds }));
                    player.play(list, idx);
                });
            });
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>Search error: ${err.message}</p></div>`;
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
        if (this._scrollHandler) {
            window.removeEventListener('scroll', this._scrollHandler);
        }
        if (this.previewVideo) {
            this.previewVideo.pause();
            this.previewVideo.remove();
            this.previewVideo = null;
        }
    }
}
