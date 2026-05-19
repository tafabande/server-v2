/**
 * MediaHub — Home View
 * Shows Continue Watching, Recently Added, and category rows.
 * Optimized with debounced search and efficient card binding.
 */
import { api, player, router } from '../app.js';
import { toast, formatDuration, formatDate, thumbUrl, debounce, isAdultApproved, showAdultAccessDialog } from '../utils.js';

export class HomeView {
    constructor(container) { 
        this.container = container; 
        this._groups = [];
        this._continueItems = [];
    }

    async render() {
        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg">
                <div>
                    <h1 class="page-title">Home</h1>
                    <p class="page-subtitle">Personalized for you</p>
                </div>
                <div class="search-bar" style="margin-bottom:0; position:relative;">
                    <input id="home-search" class="input" type="text" placeholder="Quick find... (Ctrl+K)" autocomplete="off">
                    <div id="search-suggestions" class="search-suggestions"></div>
                </div>
            </div>
            <div id="request-banner-container"></div>
            <div id="hero-banner" class="mb-lg" style="display:none"></div>
            
            <div id="smart-sections">
                <div class="loading-state"><div class="spinner"></div> Curating your feed...</div>
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

            // Close suggestions on blur (with delay to allow clicks)
            searchInput.addEventListener('blur', () => {
                setTimeout(() => document.getElementById('search-suggestions')?.classList.remove('active'), 200);
            });
        }

        await this._loadSmartHome();
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
                        <div class="suggestion-meta">${formatDuration(m.duration_seconds)} · ${m.video_codec || 'VIDEO'}</div>
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

    async _loadSmartHome() {
        // Render Request Alert Banner if applicable
        const bannerContainer = document.getElementById('request-banner-container');
        if (bannerContainer) {
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
                                <div class="surface rounded mb-md flex-between fade-in" id="req-banner-${latestReq.id}" style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 12px 16px; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%;">
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
                                <div class="surface rounded mb-md flex-between fade-in" id="req-banner-${latestReq.id}" style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 12px 16px; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%;">
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
                                <div class="surface rounded mb-md flex-between fade-in" id="req-banner-${latestReq.id}" style="background: rgba(34, 197, 94, 0.05); border: 1px solid rgba(34, 197, 94, 0.2); padding: 12px 16px; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%;">
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

        try {
            const data = await api.getSmartHome();
            console.log('Smart Home Data:', data); // Debugging
            
            const target = document.getElementById('smart-sections');
            if (!target) return;

            let html = '';

            // 1. Continue Watching
            if (data.continue_watching && data.continue_watching.length > 0) {
                this._continueItems = data.continue_watching;
                html += `
                    <div class="gallery-row">
                        <div class="section-title">Continue Watching</div>
                        <div id="continue-track" class="gallery-track">
                            ${data.continue_watching.map((item, idx) => 
                                this._renderCard(item.media, item.last_position_seconds, `continue-${idx}`)
                            ).join('')}
                        </div>
                    </div>
                `;
            }

            // 2. Trending
            if (data.trending && data.trending.length > 0) {
                html += `
                    <div class="gallery-row">
                        <div class="section-title">Trending Now <span class="badge badge-accent">Hot</span></div>
                        <div class="gallery-track">
                            ${data.trending.map((m, idx) => this._renderCard(m, null, `trending-${idx}`)).join('')}
                        </div>
                    </div>
                `;
            }

            // 3. Recently Added
            if (data.recently_added && data.recently_added.length > 0) {
                html += `
                    <div class="gallery-row">
                        <div class="section-title">Recently Added</div>
                        <div class="gallery-track">
                            ${data.recently_added.map((m, idx) => this._renderCard(m, null, `recent-${idx}`)).join('')}
                        </div>
                    </div>
                `;
            }

            // 4. Recommendations
            if (data.recommendations && data.recommendations.length > 0) {
                html += `
                    <div class="gallery-row">
                        <div class="section-title">You Might Like</div>
                        <div class="gallery-track">
                            ${data.recommendations.map((m, idx) => this._renderCard(m, null, `rec-${idx}`)).join('')}
                        </div>
                    </div>
                `;
            }

            if (!html) {
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
                        setTimeout(() => this._loadSmartHome(), 2000);
                    } catch (err) {
                        toast(err.message, 'error');
                        e.currentTarget.disabled = false;
                        e.currentTarget.textContent = 'Scan Library';
                    }
                });
                return;
            }

            target.innerHTML = html;

            // Bind hero
            const allMedia = [
                ...(data.trending || []),
                ...(data.recently_added || []),
                ...(data.recommendations || [])
            ];
            if (allMedia.length > 0) {
                this._renderHero(allMedia[0]);
            }

            // Bind interactions
            this._bindSectionClicks(target, data);

        } catch (err) {
            console.error('Home load error:', err);
            const target = document.getElementById('smart-sections');
            if (target) target.innerHTML = `<div class="empty-state"><p>Error loading home feed: ${err.message}</p></div>`;
        }
    }


    _bindSectionClicks(container, data) {
        container.querySelectorAll('.gallery-row').forEach(row => {
            const title = row.querySelector('.section-title').textContent.toLowerCase();
            let items = [];
            
            if (title.includes('continue')) items = data.continue_watching.map(i => i.media);
            else if (title.includes('trending')) items = data.trending;
            else if (title.includes('recent')) items = data.recently_added;
            else if (title.includes('like')) items = data.recommendations;

            row.querySelectorAll('.media-card').forEach(card => {
                const idx = parseInt(card.dataset.index.split('-')[1]);
                const media = items[idx];

                card.addEventListener('click', (e) => {
                    if (e.target.closest('.favorite-toggle-btn')) return;
                    if (media.adult_only && !isAdultApproved()) {
                        showAdultAccessDialog();
                        return;
                    }
                    player.play(items, idx);
                });

                card.querySelector('.favorite-toggle-btn')?.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        const res = await api.toggleFavorite(media.id);
                        media.is_favorite = !media.is_favorite;
                        e.currentTarget.classList.toggle('active', media.is_favorite);
                        e.currentTarget.innerHTML = media.is_favorite ? '❤️' : '🤍';
                        toast(res.message, 'success');
                    } catch (err) { toast(err.message, 'error'); }
                });
            });
        });
    }

    _renderCard(media, resumePos = null, indexStr = '') {
        const thumb = thumbUrl(media);
        const dur = formatDuration(media.duration_seconds);
        const resumeProgress = resumePos ? Math.round((resumePos / media.duration_seconds) * 100) : 0;

        return `
            <div class="media-card ${media.adult_only ? 'is-adult' : ''}" data-media-id="${media.id}" data-index="${indexStr}">
                <div class="media-card-poster">
                    <img class="media-card-thumb" src="${thumb}" alt="${media.title}" loading="lazy" onerror="this.src='/static/placeholder.svg'">
                    <div class="media-card-overlay">
                        <button class="play-action-btn">▶</button>
                    </div>
                    <div class="media-card-badges">
                        <button class="favorite-toggle-btn ${media.is_favorite ? 'active' : ''}" title="Toggle Favorite">
                            ${media.is_favorite ? '❤️' : '🤍'}
                        </button>
                        ${media.requires_pin ? '<span class="badge badge-warning">🔒</span>' : ''}
                    </div>
                    ${resumePos ? `<div class="card-resume-bar"><div class="fill" style="width:${resumeProgress}%"></div></div>` : ''}
                </div>
                <div class="media-card-body">
                    <div class="media-card-title" title="${media.title}">${media.title}</div>
                    <div class="media-card-meta">
                        <span>${dur}</span>
                        ${media.video_codec ? `<span class="dot">·</span><span>${media.video_codec.toUpperCase()}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
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
        target.innerHTML = '<div class="loading-state"><div class="spinner"></div> Searching...</div>';

        try {
            const results = await api.getSearch(q);
            if (!results || results.length === 0) {
                target.innerHTML = `<div class="empty-state"><p>No results found for "${query}"</p></div>`;
                return;
            }

            target.innerHTML = `
                <div class="gallery-row">
                    <div class="section-title">Search Results for "${query}"</div>
                    <div class="gallery-track results-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:20px; overflow:visible;">
                        ${results.map((m, idx) => this._renderCard(m, null, `search-${idx}`)).join('')}
                    </div>
                </div>
            `;

            target.querySelectorAll('.media-card').forEach(card => {
                const idx = parseInt(card.dataset.index.split('-')[1]);
                const media = results[idx];
                card.addEventListener('click', () => player.play(results, idx));
            });
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>Search error: ${err.message}</p></div>`;
        }
    }

    _renderHero(media) {
        const hero = document.getElementById('hero-banner');
        if (!hero || !media) return;

        hero.innerHTML = `
            <div class="hero-card">
                <div class="hero-bg">
                    <img src="${thumbUrl(media)}" alt="" onerror="this.src='/static/placeholder.svg'">
                    <div class="hero-overlay"></div>
                </div>
                <div class="hero-content">
                    <div class="hero-badges">
                        <span class="badge badge-accent">Featured</span>
                        <span class="badge badge-muted">${media.video_codec || 'HD'}</span>
                    </div>
                    <h2 class="hero-title">${media.title}</h2>
                    <p class="hero-meta">
                        ${formatDuration(media.duration_seconds)} 
                        <span class="dot">•</span> 
                        ${media.category || 'Movie'} 
                        <span class="dot">•</span> 
                        ${new Date(media.created_at).getFullYear()}
                    </p>
                    <div class="hero-actions">
                        <button class="btn btn-accent btn-play-hero">
                            <span class="icon">▶</span> Play Now
                        </button>
                        <button class="btn btn-ghost btn-more-info">
                            More Info
                        </button>
                    </div>
                </div>
            </div>
        `;

        hero.style.display = 'block';
        
        const playBtn = hero.querySelector('.btn-play-hero');
        if (playBtn) {
            playBtn.onclick = () => player.open(media);
        }

        const infoBtn = hero.querySelector('.btn-more-info');
        if (infoBtn) {
            infoBtn.onclick = () => {
                // Navigate to explorer at this path?
                const path = media.relative_path.split('/').slice(0, -1).join('/');
                router.navigate(`/explorer?path=${encodeURIComponent(path)}`);
            };
        }
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
