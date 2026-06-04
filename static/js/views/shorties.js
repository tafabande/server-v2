import { api, player } from '../app.js';
import { toast, isAdultApproved, showAdultAccessDialog } from '../utils.js';

export class ShortiesView {
    constructor(container) {
        this.container = container;
        this._videos = [];
        this._observer = null;
        this._isMuted = localStorage.getItem('shorties_muted') === 'true';
        this._activeVideoEl = null;
    }

    async render() {
        // Pause the global cinematic player if it's active
        if (player && player.video && !player.video.paused) {
            player.video.pause();
        }

        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg">
                <div>
                    <h1 class="page-title">Shorties</h1>
                    <p class="page-subtitle">Swipe or scroll vertical micro-entertainment feed</p>
                </div>
            </div>
            
            <div class="shorties-viewport">
                <div id="shorties-feed" class="shorties-container">
                    <div class="loading-state"><div class="spinner"></div> Tuning short feed...</div>
                </div>
            </div>
        `;

        await this._loadShorts();
    }

    async _loadShorts() {
        const feed = document.getElementById('shorties-feed');
        if (!feed) return;

        try {
            // 1. Fetch shorties via automatic sorting
            let res = await api.getVideosByType({ type: 'shorties', per_page: 50 });
            let items = res?.items || [];

            // 2. Fallback: If no short_form items, query normal list and filter by duration < 300s
            if (items.length === 0) {
                const allRes = await api.getLibrary({ per_page: 100 });
                const allItems = Array.isArray(allRes) ? allRes : (allRes?.items || []);
                items = allItems.filter(v => v.duration_seconds > 0 && v.duration_seconds < 300);
            }

            // Filter out adult content if not approved
            if (!isAdultApproved()) {
                items = items.filter(v => !v.adult_only);
            }

            this._videos = items;

            if (items.length === 0) {
                feed.innerHTML = `
                    <div class="empty-state" style="padding: 40px; text-align: center; color: var(--text-muted);">
                        <div class="empty-icon" style="font-size: 3rem; margin-bottom: 16px;">📱</div>
                        <h3>No vertical clips found</h3>
                        <p style="max-width: 320px; margin: 8px auto; font-size: 0.85rem;">
                            Drop portrait videos or short clips (under 90 seconds) into your media folders. 
                            The scanner will catalog them here automatically!
                        </p>
                    </div>
                `;
                return;
            }

            feed.innerHTML = items.map((v, idx) => this._renderShortyCard(v, idx)).join('');
            this._setupIntersectionObserver();
            this._bindEvents();

        } catch (err) {
            feed.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❌</div>
                    <p>Failed to load short videos: ${err.message}</p>
                </div>
            `;
        }
    }

    _renderShortyCard(v, idx) {
        const videoSrc = `/api/media/${v.id}/file`;
        const posterUrl = `/api/media/${v.id}/backdrop`;
        const activeMuteClass = this._isMuted ? 'active' : '';
        const muteIcon = this._isMuted ? '🔇' : '🔊';
        const favoriteIcon = v.is_favorite ? '❤️' : '🤍';
        const activeFavClass = v.is_favorite ? 'active' : '';

        return `
            <div class="shorty-card" id="shorty-card-${v.id}" data-id="${v.id}" data-index="${idx}">
                <div class="shorty-video-wrapper">
                    <video class="shorty-video" 
                           id="shorty-video-${v.id}" 
                           src="${videoSrc}"
                           poster="${posterUrl}"
                           loop 
                           playsinline 
                           preload="auto" 
                           ${this._isMuted ? 'muted' : ''}>
                    </video>
                    
                    <div class="shorty-play-feedback" id="feedback-${v.id}">
                        <span class="shorty-play-feedback-icon">▶</span>
                    </div>

                    <!-- Bottom Info Overlay -->
                    <div class="shorty-overlay-bottom">
                        <h4 class="shorty-title">${v.title}</h4>
                        <p class="shorty-desc">📁 ${v.category || 'Shorts'}</p>
                    </div>

                    <!-- Floating Action Buttons -->
                    <div class="shorty-overlay-right">
                        <div style="display: flex; flex-direction: column; align-items: center;">
                            <button class="shorty-action-btn fav-btn ${activeFavClass}" data-id="${v.id}">
                                ${favoriteIcon}
                            </button>
                            <span class="shorty-action-label">Like</span>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; align-items: center;">
                            <button class="shorty-action-btn mute-btn ${activeMuteClass}" data-id="${v.id}">
                                ${muteIcon}
                            </button>
                            <span class="shorty-action-label">Mute</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    _setupIntersectionObserver() {
        const options = {
            root: document.getElementById('shorties-feed'),
            threshold: 0.6 // Card must be 60% visible to play
        };

        this._observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                const video = card.querySelector('.shorty-video');
                if (!video) return;

                if (entry.isIntersecting) {
                    this._playVideo(video);
                } else {
                    this._pauseVideo(video);
                }
            });
        }, options);

        document.querySelectorAll('.shorty-card').forEach(card => {
            this._observer.observe(card);
        });
    }

    _playVideo(video) {
        if (this._activeVideoEl && this._activeVideoEl !== video) {
            this._pauseVideo(this._activeVideoEl);
        }

        this._activeVideoEl = video;
        video.muted = this._isMuted;

        video.play().catch(err => {
            console.log('Playback prevented or interrupted:', err.message);
        });
    }

    _pauseVideo(video) {
        try {
            video.pause();
            video.currentTime = 0;
        } catch (e) { }
    }

    _bindEvents() {
        const feed = document.getElementById('shorties-feed');
        if (!feed) return;

        feed.querySelectorAll('.shorty-card').forEach(card => {
            const mediaId = card.dataset.id;
            const video = card.querySelector('.shorty-video');
            const feedback = card.querySelector('.shorty-play-feedback');

            let lastTap = 0;

            card.querySelector('.shorty-video-wrapper')?.addEventListener('click', (e) => {
                if (e.target.closest('.shorty-overlay-right') || e.target.closest('.shorty-overlay-bottom')) {
                    return;
                }

                const now = Date.now();
                if (now - lastTap < 300) {
                    this._toggleFavorite(mediaId, card.querySelector('.fav-btn'));
                    lastTap = 0;
                } else {
                    lastTap = now;
                    setTimeout(() => {
                        if (lastTap !== 0) {
                            this._togglePlayPause(video, feedback);
                            lastTap = 0;
                        }
                    }, 280);
                }
            });
        });

        feed.addEventListener('click', (e) => {
            const favBtn = e.target.closest('.fav-btn');
            if (favBtn) {
                e.stopPropagation();
                this._toggleFavorite(favBtn.dataset.id, favBtn);
                return;
            }

            const muteBtn = e.target.closest('.mute-btn');
            if (muteBtn) {
                e.stopPropagation();
                this._toggleMute();
                return;
            }
        });

        this._keydownHandler = (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const activeCard = this._activeVideoEl?.closest('.shorty-card');
                if (!activeCard) return;

                const currentIndex = parseInt(activeCard.dataset.index);
                const nextIndex = e.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;

                const targetCard = feed.querySelector(`.shorty-card[data-index="${nextIndex}"]`);
                if (targetCard) {
                    targetCard.scrollIntoView({ behavior: 'smooth' });
                }
            } else if (e.key === ' ') {
                e.preventDefault();
                if (this._activeVideoEl) {
                    const card = this._activeVideoEl.closest('.shorty-card');
                    const feedback = card?.querySelector('.shorty-play-feedback');
                    this._togglePlayPause(this._activeVideoEl, feedback);
                }
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    }

    _togglePlayPause(video, feedback) {
        if (!video) return;

        if (video.paused) {
            video.play().catch(() => { });
            if (feedback) {
                const icon = feedback.querySelector('.shorty-play-feedback-icon');
                if (icon) icon.textContent = '▶';
                feedback.classList.remove('animate');
                void feedback.offsetWidth;
                feedback.classList.add('animate');
            }
        } else {
            video.pause();
            if (feedback) {
                const icon = feedback.querySelector('.shorty-play-feedback-icon');
                if (icon) icon.textContent = '⏸';
                feedback.classList.remove('animate');
                void feedback.offsetWidth;
                feedback.classList.add('animate');
            }
        }
    }

    async _toggleFavorite(mediaId, btn) {
        if (!btn) return;
        try {
            const res = await api.toggleFavorite(mediaId);
            const isFav = res.message.toLowerCase().includes('added');
            btn.classList.toggle('active', isFav);
            btn.innerHTML = isFav ? '❤️' : '🤍';
            toast(res.message, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    _toggleMute() {
        this._isMuted = !this._isMuted;
        localStorage.setItem('shorties_muted', this._isMuted ? 'true' : 'false');

        document.querySelectorAll('.shorty-video').forEach(video => {
            video.muted = this._isMuted;
        });

        document.querySelectorAll('.mute-btn').forEach(btn => {
            btn.classList.toggle('active', this._isMuted);
            btn.innerHTML = this._isMuted ? '🔇' : '🔊';
        });

        toast(this._isMuted ? 'Shorts Muted' : 'Shorts Unmuted', 'success');
    }

    destroy() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }

        if (this._observer) {
            this._observer.disconnect();
        }

        if (this._activeVideoEl) {
            this._pauseVideo(this._activeVideoEl);
            this._activeVideoEl = null;
        }

        document.querySelectorAll('.shorty-video').forEach(video => {
            try { video.pause(); } catch (e) { }
        });
    }
}
