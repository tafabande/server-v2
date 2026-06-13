import { api, player } from '../app.js';
import { toast, isAdultApproved, isNsfwEnabled, showAdultAccessDialog, confirm, showModal, escapeHtml } from '../utils.js';

export class ShortiesView {
    constructor(container) {
        this.container = container;
        this._videos = [];
        this._allVideos = [];
        this._observer = null;
        this._isMuted = localStorage.getItem('shorties_muted') === 'true';
        this._activeVideoEl = null;
        this._focusTimeout = null;
        this._hasDelegatedFeedEvents = false;
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
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button id="btn-shuffle-shorties" class="btn btn-secondary btn-sm" style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                        🔀 Shuffle
                    </button>
                    <button id="btn-delete-current-shorty" class="btn btn-danger btn-sm" style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
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

            // Ensure video previews/trailers are not displayed as separate videos in the Shorties feed
            items = items.filter(v => {
                const title = (v.title || v.filename || '').toLowerCase();
                return !title.includes('preview') && !title.includes('trailer');
            });

            this._allVideos = items;

            // Enforce NSFW toggle on Shorties
            const nsfwOn = isNsfwEnabled();
            const adultApproved = isAdultApproved();
            this._allVideos = this._allVideos.filter(v => {
                if (v.adult_only) return nsfwOn && adultApproved;
                return !nsfwOn; // Show safe only when SFW is on
            });

            if (this._allVideos.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'empty-state';
                emptyDiv.style.cssText = 'padding: 40px; text-align: center; color: var(--text-muted);';
                emptyDiv.innerHTML = `
                    <div class="empty-icon" style="font-size: 3rem; margin-bottom: 16px;">📱</div>
                    <h3>Hapana chinhu pano! Doko mo nai yo.</h3>
                    <p style="max-width: 320px; margin: 8px auto; font-size: 0.85rem;">
                        Drop portrait videos or short clips (under 90 seconds) into your media folders. 
                        The scanner will catalog them here automatically!
                    </p>
                `;
                feed.replaceChildren(emptyDiv);
                return;
            }

            this._shuffleArray(this._allVideos);

            // Limit first render to 50 items
            this._videos = this._allVideos.slice(0, 50);

            const fragment = document.createDocumentFragment();
            this._videos.forEach((v, idx) => {
                const cardEl = document.createElement('div');
                cardEl.className = 'shorty-card';
                cardEl.id = `shorty-card-${v.id}`;
                cardEl.dataset.id = v.id;
                cardEl.dataset.index = idx;
                cardEl.innerHTML = this._renderShortyCardInner(v, idx);
                fragment.appendChild(cardEl);
            });

            feed.replaceChildren(fragment);

            this._setupIntersectionObserver();
            this._bindEvents();
            this._setupFocusMode();

        } catch (err) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'empty-state';
            errorDiv.innerHTML = `
                <div class="empty-icon">❌</div>
                <p>Failed to load short videos: ${err.message}</p>
            `;
            feed.replaceChildren(errorDiv);
        }
    }

    _shuffleArray(array) {
        // Weighted random sort based on likes_count to play highly liked videos more frequently
        array.sort((a, b) => {
            const weightA = Math.random() * (1 + (a.likes_count || 0) * 2);
            const weightB = Math.random() * (1 + (b.likes_count || 0) * 2);
            return weightB - weightA;
        });
    }

    _isAdmin() {
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        return user.role === 'admin' || user.role === 'super-admin';
    }

    _renderShortyCardInner(v, idx) {
        const videoSrc = `/api/media/${v.id}/file`;
        const posterUrl = `/api/media/${v.id}/backdrop`;
        const activeMuteClass = this._isMuted ? 'active' : '';
        const muteIcon = this._isMuted ? '<i class="v-icon icon-mute"></i>' : '<i class="v-icon icon-volume"></i>';
        const favoriteIcon = '<i class="v-icon icon-favorite"></i>';
        const activeFavClass = v.is_favorite ? 'active' : '';

        let deleteBtnHtml = '';
        if (this._isAdmin()) {
            deleteBtnHtml = `
                <div class="shorty-action-group" style="margin-top: 12px;">
                    <button class="shorty-action-btn delete-btn" data-id="${v.id}">
                        <i class="v-icon icon-delete"></i>
                    </button>
                    <span class="shorty-action-label">Delete</span>
                </div>
            `;
        }

        return `
            <div class="shorty-video-wrapper">
                <video class="shorty-video" 
                       id="shorty-video-${v.id}" 
                       data-src="${videoSrc}"
                       poster="${posterUrl}"
                       playsinline 
                       webkit-playsinline
                       preload="none" 
                       ${this._isMuted ? 'muted' : ''}>
                </video>
                
                <div class="shorty-play-feedback" id="feedback-${v.id}">
                    <span class="shorty-play-feedback-icon">▶</span>
                </div>

                <div class="shorty-speed-indicator">
                    <span>⚡ 2x Speed</span>
                </div>

                <!-- Bottom Info Overlay -->
                <div class="shorty-overlay-bottom">
                    <h4 class="shorty-title">${v.title}</h4>
                    <p class="shorty-desc">📁 ${v.category || 'Shorts'}</p>
                </div>

                <!-- Floating Action Buttons -->
                <div class="shorty-overlay-right">
                    <div class="shorty-action-group">
                        <button class="shorty-action-btn fav-btn ${activeFavClass}" data-id="${v.id}">
                            ${favoriteIcon}
                        </button>
                        <span class="shorty-action-label like-count-label" data-id="${v.id}">${v.likes_count > 0 ? v.likes_count : 'Like'}</span>
                    </div>
                    
                    <div class="shorty-action-group">
                        <button class="shorty-action-btn save-btn" data-id="${v.id}">
                            <i class="v-icon icon-playlist">➕</i>
                        </button>
                        <span class="shorty-action-label">Save</span>
                    </div>

                    <div class="shorty-action-group">
                        <button class="shorty-action-btn mute-btn ${activeMuteClass}" data-id="${v.id}">
                            ${muteIcon}
                        </button>
                        <span class="shorty-action-label">Mute</span>
                    </div>
                    ${deleteBtnHtml}
                </div>

                <!-- Progress Bar -->
                <div class="shorty-progress-bar">
                    <div class="shorty-progress-fill"></div>
                </div>
            </div>
        `;
    }

    _renderMoreShorties(count = 50) {
        const feed = document.getElementById('shorties-feed');
        if (!feed || !this._allVideos || this._allVideos.length === 0) return;

        const currentLength = this._videos.length;
        if (currentLength >= this._allVideos.length) return; // No more to render

        const nextBatch = this._allVideos.slice(currentLength, currentLength + count);
        this._videos = this._videos.concat(nextBatch);

        const fragment = document.createDocumentFragment();
        nextBatch.forEach((v, idx) => {
            const globalIdx = currentLength + idx;
            const cardEl = document.createElement('div');
            cardEl.className = 'shorty-card';
            cardEl.id = `shorty-card-${v.id}`;
            cardEl.dataset.id = v.id;
            cardEl.dataset.index = globalIdx;
            cardEl.innerHTML = this._renderShortyCardInner(v, globalIdx);
            fragment.appendChild(cardEl);

            if (this._observer) {
                this._observer.observe(cardEl);
            }
            if (this._virtualizationObserver) {
                this._virtualizationObserver.observe(cardEl);
            }
            this._bindCardEvents(cardEl);
        });

        feed.appendChild(fragment);
    }

    _setupIntersectionObserver() {
        if (this._observer) {
            this._observer.disconnect();
        }
        if (this._virtualizationObserver) {
            this._virtualizationObserver.disconnect();
        }

        const options = {
            root: document.getElementById('shorties-feed'),
            threshold: 0.6 // Card must be 60% visible to play
        };

        this._observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                const video = card.querySelector('.shorty-video');

                if (entry.isIntersecting) {
                    if (video) this._playVideo(video);

                    // Pre-fetch/render next 50 items when user reaches 40th card
                    const index = parseInt(card.dataset.index);
                    if (index >= this._videos.length - 10) {
                        this._renderMoreShorties(50);
                    }
                } else {
                    if (video) this._pauseVideo(video);
                }
            });
        }, options);

        const virtOptions = {
            root: document.getElementById('shorties-feed'),
            rootMargin: '3000px 0px',
            threshold: 0
        };

        this._virtualizationObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                
                if (entry.isIntersecting) {
                    // Re-render if empty
                    if (!card.innerHTML.trim()) {
                        const globalIdx = parseInt(card.dataset.index);
                        const v = this._allVideos[globalIdx];
                        if (v) {
                            card.innerHTML = this._renderShortyCardInner(v, globalIdx);
                            this._bindCardEvents(card);
                            
                            // Check if it should be playing right now (in case it skipped the playback observer)
                            const rect = card.getBoundingClientRect();
                            const feedRect = document.getElementById('shorties-feed').getBoundingClientRect();
                            const visibleRatio = (Math.min(rect.bottom, feedRect.bottom) - Math.max(rect.top, feedRect.top)) / rect.height;
                            
                            if (visibleRatio >= 0.6) {
                                const newVideo = card.querySelector('.shorty-video');
                                if (newVideo) this._playVideo(newVideo);
                            }
                        }
                    }
                } else {
                    // Empty DOM to save memory, but explicitly lock height first
                    const video = card.querySelector('.shorty-video');
                    if (video) this._pauseVideo(video);
                    
                    if (card.offsetHeight > 0 && !card.style.height) {
                        card.style.height = `${card.offsetHeight}px`;
                    }
                    card.innerHTML = '';
                }
            });
        }, virtOptions);

        document.querySelectorAll('.shorty-card').forEach(card => {
            this._observer.observe(card);
            this._virtualizationObserver.observe(card);
        });
    }

    _playVideo(video) {
        if (this._activeVideoEl && this._activeVideoEl !== video) {
            this._pauseVideo(this._activeVideoEl);
        }

        this._activeVideoEl = video;
        
        if (this._activeVideoEl === video) {
            video.muted = this._isMuted;

            if (!video.src) {
                video.src = video.dataset.src;
                video.load();
            }

            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    if (this._activeVideoEl === video) {
                        this._resetFocusTimeout?.();
                    } else {
                        video.pause();
                    }
                }).catch(err => {
                    console.log('Playback prevented or interrupted:', err.message);
                    video.addEventListener('canplay', () => {
                        if (this._activeVideoEl === video) {
                            video.play().then(() => {
                                if (this._activeVideoEl === video) {
                                    this._resetFocusTimeout?.();
                                } else {
                                    video.pause();
                                }
                            }).catch(e => console.log('Retry play failed:', e));
                        }
                    }, { once: true });
                });
            }
        }
    }

    _pauseVideo(video) {
        try {
            video.pause();
            video.removeAttribute('src');
            video.load();
            if (this._focusTimeout) {
                clearTimeout(this._focusTimeout);
            }
            const feed = document.getElementById('shorties-feed');
            if (feed) feed.classList.remove('focus-mode');
        } catch (e) { }
    }

    _showSpeedIndicator(card, show) {
        const ind = card.querySelector('.shorty-speed-indicator');
        if (ind) ind.style.opacity = show ? '1' : '0';
    }

    _bindCardEvents(card) {
        const video = card.querySelector('.shorty-video');
        const feedback = card.querySelector('.shorty-play-feedback');

        let lastTap = 0;
        let longPressTimer = null;
        let isLongPress = false;
        let tapTimer = null;
        let lastTapX = 0;
        let lastTapY = 0;

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

        const wrapper = card.querySelector('.shorty-video-wrapper');
        wrapper?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        wrapper?.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.shorty-overlay-right') || e.target.closest('.shorty-overlay-bottom') || e.target.closest('.shorty-progress-bar')) {
                return;
            }

            if (e.pointerType === 'touch') {
                e.target.setPointerCapture(e.pointerId);
            }
            lastTapX = e.clientX;
            lastTapY = e.clientY;

            isLongPress = false;
            clearTimeout(longPressTimer);

            longPressTimer = setTimeout(() => {
                isLongPress = true;
                if (video && !video.paused) {
                    video.playbackRate = 2.0;
                    this._showSpeedIndicator(card, true);
                }
            }, 500);
        });

        const handlePointerEnd = (e) => {
            clearTimeout(longPressTimer);

            if (isLongPress) {
                if (video) {
                    video.playbackRate = 1.0;
                    this._showSpeedIndicator(card, false);
                }
                isLongPress = false;
                return;
            }

            const now = Date.now();
            if (now - lastTap < 300) {
                clearTimeout(tapTimer);
                lastTap = 0;
                this._handleDoubleTap('middle', lastTapX, lastTapY);
            } else {
                lastTap = now;
                tapTimer = setTimeout(() => {
                    if (lastTap !== 0) {
                        this._togglePlayPause(video, feedback);
                        lastTap = 0;
                    }
                }, 300);
            }
        };

        wrapper?.addEventListener('pointerup', handlePointerEnd);
        wrapper?.addEventListener('pointercancel', handlePointerEnd);
        wrapper?.addEventListener('pointerleave', (e) => {
            if (isLongPress) {
                handlePointerEnd(e);
            } else {
                clearTimeout(longPressTimer);
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
    }

    _bindEvents() {
        const feed = document.getElementById('shorties-feed');
        if (!feed) return;

        feed.querySelectorAll('.shorty-card').forEach(card => {
            this._bindCardEvents(card);
        });

        if (!this._hasDelegatedFeedEvents) {
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

                const deleteBtn = e.target.closest('.delete-btn');
                if (deleteBtn) {
                    e.stopPropagation();
                    this._deleteShortyById(deleteBtn.dataset.id);
                    return;
                }
            });
            this._hasDelegatedFeedEvents = true;
        }

        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }

        this._keydownHandler = (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const activeCard = this._activeVideoEl?.closest('.shorty-card');
                if (!activeCard) return;

                const currentIndex = parseInt(activeCard.dataset.index);
                const nextIndex = e.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;

                let targetCard = feed.querySelector(`.shorty-card[data-index="${nextIndex}"]`);
                if (!targetCard && nextIndex < this._allVideos.length) {
                    this._renderMoreShorties(50);
                    targetCard = feed.querySelector(`.shorty-card[data-index="${nextIndex}"]`);
                }

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

    _setupFocusMode() {
        const feed = document.getElementById('shorties-feed');
        if (!feed) return;

        const clearFocusMode = () => {
            if (feed.classList.contains('focus-mode')) {
                feed.classList.remove('focus-mode');
            }
            this._resetFocusTimeout();
        };

        feed.addEventListener('scroll', clearFocusMode, { passive: true });
        feed.addEventListener('mousemove', clearFocusMode, { passive: true });
        feed.addEventListener('pointerdown', clearFocusMode, { passive: true });

        if (this._focusKeydownHandler) {
            document.removeEventListener('keydown', this._focusKeydownHandler);
        }
        this._focusKeydownHandler = (e) => {
            clearFocusMode();
        };
        document.addEventListener('keydown', this._focusKeydownHandler);

        this._resetFocusTimeout = () => {
            if (this._focusTimeout) clearTimeout(this._focusTimeout);
            if (this._activeVideoEl && !this._activeVideoEl.paused) {
                this._focusTimeout = setTimeout(() => {
                    if (this._activeVideoEl && !this._activeVideoEl.paused) {
                        feed.classList.add('focus-mode');
                    }
                }, 2000);
            }
        };

        this._resetFocusTimeout();
    }

    _togglePlayPause(video, feedback) {
        if (!video) return;

        const feed = document.getElementById('shorties-feed');

        if (video.paused) {
            video.play().catch(() => { });
            this._resetFocusTimeout?.();
            if (feedback) {
                const icon = feedback.querySelector('.shorty-play-feedback-icon');
                if (icon) icon.textContent = '▶';
                feedback.classList.remove('animate');
                void feedback.offsetWidth;
                feedback.classList.add('animate');
            }
        } else {
            video.pause();
            if (this._focusTimeout) clearTimeout(this._focusTimeout);
            if (feed) feed.classList.remove('focus-mode');
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

            const v = this._allVideos.find(vid => vid.id == mediaId);
            if (v) v.is_favorite = isFav;

            btn.classList.toggle('active', isFav);
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
            btn.innerHTML = this._isMuted ? '<i class="v-icon icon-mute"></i>' : '<i class="v-icon icon-volume"></i>';
        });

        toast(this._isMuted ? 'Shorts Muted' : 'Shorts Unmuted', 'success');
    }

    _shuffleVideos() {
        this._shuffleArray(this._allVideos);
        this._videos = this._allVideos.slice(0, 50);
        const feed = document.getElementById('shorties-feed');
        if (feed) {
            const fragment = document.createDocumentFragment();
            this._videos.forEach((v, idx) => {
                const cardEl = document.createElement('div');
                cardEl.className = 'shorty-card';
                cardEl.id = `shorty-card-${v.id}`;
                cardEl.dataset.id = v.id;
                cardEl.dataset.index = idx;
                cardEl.innerHTML = this._renderShortyCardInner(v, idx);
                fragment.appendChild(cardEl);
            });
            feed.replaceChildren(fragment);

            this._setupIntersectionObserver();
            this._bindEvents();
            this._setupFocusMode();
            feed.scrollTo({ top: 0, behavior: 'instant' });
        }
    }

    _playNextShorty() {
        const activeCard = this._activeVideoEl?.closest('.shorty-card');
        if (!activeCard) return;

        let nextIndex = parseInt(activeCard.dataset.index) + 1;

        if (nextIndex >= this._allVideos.length) {
            nextIndex = 0;
        }

        const feed = document.getElementById('shorties-feed');
        let targetCard = feed?.querySelector(`.shorty-card[data-index="${nextIndex}"]`);

        if (!targetCard && nextIndex < this._allVideos.length) {
            this._renderMoreShorties(50);
            targetCard = feed?.querySelector(`.shorty-card[data-index="${nextIndex}"]`);
        }

        if (targetCard) {
            targetCard.scrollIntoView({ behavior: 'smooth' });
        }
    }

    async _handleDoubleTap(zone, x, y) {
        if (zone === 'middle') {
            const card = this._activeVideoEl.closest('.shorty-card');
            if (!card) return;

            const mediaId = card.dataset.id;

            // Spatially aware floating heart animation
            const heart = document.createElement('div');
            heart.innerHTML = '❤️';
            heart.className = 'floating-heart';

            const rect = card.getBoundingClientRect();
            const relX = x ? (x - rect.left) : (rect.width / 2);
            const relY = y ? (y - rect.top) : (rect.height / 2);

            heart.style.left = `${relX}px`;
            heart.style.top = `${relY}px`;
            card.appendChild(heart);
            setTimeout(() => heart.remove(), 1000);

            // Increment likes dynamically in UI and ensure Favorite is active
            const v = this._allVideos.find(vid => vid.id == mediaId);
            if (v) {
                v.is_favorite = true;
                v.likes_count = (v.likes_count || 0) + 1;

                const favBtn = card.querySelector('.fav-btn');
                if (favBtn && !favBtn.classList.contains('active')) {
                    favBtn.classList.add('active');
                }

                const label = card.querySelector('.like-count-label');
                if (label) label.textContent = v.likes_count;
            }

            // Call backend API to add like and ensure favorited permanently
            try {
                if (typeof api.likeMedia === 'function') {
                    await api.likeMedia(mediaId);
                } else {
                    await api._fetch(`/media/${mediaId}/like`, { method: 'POST' });
                }
            } catch (e) {
                console.error("Failed to add like", e);
            }
        }
    }

    async _showPlaylistDialog(mediaId) {
        let playlists = [];
        try {
            const res = await api.getPlaylists();
            playlists = Array.isArray(res) ? res : (res?.items || []);
        } catch (e) {
            toast('Failed to load playlists', 'error');
            return;
        }

        let dialog = document.getElementById('shorty-playlist-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'shorty-playlist-dialog';
            dialog.className = 'glass-modal';
            dialog.style.maxWidth = '400px';
            dialog.style.padding = '0';
            dialog.style.border = 'none';
            dialog.style.background = 'transparent';
            document.body.appendChild(dialog);
        }

        const listHtml = playlists.length > 0 ? playlists.map(p => `
            <div class="playlist-option" data-id="${p.id}" style="padding: 14px 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 8px; cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s ease;">
                <span style="font-weight: 600; font-size: 0.95rem; color: #fff;">${escapeHtml(p.title)}</span>
                <span style="font-size: 0.75rem; color: #888;">${p.item_count} items</span>
            </div>
        `).join('') : '<p class="text-muted text-sm">No playlists found.</p>';

        dialog.innerHTML = `
            <div class="dialog-card text-center" style="position: relative;">
                <style>.playlist-option:hover { background: rgba(255,255,255,0.12) !important; }</style>
                <h3 style="margin-bottom: 16px; font-size: 1.35rem; color: #fff;">Save to Playlist</h3>
                <div style="max-height: 220px; overflow-y: auto; padding-right: 4px;">
                    ${listHtml}
                </div>
                <div class="dialog-actions" style="margin-top: 24px;">
                    <button class="btn btn-ghost w-100" id="shorty-playlist-cancel" style="padding: 12px; border-radius: 10px;">Close</button>
                </div>
            </div>
        `;

        showModal(dialog);
        dialog.querySelector('#shorty-playlist-cancel').onclick = () => dialog.close();

        dialog.querySelectorAll('.playlist-option').forEach(el => {
            el.onclick = async () => {
                const pid = el.dataset.id;
                try {
                    await api.addToPlaylist(pid, mediaId);
                    toast('Saved to playlist', 'success');
                    dialog.close();
                } catch (e) { toast('Failed to save', 'error'); }
            };
        });
    }

    async _deleteShortyById(mediaId) {
        if (!mediaId) return;
        const card = document.getElementById(`shorty-card-${mediaId}`);
        if (!card) return;

        const confirmed = await confirm('Delete Shorty', 'Are you sure you want to permanently delete this shorty? This cannot be undone.');
        if (!confirmed) return;

        try {
            await api.deleteMedia(mediaId);
            toast('Shorty deleted successfully!', 'success');

            const currentIndex = parseInt(card.dataset.index);

            this._allVideos = this._allVideos.filter(v => v.id != mediaId);
            this._videos = this._videos.filter(v => v.id != mediaId);

            // Re-index remaining cards in the DOM to maintain feed integrity
            const feed = document.getElementById('shorties-feed');
            let found = false;
            feed.querySelectorAll('.shorty-card').forEach(c => {
                if (c === card) {
                    found = true;
                } else if (found) {
                    c.dataset.index = parseInt(c.dataset.index) - 1;
                }
            });

            // Pause if this was active
            const video = card.querySelector('.shorty-video');
            if (video && this._activeVideoEl === video) {
                this._pauseVideo(video);
                this._activeVideoEl = null;
            }

            // Phase 1: Slide out horizontally
            card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            card.style.transform = 'translateX(-100%)';
            card.style.opacity = '0';

            setTimeout(() => {
                // Phase 2: Collapse height smoothly
                card.style.height = card.offsetHeight + 'px';
                void card.offsetHeight; // Force reflow
                card.style.transition = 'height 0.3s ease, margin 0.3s ease, padding 0.3s ease';
                card.style.height = '0px';
                card.style.margin = '0px';
                card.style.padding = '0px';
                card.style.overflow = 'hidden';

                setTimeout(() => {
                    card.remove();
                    let targetCard = feed?.querySelector(`.shorty-card[data-index="${currentIndex}"]`) || feed?.querySelector(`.shorty-card[data-index="${currentIndex - 1}"]`);
                    if (!targetCard && currentIndex < this._allVideos.length) {
                        this._renderMoreShorties(50);
                        targetCard = feed?.querySelector(`.shorty-card[data-index="${currentIndex}"]`);
                    }
                    if (targetCard) targetCard.scrollIntoView({ behavior: 'smooth' });
                }, 300);
            }, 300);
        } catch (err) { toast(`Failed to delete shorty: ${err.message}`, 'error'); }
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
        await this._deleteShortyById(mediaId);
    }

    destroy() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
        if (this._focusKeydownHandler) {
            document.removeEventListener('keydown', this._focusKeydownHandler);
            this._focusKeydownHandler = null;
        }

        if (this._observer) {
            this._observer.disconnect();
        }
        if (this._virtualizationObserver) {
            this._virtualizationObserver.disconnect();
        }

        if (this._focusTimeout) {
            clearTimeout(this._focusTimeout);
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
