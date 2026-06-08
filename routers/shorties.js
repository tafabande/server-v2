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
                <div class="flex gap-sm">
                    <button id="btn-shuffle-shorties" class="btn btn-ghost btn-sm" style="display: flex; align-items: center; gap: 6px;">
                        🔀 Shuffle
                    </button>
                    <button id="btn-delete-current-shorty" class="btn btn-danger btn-sm" style="display: flex; align-items: center; gap: 6px;">
                        🗑️ Delete
                    </button>
                </div>
            </div>
            
            <div class="shorties-viewport">
                <div id="shorties-feed" class="shorties-container">
                    <div class="loading-state"><div class="spinner"></div> Tuning short feed...</div>
                </div>
            </div>
        `;

        await this._loadShorts();

        const shuffleBtn = document.getElementById('btn-shuffle-shorties');
        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', () => {
                this._shuffleVideos();
            });
        }

        const deleteBtn = document.getElementById('btn-delete-current-shorty');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this._deleteCurrentShorty();
            });
        }
    }

    async _loadShorts() {
        const feed = document.getElementById('shorties-feed');
        if (!feed) return;

        try {
            // 1. Fetch shorties via automatic sorting
            let res = await api.getVideosByType({ type: 'shorties', per_page: 1000 });
            let items = res?.items || [];

            // 2. Fallback: If no short_form items, query normal list and filter by duration < 300s
            if (items.length === 0) {
                const allRes = await api.getLibrary({ per_page: 1000 });
                const allItems = Array.isArray(allRes) ? allRes : (allRes?.items || []);
                items = allItems.filter(v => v.duration_seconds > 0 && v.duration_seconds < 300);
            }

            // Filter out adult content if not approved or nsfw preference is off
            const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
            const nsfwEnabled = user.preferences?.nsfw === true;
            if (!isAdultApproved() || !nsfwEnabled) {
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

            this._shuffleArray(this._videos);

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

    _shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
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
                           data-src="${videoSrc}"
                           poster="${posterUrl}"
                           playsinline 
                           preload="none" 
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

                    <!-- Progress Bar -->
                    <div class="shorty-progress-bar">
                        <div class="shorty-progress-fill" style="width: 0%;"></div>
                    </div>
                </div>
            </div>
        `;
    }

    _setupIntersectionObserver() {
        if (this._observer) {
            this._observer.disconnect();
        }

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

        if (!video.src) {
            video.src = video.dataset.src;
            video.load();
        }

        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                console.log('Playback prevented or interrupted:', err.message);
                video.addEventListener('canplay', () => {
                    if (this._activeVideoEl === video) {
                        video.play().catch(e => console.log('Retry play failed:', e));
                    }
                }, { once: true });
            });
        }
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

            if (video) {
                video.addEventListener('ended', () => {
                    this._playNextShorty();
                });
                video.addEventListener('timeupdate', () => {
                    const progressFill = card.querySelector('.shorty-progress-fill');
                    if (progressFill && video.duration) {
                        const pct = (video.currentTime / video.duration) * 100;
                        progressFill.style.width = `${pct}%`;
                    }
                });
            }

            card.querySelector('.shorty-video-wrapper')?.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.shorty-overlay-right') || e.target.closest('.shorty-overlay-bottom') || e.target.closest('.shorty-progress-bar')) {
                    return;
                }

                const now = Date.now();
                if (now - lastTap < 300) {
                    this._handleDoubleTap('middle');
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

            const progressBar = card.querySelector('.shorty-progress-bar');
            if (progressBar && video) {
                progressBar.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const rect = progressBar.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const width = rect.width;
                    if (width > 0 && video.duration) {
                        const newTime = (clickX / width) * video.duration;
                        video.currentTime = newTime;
                    }
                });
            }
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
            const isFav = res.status === 'added';

            const v = this._videos.find(vid => vid.id == mediaId);
            if (v) v.is_favorite = isFav;

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

    _shuffleVideos() {
        this._shuffleArray(this._videos);
        const feed = document.getElementById('shorties-feed');
        if (feed) {
            feed.innerHTML = this._videos.map((v, idx) => this._renderShortyCard(v, idx)).join('');
            this._setupIntersectionObserver();
            this._bindEvents();
            feed.scrollTo({ top: 0, behavior: 'instant' });
        }
    }

    _playNextShorty() {
        const activeCard = this._activeVideoEl?.closest('.shorty-card');
        if (!activeCard) return;

        let nextIndex = parseInt(activeCard.dataset.index) + 1;

        // Loop back to start
        if (nextIndex >= this._videos.length) {
            nextIndex = 0;
        }

        const feed = document.getElementById('shorties-feed');
        const targetCard = feed?.querySelector(`.shorty-card[data-index="${nextIndex}"]`);
        if (targetCard) {
            targetCard.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // Update the double-tap to show heart
    _handleDoubleTap(zone) {
        if (zone === 'middle') {
            const card = this._activeVideoEl.closest('.shorty-card');
            this._toggleFavorite(card.dataset.id, card.querySelector('.fav-btn'));

            // Heart visual
            const heart = document.createElement('div');
            heart.innerHTML = '❤️';
            heart.className = 'heart-animation';
            card.appendChild(heart);
            setTimeout(() => heart.remove(), 600);
        }
    }

    async _deleteCurrentShorty() {
        if (!this._activeVideoEl) {
            toast('No shorty is currently playing.', 'warning');
            return;
        }
        const card = this._activeVideoEl.closest('.shorty-card');
        const mediaId = card?.dataset.id;
        if (!mediaId) {
            toast('Could not identify the current shorty for deletion.', 'error');
            return;
        }

        const confirmed = await confirm('Delete Shorty', 'Are you sure you want to permanently delete this shorty? This cannot be undone.');
        if (!confirmed) return;

        try {
            await api.deleteMedia(mediaId);
            toast('Shorty deleted successfully!', 'success');

            // Remove from local array and DOM
            this._videos = this._videos.filter(v => v.id != mediaId);
            card.remove();
            this._playNextShorty(); // Automatically play the next one
        } catch (err) {
            toast(`Failed to delete shorty: ${err.message}`, 'error');
        }
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
