/**
 * MediaHub — Modern Cinematic Video Player Manager
 */
import { api } from './app.js';
import { isAdultApproved, toast, confirm, escapeHtml, showPinDialog } from './utils.js';
import { themeManager } from './theme-manager.js';

export class PlayerManager {
    constructor() {
        this.modal = document.getElementById('player-modal');
        this.video = document.getElementById('player-video');
        this.drawer = document.getElementById('player-drawer');
        this.hls = null;
        this.currentMedia = null;
        this.queue = [];
        this.originalQueue = [];
        this.queueIndex = 0;
        this.isShuffle = false;
        this.controlsTimer = null;
        this.lastTap = 0;
        this.isLoading = false;
        this.isOpen = false;

        // Dynamic Theming State
        this.themeTimer = null;
        this.analyzerCanvas = document.createElement('canvas');
        this.analyzerCtx = this.analyzerCanvas.getContext('2d', { willReadFrequently: true });

        this._lastProgressSecond = -1;

        // Async play safety lock — prevents Promise abort errors on rapid clicks
        this._playLock = false;

        // requestAnimationFrame ID for silky-smooth progress bar (60fps)
        this._rafId = null;

        // Sprite sheet state for hover-preview thumbnails
        this._sprite = null;  // { url, thumb_w, thumb_h, columns, interval }
        this._spriteRetryTimer = null;
        this._spriteCache = new Map();

        // Media validity cache to prevent spamming 404s
        this._mediaValidityCache = new Map();

        this._bindElements();
        this._bindEvents();
        this._bindKeyboard();
        this._bindGestures();
        this._bindSeekPreview();

        // Throttling for seek preview
        this._lastSeekUpdateTime = 0;
        this._wasPlayingBeforeDrag = false;

        // Restore volume
        const savedVol = localStorage.getItem('mediahub_volume');
        if (savedVol !== null) {
            this.setVolume(parseFloat(savedVol), true);
        }

        // Screen Wake Lock Sentinel
        this.wakeLock = null;

        // Auto re-acquire wake lock when returning to foreground while playing
        document.addEventListener('visibilitychange', async () => {
            if (this.isOpen && this.video && !this.video.paused && document.visibilityState === 'visible') {
                await this.requestWakeLock();
            }
        });

        // Flush smart state progress immediately on tab/window unload via keepalive fetch
        window.addEventListener('pagehide', () => {
            if (this.isOpen && this.currentMedia && this.video && this.video.currentTime > 5) {
                const url = `/api/media/${this.currentMedia.id}/events`;
                const payload = JSON.stringify({
                    position_seconds: this.video.currentTime,
                    completed: !!(this.video.ended || (this.video.duration > 0 && this.video.currentTime / this.video.duration > 0.95)),
                    event_type: 'stop',
                });
                fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'same-origin',
                    body: payload,
                    keepalive: true
                }).catch(() => { });
            }
        });
    }

    _bindElements() {
        this.container = document.getElementById('player-container');
        this.overlay = this.modal.querySelector('.player-overlay');
        this.gestureOverlay = document.getElementById('gesture-overlay');
        this.transportTrack = document.getElementById('transport-track');
        this.transportFill = document.getElementById('transport-fill');
        this.transportCurrent = document.getElementById('transport-current');
        this.transportTotal = document.getElementById('transport-total');
        this.tapeTitle = document.getElementById('tape-title-display');

        this.btnPlay = document.getElementById('btn-play');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');
        this.btnShuffle = document.getElementById('item-shuffle');
        this.btnQueueToggle = document.getElementById('btn-queue-toggle');
        this.btnBack = document.getElementById('btn-back');
        this.btnSettings = document.getElementById('btn-settings');
        this.btnFavorite = document.getElementById('item-favorite');
        this.btnDownload = document.getElementById('item-download');
        this.btnFullscreen = document.getElementById('btn-fullscreen');

        // Queue Sheet & Toast
        this.queueSheet = document.getElementById('queue-sheet');
        this.queueList = document.getElementById('queue-list');
        this.playerToast = document.getElementById('player-toast');

        // Drawer elements
        this.drawerBack = document.getElementById('drawer-back-btn');
        this.drawerTitle = document.getElementById('drawer-title');
        this.mainMenu = document.getElementById('drawer-main-menu');
        this.speedMenu = document.getElementById('drawer-speed-menu');
        this.ratioMenu = document.getElementById('drawer-ratio-menu');

        this.valSpeed = document.getElementById('val-speed');
        this.valRatio = document.getElementById('val-ratio');
        this.valSubs = document.getElementById('val-subs');

        // Seek Preview Elements
        this.seekPreview = document.getElementById('seek-preview');
        this.previewFrame = document.getElementById('preview-frame');
        this.previewTimeDisplay = document.getElementById('seek-preview-time');

        // Volume
        this.volumeBar = document.getElementById('volume-bar');
        this.volumeSegments = this.volumeBar?.querySelectorAll('.volume-seg');
        this.volumeSlider = document.getElementById('volume-slider');
        this.volumeIcon = document.getElementById('volume-icon');
        this.transportBuffer = document.getElementById('transport-buffer');

        // Dynamically inject playlist option into the settings drawer
        if (this.mainMenu && !document.getElementById('item-playlist')) {
            const renameItem = this.mainMenu.querySelector('#item-rename');
            if (renameItem) {
                const playlistItem = document.createElement('div');
                playlistItem.className = 'drawer-item';
                playlistItem.id = 'item-playlist';
                playlistItem.innerHTML = `<div class="drawer-icon">📂</div><div class="drawer-label">Save to Playlist</div>`;
                renameItem.parentNode.insertBefore(playlistItem, renameItem);
            }
        }
    }

    _bindEvents() {
        this.btnPlay?.addEventListener('click', (e) => { e.stopPropagation(); this.togglePlay(); });
        this.btnPrev?.addEventListener('click', (e) => { e.stopPropagation(); this.previous(); });
        this.btnNext?.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
        this.btnQueueToggle?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleQueueSheet(); });
        this.btnBack?.addEventListener('click', (e) => { e.stopPropagation(); this.eject(); });
        this.btnSettings?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDrawer(); });
        this.btnFullscreen?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFullscreen(); });

        this._boundPlay = () => {
            this._onPlayState(true);
            this._startThemeAnalysis();
        };
        this._boundPause = () => {
            this._onPlayState(false);
            this._stopThemeAnalysis();

            // Save state immediately on pause
            if (this.currentMedia && this.video.currentTime > 5) {
                api.recordPlayback(this.currentMedia.id, {
                    position_seconds: this.video.currentTime,
                    completed: false,
                    event_type: 'progress',
                }).catch(() => { });
            }
        };
        this._boundEnded = () => this._onEnded();
        this._boundTimeUpdate = () => this._onTimeUpdate();
        this._boundLoaded = () => this._onLoaded();

        this.video.addEventListener('play', this._boundPlay);
        this.video.addEventListener('pause', this._boundPause);
        this.video.addEventListener('ended', this._boundEnded);
        this.video.addEventListener('timeupdate', this._boundTimeUpdate);
        this.video.addEventListener('loadedmetadata', this._boundLoaded);

        this._boundVideoError = (e) => {
            if (this.currentMedia && this._playbackState !== 'FAILED') {
                console.warn("Video Element Error event:", e);
                this._handleFailover(e);
            }
        };
        this.video.addEventListener('error', this._boundVideoError);

        // Buffer progress: fires when the browser downloads more of the video
        this.video.addEventListener('progress', () => this._onBufferUpdate());

        this.video.addEventListener('waiting', () => {
            if (!this.video.paused) {
                this.isLoading = true;
                this.modal.classList.add('is-loading');
            }
        });

        this.video.addEventListener('playing', () => {
            this.isLoading = false;
            this.modal.classList.remove('is-loading');
        });

        this.video.addEventListener('canplay', () => {
            this.isLoading = false;
            this.modal.classList.remove('is-loading');
        });

        this.modal.addEventListener('dblclick', (e) => {
            // Ignore double clicks on drawer or UI controls
            if (e.target.closest('.player-drawer') || e.target.closest('.player-overlay') && !e.target.classList.contains('player-gesture-zones') && !e.target.classList.contains('gesture-zone')) return;
            this.toggleFullscreen();
        });

        // Unified Premium Pointer-Based Seek/Drag Scrubbing
        let isDragging = false;
        let dragSeekTime = 0;
        const handleDrag = (clientX) => {
            let duration = this.video.duration;
            if (!duration || isNaN(duration) || !isFinite(duration)) {
                duration = this.currentMedia?.duration_seconds || 0;
            }
            if (duration <= 0) return;

            const rect = this.transportTrack.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

            // Only update visuals during drag, not the video's actual time to prevent network stutter
            if (this.transportFill) this.transportFill.style.width = `${pct * 100}%`;

            dragSeekTime = pct * duration;
            if (this.transportCurrent) this.transportCurrent.textContent = this._formatTime(dragSeekTime);

            // Connect live seek preview bubble during active drag
            if (this._sprite && this.seekPreview) {
                this._handleSeekMove({ clientX });
            }
        };

        this.transportTrack?.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            isDragging = true;
            this._wasPlayingBeforeDrag = !this.video.paused;
            if (this._wasPlayingBeforeDrag) this.video.pause();

            this.transportTrack.setPointerCapture(e.pointerId);
            handleDrag(e.clientX);
            this._showControls();
        });

        this.transportTrack?.addEventListener('pointermove', (e) => {
            if (isDragging) {
                e.stopPropagation();
                handleDrag(e.clientX);
            }
        });

        const stopDragging = (e) => {
            if (isDragging) {
                e.stopPropagation();
                isDragging = false;
                this.transportTrack.releasePointerCapture(e.pointerId);

                // Commit the seek ONLY when drag ends
                this.video.currentTime = dragSeekTime;

                if (this._wasPlayingBeforeDrag) {
                    this.video.play().catch(() => { });
                }
                this._showControls();

                // Hide the live preview bubble instantly
                this._handleSeekLeave();

                // Smart State Saving: Save the seek progress state instantly
                if (this.currentMedia && dragSeekTime > 5) {
                    api.recordPlayback(this.currentMedia.id, {
                        position_seconds: dragSeekTime,
                        completed: false,
                        event_type: 'progress',
                    }).catch(() => { });
                }
            }
        };

        this.transportTrack?.addEventListener('pointerup', stopDragging);
        this.transportTrack?.addEventListener('pointercancel', stopDragging);

        // Drawer Logic
        this.drawer?.addEventListener('click', (e) => e.stopPropagation());
        this.drawerBack?.addEventListener('click', () => this._showMainMenu());

        this.mainMenu.querySelectorAll('.drawer-item').forEach(item => {
            item.addEventListener('click', () => {
                const menu = item.dataset.menu;
                if (menu === 'speed') this._showSubMenu('speed', 'Playback Speed');
                if (menu === 'ratio') this._showSubMenu('ratio', 'Aspect Ratio');
                if (item.id === 'item-subs') this.toggleSubtitles();
                if (item.id === 'item-rename') {
                    this.toggleDrawer(false);
                    this._onRenameClick();
                }
                if (item.id === 'item-playlist') {
                    this.toggleDrawer(false);
                    this._onPlaylistClick();
                }
                if (item.id === 'item-delete') {
                    this.toggleDrawer(false);
                    this._onDeleteClick();
                }
                if (item.id === 'item-shuffle') {
                    this.toggleDrawer(false);
                    this.toggleShuffle();
                }
                if (item.id === 'item-favorite') {
                    this.toggleDrawer(false);
                    this.toggleFavorite();
                }
                if (item.id === 'item-download') {
                    this.toggleDrawer(false);
                    this.downloadCurrentMedia();
                }
            });
        });

        this.speedMenu.querySelectorAll('.drawer-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const speed = parseFloat(opt.dataset.speed);
                this.setPlaybackSpeed(speed);
                this._showMainMenu();
            });
        });

        this.ratioMenu.querySelectorAll('.drawer-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const ratio = opt.dataset.ratio;
                this.setAspectRatio(ratio);
                this._showMainMenu();
            });
        });

        this.modal.addEventListener('mousemove', () => this._showControls());
        this.modal.addEventListener('click', (e) => {
            if (this.drawer.classList.contains('open')) {
                this.toggleDrawer(false);
            } else if (this.queueSheet?.classList.contains('open')) {
                this.toggleQueueSheet(false);
            } else {
                this._showControls();
            }
        });

        // Volume Bar click handling (legacy segments — now replaced by slider)
        this.volumeSegments?.forEach((seg, i) => {
            seg.addEventListener('click', (e) => {
                e.stopPropagation();
                // segments are in reverse order in HTML (8 at top, 1 at bottom)
                const vol = (8 - i) / 8;
                this.setVolume(vol);
            });
        });

        // Volume Slider (continuous)
        this.volumeSlider?.addEventListener('input', (e) => {
            e.stopPropagation();
            this.setVolume(parseFloat(e.target.value), true);
        });

        // Volume icon click = mute toggle
        this.volumeIcon?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMute();
        });

        // Volume icon keyboard accessibility (Enter/Space)
        this.volumeIcon?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                this.toggleMute();
            }
        });

        // Wheel for volume
        this.modal.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            this.setVolume(this.video.volume + delta);
        }, { passive: false });

        this.modal.addEventListener('close', () => this._cleanup());
    }

    _bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen) return;

            // Ignore keystrokes if the user is typing in an input or textarea
            const targetTag = e.target.tagName;
            if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;

            switch (e.key) {
                case 'j': case 'J': e.preventDefault(); this.seek(-10); break;
                case 'k': case 'K': e.preventDefault(); this.togglePlay(); break;
                case 'l': case 'L': e.preventDefault(); this.seek(10); break;
                case ' ': e.preventDefault(); this.togglePlay(); break;
                case 'ArrowLeft': e.preventDefault(); this.seek(-10); break;
                case 'ArrowRight': e.preventDefault(); this.seek(10); break;
                case 'ArrowUp': e.preventDefault(); this.setVolume(this.video.volume + 0.1); break;
                case 'ArrowDown': e.preventDefault(); this.setVolume(this.video.volume - 0.1); break;
                case 'm': case 'M': e.preventDefault(); this.toggleMute(); break;
                case 's': case 'S': this.toggleShuffle(); break;
                case 'q': case 'Q': this.toggleQueueSheet(); break;
                case 'f': case 'F': this.toggleFullscreen(); break;
                case 'Escape':
                    if (this.drawer.classList.contains('open')) this.toggleDrawer(false);
                    else if (this.queueSheet?.classList.contains('open')) this.toggleQueueSheet(false);
                    else this.eject();
                    break;
            }
        });
    }

    _bindGestures() {
        if (!this.gestureOverlay) return;

        this.longPressTimer = null;
        this.seekInterval = null;
        this.isLongPress = false;

        // Per-zone state tracking for taps and double-taps
        this._gestureState = new Map([
            ['left', { lastTap: 0, timer: null }],
            ['middle', { lastTap: 0, timer: null }],
            ['right', { lastTap: 0, timer: null }]
        ]);

        const handleStart = (e, zone) => {
            // Only handle primary pointer (left mouse button or first touch)
            if (e.button !== undefined && e.button !== 0) return;

            // Prevent browser defaults for custom gestures
            if (e.pointerType === 'touch') {
                e.target.setPointerCapture(e.pointerId);
            }

            this.isLongPress = false;
            clearTimeout(this.longPressTimer);

            this.longPressTimer = setTimeout(() => {
                this.isLongPress = true;
                this._handleLongPressStart(zone);
            }, 500);
        };

        const handleEnd = (e, zone) => {
            clearTimeout(this.longPressTimer);

            if (this.isLongPress) {
                this._handleLongPressEnd(zone);
                this.isLongPress = false;
                return;
            }

            const state = this._gestureState.get(zone);
            const now = Date.now();

            if (now - state.lastTap < 300) {
                // Double tap detected
                clearTimeout(state.timer);
                state.lastTap = 0;
                this._handleDoubleTap(zone);
            } else {
                // Potential single tap
                state.lastTap = now;
                state.timer = setTimeout(() => {
                    if (state.lastTap !== 0) {
                        this._handleSingleTap(zone);
                        state.lastTap = 0;
                    }
                }, 300);
            }
        };

        const handleCancel = (e, zone) => {
            clearTimeout(this.longPressTimer);
            if (this.isLongPress) {
                this._handleLongPressEnd(zone);
            }
            this.isLongPress = false;

            const state = this._gestureState.get(zone);
            clearTimeout(state.timer);
            state.lastTap = 0;
        };

        this.gestureOverlay.querySelectorAll('.gesture-zone').forEach(zoneEl => {
            const zone = zoneEl.dataset.zone;

            // Pointer events are unified and more reliable
            zoneEl.addEventListener('pointerdown', (e) => handleStart(e, zone));
            zoneEl.addEventListener('pointerup', (e) => handleEnd(e, zone));
            zoneEl.addEventListener('pointercancel', (e) => handleCancel(e, zone));

            // If pointer leaves, we should cancel the long press but not trigger a tap
            zoneEl.addEventListener('pointerleave', (e) => {
                if (this.isLongPress) {
                    this._handleLongPressEnd(zone);
                    this.isLongPress = false;
                }
                clearTimeout(this.longPressTimer);
            });
        });
    }

    _handleSingleTap(zone) {
        if (zone === 'middle') {
            this.togglePlay();
            this._triggerFeedback('play-pause');
        } else {
            // Check if drawer or sheet is open first
            if (this.drawer.classList.contains('open')) {
                this.toggleDrawer(false);
            } else if (this.queueSheet?.classList.contains('open')) {
                this.toggleQueueSheet(false);
            } else {
                // Otherwise toggle controls
                if (this.modal.classList.contains('controls-visible')) {
                    this.hideControls();
                } else {
                    this._showControls();
                }
            }
        }
    }

    async _onPlaylistClick() {
        if (!this.currentMedia) return;
        const mediaId = this.currentMedia.id;

        let playlists = [];
        try {
            const res = await api.getPlaylists();
            playlists = Array.isArray(res) ? res : (res?.items || []);
        } catch (e) {
            toast('Failed to load playlists', 'error');
            return;
        }

        let dialog = document.getElementById('player-playlist-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'player-playlist-dialog';
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
        `).join('') : '<p class="text-muted text-sm">No playlists found. Create one above.</p>';

        dialog.innerHTML = `
            <div class="dialog-card text-center" style="position: relative;">
                <style>.playlist-option:hover { background: rgba(255,255,255,0.12) !important; }</style>
                <h3 style="margin-bottom: 16px; font-size: 1.35rem; color: #fff;">Save to Playlist</h3>
                <div style="display: flex; gap: 8px; margin-bottom: 24px;">
                    <input type="text" id="new-playlist-name" placeholder="Create new playlist..." class="form-control" style="flex: 1; padding: 12px 16px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(255, 255, 255, 0.05); color: #fff; font-size: 0.95rem; box-sizing: border-box; outline: none;" />
                    <button class="btn btn-accent" id="btn-create-playlist" style="padding: 0 20px; border-radius: 10px; font-weight: 700; white-space: nowrap; border: none;">Add</button>
                </div>
                <div style="max-height: 220px; overflow-y: auto; padding-right: 4px;" id="existing-playlists">
                    ${listHtml}
                </div>
                <div class="dialog-actions" style="margin-top: 24px;">
                    <button class="btn btn-ghost w-100" id="playlist-cancel" style="padding: 12px; border-radius: 10px;">Close</button>
                </div>
            </div>
        `;

        dialog.showModal();

        dialog.querySelector('#playlist-cancel').onclick = () => dialog.close();

        dialog.querySelectorAll('.playlist-option').forEach(el => {
            el.onclick = async () => {
                const pid = el.dataset.id;
                try {
                    await api.addToPlaylist(pid, mediaId);
                    toast('Saved to playlist', 'success');
                    dialog.close();
                } catch (e) { toast('Failed to save to playlist', 'error'); }
            };
        });

        dialog.querySelector('#btn-create-playlist').onclick = async () => {
            const name = dialog.querySelector('#new-playlist-name').value.trim();
            if (!name) return;
            try {
                const newPl = await api.createPlaylist(name, "");
                await api.addToPlaylist(newPl.id, mediaId);
                toast(`Saved to new playlist '${name}'`, 'success');
                dialog.close();
            } catch (e) { toast('Failed to create playlist', 'error'); }
        };
    }

    _handleDoubleTap(zone) {
        if (zone === 'middle') {
            this.toggleFullscreen();
            return;
        }
        if (zone === 'left') {
            this.seek(-10);
            this._triggerFeedback('ripple-left');
        } else if (zone === 'right') {
            this.seek(10);
            this._triggerFeedback('ripple-right');
        }
    }

    _handleLongPressStart(zone) {
        if (zone === 'middle') {
            const currentSpeed = this.video.playbackRate;
            this._prevSpeed = currentSpeed;
            this.video.playbackRate = 2.0;
            const indicator = document.getElementById('speed-indicator');
            indicator.textContent = '2.0x Speed \xBB';
            indicator.classList.add('visible');
        } else if (zone === 'left') {
            this.seekInterval = setInterval(() => this.seek(-2), 100);
            this._triggerFeedback('ripple-left', true);
        } else if (zone === 'right') {
            this.seekInterval = setInterval(() => this.seek(2), 100);
            this._triggerFeedback('ripple-right', true);
        }
    }

    _handleLongPressEnd(zone) {
        if (zone === 'middle') {
            this.video.playbackRate = this._prevSpeed || 1.0;
            document.getElementById('speed-indicator').classList.remove('visible');
        } else {
            clearInterval(this.seekInterval);
            this.seekInterval = null;
            this._triggerFeedback('ripple-' + zone, false);
        }
    }

    _triggerFeedback(type, active = true) {
        if (type === 'play-pause') {
            const el = document.getElementById('play-pause-feedback');
            const icon = el.querySelector('i');
            icon.className = `v-icon icon-${this.video.paused ? 'pause' : 'play'}`;
            el.classList.remove('animate');
            void el.offsetWidth; // trigger reflow
            el.classList.add('animate');
        } else if (type.startsWith('ripple')) {
            const el = document.getElementById(type);
            if (active) {
                el.classList.remove('animate');
                void el.offsetWidth;
                el.classList.add('animate');
            }
        }
    }

    toggle() {
        this.togglePlay();
    }

    async togglePlay() {
        if (this._playLock || this.isLoading || (!this.video.src && !this.hls)) return;

        this._playLock = true;
        try {
            if (this.video.paused) {
                await this.video.play();
            } else {
                this.video.pause();
            }
        } catch (err) {
            // Silently swallow AbortError from rapid-click race conditions
            if (err.name !== 'AbortError') {
                console.warn('Play interrupted:', err);
            }
        } finally {
            this._playLock = false;
        }
        this._showControls();
    }

    play(input, index = 0) {
        if (Array.isArray(input)) {
            this.originalQueue = [...input];
            this.queue = [...input];
            const selectedItem = this.queue.at(index);

            if (this.isShuffle) {
                this.shuffleQueue();
                this.queueIndex = Math.max(0, this.queue.indexOf(selectedItem));
            } else {
                this.queueIndex = index;
            }
        } else {
            const item = typeof input === 'object' ? input : { id: input, title: 'Loading...' };
            this.originalQueue = [item];
            this.queue = [item];
            this.queueIndex = 0;
        }

        if (!this.isOpen) {
            this.modal.showModal();
            document.body.classList.add('player-active');
        }

        this.isOpen = true;
        this._loadCurrent();
    }

    async _loadCurrent() {
        const media = this.queue.at(this.queueIndex);
        if (!media) return;

        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        const nsfwEnabled = user.preferences?.nsfw === true;
        if (media.adult_only && (!isAdultApproved() || !nsfwEnabled)) {
            toast('18+ Content: Access denied.', 'error');
            this.eject();
            return;
        }

        this._cleanup();
        this.currentMedia = media;
        this.video.poster = `/api/media/${media.id}/thumbnail`;

        // Update UI
        if (this.tapeTitle) this.tapeTitle.textContent = media.title || 'Untitled';
        const sideTitle = document.getElementById('tape-title');
        if (sideTitle) sideTitle.textContent = media.title || 'Untitled';

        this._renderQueueSheet();
        this._showControls();
        this._updateFavoriteButton();

        // Begin async sprite-sheet fetch for hover-preview thumbnails
        // Deferred to prevent UI stutter during video load
        this._spriteRetryTimer = setTimeout(() => this._loadSprite(media.id), 2500);

        // Integrate with OS Media Session API (Button Bar)
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: media.title || 'Untitled',
                artist: 'MediaHub Server',
            });

            // Set action handlers so the OS button bar has full functionality
            navigator.mediaSession.setActionHandler('play', () => this.video.play());
            navigator.mediaSession.setActionHandler('pause', () => this.video.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
            navigator.mediaSession.setActionHandler('seekbackward', (evt) => {
                this.seek(-(evt.seekOffset || 10));
            });
            navigator.mediaSession.setActionHandler('seekforward', (evt) => {
                this.seek(evt.seekOffset || 10);
            });
            navigator.mediaSession.setActionHandler('seekto', (evt) => {
                if (this.video.duration) {
                    this.video.currentTime = evt.seekTime;
                }
            });
        }

        this.isLoading = true;
        this.modal.classList.add('is-loading');

        try {
            this._upNextShown = false;
            this._prefetchedNext = false;
            this._autoNextCancelled = false;

            this._playbackState = 'INIT';
            const cachedValidity = this._mediaValidityCache.get(media.id);
            if (cachedValidity && !cachedValidity.valid && (Date.now() - cachedValidity.ts < 60000)) {
                throw new Error("Media is cached as invalid (recently returned 404)");
            }

            const fetchStreamWithRetry = async () => {
                let delay = 300;
                for (let i = 0; i < 3; i++) {
                    try {
                        const res = await api.stream(this.currentMedia.id, null, true);
                        if (res) return res;
                    } catch (e) {
                        if (e.status === 404) {
                            this._mediaValidityCache.set(media.id, { valid: false, ts: Date.now() });
                            throw e;
                        }
                        if (i === 2) throw e;
                        await new Promise(r => setTimeout(r, delay));
                        delay *= 2;
                    }
                }
                throw new Error("Failed to fetch stream after retries");
            };

            const res = await fetchStreamWithRetry();
            if (!res || !res.url) throw new Error("No stream URL");

            if (res.mode === 'hls' && typeof Hls !== 'undefined' && Hls.isSupported()) {
                this._playbackState = 'HLS';
                this._initMainStream(res.url, res.mode);
            } else {
                this._playbackState = 'DIRECT';
                this.video.src = res.url;
                this._startPlayback();
            }
        } catch (err) {
            this.isLoading = false;
            console.error("Playback error:", err);
            // Failover to direct if HLS failed
            this._handleFailover(err);
        }
    }

    _initMainStream(url, mode) {
        this.hls = new Hls({
            startLevel: -1,
            capLevelToPlayerSize: true,
            enableWorker: true,
            maxBufferLength: 45,
            maxMaxBufferLength: 90,
        });

        let networkRetryCount = 0;

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.warn("HLS Fatal Error:", data.type);
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        networkRetryCount++;
                        if (networkRetryCount > 8) this._handleFailover();
                        else setTimeout(() => { if (this.hls) this.hls.startLoad(); }, 1500);
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        this.hls.recoverMediaError();
                        break;
                    default:
                        this._handleFailover();
                        break;
                }
            }
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => this._startPlayback());
    }

    async _handleFailover(err) {
        if (!this.currentMedia) return;
        if (this._playbackState === 'DIRECT' || this._playbackState === 'FAILED') {
            console.error("Failover: Already failed in Direct mode. Stopping.");
            this._playbackState = 'FAILED';
            this.showToast("Playback Failure");
            this.eject();
            return;
        }

        console.log("Adaptive Failover: Attempting direct stream fallback");
        this._playbackState = 'DIRECT';
        try {
            if (this.hls) {
                this.hls.destroy();
                this.hls = null;
            }
            // Force direct mode in backend or just use file endpoint if available
            const directUrl = `/api/media/${this.currentMedia.id}/file`;
            this.video.src = directUrl;
            this._startPlayback();
        } catch (e) {
            this._playbackState = 'FAILED';
            this.showToast("Playback Failure");
            this.eject();
        }
    }

    async _startPlayback() {
        this.isLoading = false;
        this.modal.classList.remove('is-loading');
        if (this.currentMedia && this.currentMedia.last_position_seconds) {
            this.video.currentTime = this.currentMedia.last_position_seconds;
        }
        try {
            await this.video.play();
        } catch (err) {
            if (this.btnPlay) this.btnPlay.classList.add('pulse');
        }
    }

    previous() {
        if (this.queueIndex <= 0) return;
        this.queueIndex--;
        this._loadCurrent();
        this._showControls();
    }

    next() {
        if (this.queueIndex >= this.queue.length - 1) return;
        this.queueIndex++;
        this._loadCurrent();
        this._showControls();
    }

    seek(seconds) {
        if (!this.video.duration) return;
        this.video.currentTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
        this._showControls();
    }

    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        if (this.btnShuffle) {
            this.btnShuffle.classList.toggle('active', this.isShuffle);
        }

        if (this.isShuffle) {
            this.shuffleQueue();
            this.queueIndex = 0; // Immediate skip to new index 0
            this._loadCurrent();
            this.showToast('Playlist Shuffled');
        } else {
            // Restore original order
            const currentId = this.currentMedia?.id;
            this.queue = [...this.originalQueue];
            if (currentId) {
                this.queueIndex = this.queue.findIndex(m => m.id === currentId);
            }
        }
        this._showControls();
        this._renderQueueSheet();
    }

    shuffleQueue() {
        // Fisher-Yates Shuffle
        for (let i = this.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const itemI = this.queue.at(i);
            const itemJ = this.queue.at(j);
            this.queue.splice(i, 1, itemJ);
            this.queue.splice(j, 1, itemI);
        }
    }

    toggleQueueSheet(show) {
        const isOpen = show !== undefined ? show : !this.queueSheet.classList.contains('open');
        this.queueSheet.classList.toggle('open', isOpen);
        if (isOpen) {
            this._renderQueueSheet();
            this.toggleDrawer(false);
            clearTimeout(this.controlsTimer);
        } else {
            this._showControls();
        }
    }

    _renderQueueSheet() {
        if (!this.queueList) return;
        this.queueList.innerHTML = '';

        this.queue.forEach((media, index) => {
            const item = document.createElement('div');
            item.className = `queue-item ${index === this.queueIndex ? 'active' : ''}`;

            const indexSpan = document.createElement('span');
            indexSpan.className = 'queue-item-index';
            indexSpan.textContent = String(index + 1).padStart(2, '0');

            const titleSpan = document.createElement('span');
            titleSpan.className = 'queue-item-title';
            titleSpan.textContent = media.title || 'Untitled';

            item.appendChild(indexSpan);
            item.appendChild(titleSpan);

            if (index === this.queueIndex) {
                item.insertAdjacentHTML('beforeend', '<i class="v-icon icon-play" style="width:16px; height:16px;"></i>');
            }

            item.addEventListener('click', () => {
                this.jumpToQueueIndex(index);
                this.toggleQueueSheet(false);
            });
            this.queueList.appendChild(item);
        });
    }

    jumpToQueueIndex(index) {
        this.queueIndex = index;
        this._loadCurrent();
    }

    showToast(message) {
        if (!this.playerToast) return;
        this.playerToast.textContent = message;
        this.playerToast.classList.add('visible');
        setTimeout(() => this.playerToast.classList.remove('visible'), 2000);
    }

    _handleVideoEnd() {
        if (this._autoNextCancelled) {
            // User explicitly cancelled auto-next, do nothing and stay on ended state
            return;
        }
        if (this.queueIndex < this.queue.length - 1) {
            this.next();
        } else {
            this.showToast('Playlist Finished');
            setTimeout(() => this.eject(), 3000);
        }
    }

    _showUpNextOverlay() {
        const nextMedia = this.queue.at(this.queueIndex + 1);
        if (!nextMedia) return;

        const overlay = document.getElementById('up-next-overlay');
        if (!overlay) return;

        if (this._upNextInterval) {
            clearInterval(this._upNextInterval);
        }

        overlay.querySelector('.up-next-title').textContent = nextMedia.title;
        overlay.classList.add('visible');

        let countdown = 8;
        const timer = overlay.querySelector('.up-next-timer');
        timer.textContent = countdown;

        this._upNextInterval = setInterval(() => {
            countdown--;
            timer.textContent = countdown;
            if (countdown <= 0) {
                clearInterval(this._upNextInterval);
                this._upNextInterval = null;
                overlay.classList.remove('visible');
                this.next();
            }
        }, 1000);

        overlay.querySelector('.btn-cancel-next').onclick = () => {
            clearInterval(this._upNextInterval);
            this._upNextInterval = null;
            overlay.classList.remove('visible');
            this._autoNextCancelled = true;
        };

        overlay.querySelector('.btn-play-now').onclick = () => {
            clearInterval(this._upNextInterval);
            overlay.classList.remove('visible');
            this.next();
        };
    }

    eject() {
        this.isOpen = false;
        if (this.currentMedia && this.video.currentTime > 5) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.currentTime,
                completed: !!(this.video.ended || (this.video.duration > 0 && this.video.currentTime / this.video.duration > 0.95)),
                event_type: 'stop',
            }).catch(() => { });
        }
        this.video.pause();
        this.video.src = '';
        this.modal.close();
    }

    toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen();
        else this.container?.requestFullscreen?.();
    }

    toggleDrawer(show) {
        const isOpen = show !== undefined ? show : !this.drawer.classList.contains('open');
        this.drawer.classList.toggle('open', isOpen);
        if (isOpen) {
            this._showMainMenu();
            this.toggleQueueSheet(false);
            clearTimeout(this.controlsTimer);
        } else {
            this._showControls();
        }
    }

    _showMainMenu() {
        this.mainMenu.hidden = false;
        this.speedMenu.hidden = true;
        this.ratioMenu.hidden = true;
        this.drawerTitle.textContent = 'Settings';
        this.drawerBack.classList.remove('visible');
    }

    _showSubMenu(id, title) {
        this.mainMenu.hidden = true;
        this.speedMenu.hidden = id !== 'speed';
        this.ratioMenu.hidden = id !== 'ratio';
        this.drawerTitle.textContent = title;
        this.drawerBack.classList.add('visible');
    }

    setPlaybackSpeed(rate) {
        this.video.playbackRate = rate;
        this.valSpeed.textContent = `${rate}x`;
        this.speedMenu.querySelectorAll('.drawer-option').forEach(opt => {
            opt.classList.toggle('selected', parseFloat(opt.dataset.speed) === rate);
        });
    }

    setVolume(val, silent = false) {
        const vol = Math.max(0, Math.min(1, val));
        this.video.volume = vol;
        localStorage.setItem('mediahub_volume', vol.toString());

        // Update slider position
        if (this.volumeSlider) this.volumeSlider.value = vol;

        // Update volume icon: muted vs active
        if (this.volumeIcon) {
            this.volumeIcon.className = vol === 0
                ? 'v-icon icon-mute'
                : 'v-icon icon-volume';
        }

        if (!silent) {
            this.showToast(vol === 0 ? 'Muted' : `Volume: ${Math.round(vol * 100)}%`);
        }
    }

    toggleMute() {
        if (this.video.volume > 0) {
            this._lastVolume = this.video.volume;
            this.setVolume(0);
        } else {
            this.setVolume(this._lastVolume || 1);
        }
    }

    setAspectRatio(mode) {
        this.video.style.objectFit = mode;
        const labels = new Map([
            ['contain', 'Fit'],
            ['cover', 'Zoom'],
            ['fill', 'Stretch']
        ]);
        this.valRatio.textContent = labels.get(mode) || 'Fit';
        this.ratioMenu.querySelectorAll('.drawer-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.ratio === mode);
        });
    }

    toggleSubtitles() {
        const tracks = this.video.textTracks;
        if (!tracks || tracks.length === 0) return;
        const current = Array.from(tracks).find(t => t.mode === 'showing');
        if (current) {
            current.mode = 'hidden';
            this.valSubs.textContent = 'Off';
        } else {
            tracks[0].mode = 'showing';
            this.valSubs.textContent = 'On';
        }
    }

    _onPlayState(playing) {
        if (this.btnPlay) {
            this.btnPlay.classList.toggle('active', playing);
        }
        // Drive progress bar at 60fps while playing; stop on pause
        if (playing) {
            this._startRaf();
            this.requestWakeLock();
        } else {
            this._stopRaf();
            this.releaseWakeLock();
            // Do one final tick so the bar snaps to the exact paused position
            this._rafTick();
        }
    }

    async requestWakeLock() {
        if (!('wakeLock' in navigator)) return;
        try {
            if (this.wakeLock) return; // Already locked
            this.wakeLock = await navigator.wakeLock.request('screen');
            console.log('Screen Wake Lock acquired successfully');
            this.wakeLock.addEventListener('release', () => {
                console.log('Screen Wake Lock released by browser');
            });
        } catch (err) {
            console.warn('Failed to acquire Screen Wake Lock:', err);
        }
    }

    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release().catch(() => { });
            this.wakeLock = null;
            console.log('Screen Wake Lock released manually');
        }
    }

    /** Start the requestAnimationFrame loop for smooth progress rendering */
    _startRaf() {
        if (this._rafId) return; // Already running
        const tick = () => {
            this._rafTick();
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    /** Stop the RAF loop */
    _stopRaf() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /**
     * One RAF frame: update the progress fill and current-time display.
     * Runs at the screen refresh rate (~60fps) while playing for buttery smoothness.
     * Side-effect-free — no API calls, no heavy work here.
     */
    _rafTick() {
        const currentTime = this.video.currentTime || 0;
        let duration = this.video.duration;
        if (!duration || isNaN(duration) || !isFinite(duration)) {
            duration = this.currentMedia?.duration_seconds || 0;
        }

        if (duration > 0) {
            const pct = (currentTime / duration) * 100;
            if (this.transportFill) this.transportFill.style.width = `${pct}%`;
        }
        if (this.transportCurrent) {
            this.transportCurrent.textContent = this._formatTime(currentTime, duration || undefined);
        }
    }

    _onEnded() {
        if (this.currentMedia) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.currentTime || 0,
                completed: true,
                event_type: 'complete',
            }).catch(() => { });
        }
        this._handleVideoEnd();
    }

    _onTimeUpdate() {
        const currentTime = this.video.currentTime || 0;
        let duration = this.video.duration;

        // Fallback for HLS streams where duration might be NaN or Infinity
        if (!duration || isNaN(duration) || !isFinite(duration)) {
            duration = this.currentMedia?.duration_seconds || 0;
        }

        // NOTE: Progress bar visuals are driven by _rafTick() at 60fps.
        // This handler only handles side-effects that don't need per-frame precision.

        // Update total duration display (only when valid)
        if (duration > 0 && this.transportTotal) {
            this.transportTotal.textContent = this._formatTime(duration, duration);
        }

        const tapePos = document.getElementById('tape-position');
        if (tapePos) tapePos.textContent = this._formatTime(currentTime, duration || undefined);

        const currentSec = Math.floor(currentTime);
        if (this.currentMedia && currentSec % 5 === 0 && currentSec > 5 && currentSec !== this._lastProgressSecond) {
            this._lastProgressSecond = currentSec;
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: currentTime,
                completed: false,
                event_type: 'progress',
            }).catch(() => { });
        }

        // Update Media Session Progress
        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && duration > 0) {
            try {
                navigator.mediaSession.setPositionState({
                    duration: duration,
                    playbackRate: this.video.playbackRate || 1.0,
                    position: currentTime
                });
            } catch (e) {
                // Ignore transient errors if duration/position are temporarily out of bounds
            }
        }

        // Intelligent Auto-Next Trigger (Disabled for instant auto-next)
    }

    _onLoaded() {
        const dur = this.video.duration;
        // Hard NaN guard: metadata can fire before the codec resolves the duration
        if (!dur || isNaN(dur) || !isFinite(dur)) return;

        if (this.transportTotal) this.transportTotal.textContent = this._formatTime(dur, dur);

        const tapeDur = document.getElementById('tape-duration');
        if (tapeDur) tapeDur.textContent = this._formatTime(dur, dur);

        const tapeRes = document.getElementById('tape-resolution');
        if (tapeRes) tapeRes.textContent = `${this.video.videoWidth}x${this.video.videoHeight} `;

        const tapeFormat = document.getElementById('tape-format');
        if (tapeFormat) tapeFormat.textContent = this.currentMedia?.video_codec?.toUpperCase() || 'VIDEO';

        const tapeQual = document.getElementById('tape-quality');
        if (tapeQual) tapeQual.textContent = this.video.videoHeight >= 1080 ? 'FHD' : (this.video.videoHeight >= 720 ? 'HD' : 'SD');
    }

    _onBufferUpdate() {
        if (!this.transportBuffer) return;
        const video = this.video;
        let duration = video.duration;
        if (!duration || isNaN(duration) || !isFinite(duration)) {
            duration = this.currentMedia?.duration_seconds || 0;
        }
        if (duration <= 0 || !video.buffered.length) return;

        // Find the buffered range that encompasses the current playhead
        let bufferedEnd = 0;
        for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime) {
                bufferedEnd = Math.max(bufferedEnd, video.buffered.end(i));
            }
        }
        const pct = Math.min(100, (bufferedEnd / duration) * 100);
        this.transportBuffer.style.width = `${pct}%`;
    }

    _showControls() {
        this.modal.classList.add('controls-visible');
        this.modal.classList.remove('hide-cursor');
        clearTimeout(this.controlsTimer);
        this.controlsTimer = setTimeout(() => {
            if (!this.video.paused && !this.drawer.classList.contains('open') && !this.queueSheet?.classList.contains('open')) {
                this.hideControls();
            }
        }, 3000); // 3-second auto-hide
    }

    hideControls() {
        this.modal.classList.remove('controls-visible');
        if (!this.video.paused) {
            this.modal.classList.add('hide-cursor');
        }
    }

    _cleanup() {
        // Stop the 60fps RAF loop before tearing down the video element
        this._stopRaf();
        this._playLock = false;

        if (this._boundVideoError) {
            this.video.removeEventListener('error', this._boundVideoError);
        }

        // Release Screen Wake Lock
        this.releaseWakeLock();

        // Cancel any pending sprite-sheet retry and clear state
        clearTimeout(this._spriteRetryTimer);
        this._sprite = null;
        this.seekPreview?.classList.remove('visible');

        if (this.hls) { this.hls.destroy(); this.hls = null; }

        this._stopThemeAnalysis();

        this.video.src = '';
        this.video.load();

        if (this.transportFill) this.transportFill.style.width = '0%';
        if (this.transportBuffer) this.transportBuffer.style.width = '0%';
        this.currentMedia = null;
        this.toggleDrawer(false);
        this.toggleQueueSheet(false);
        document.body.classList.remove('player-active');

        const upNext = document.getElementById('up-next-overlay');
        if (upNext) {
            upNext.classList.remove('visible');
            clearInterval(this._upNextInterval);
        }
    }

    _formatTime(s, totalDuration) {
        if (!s || isNaN(s)) return '00:00';
        const showHours = totalDuration
            ? totalDuration >= 3600
            : s >= 3600;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        if (showHours) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    /**
     * Professional Standard: Dynamic Theming
     */
    _startThemeAnalysis() {
        if (this.themeTimer) return;
        this.themeTimer = setInterval(() => this._analyzeFrame(), 3000);
        this._analyzeFrame(); // Initial run
    }

    _stopThemeAnalysis() {
        clearInterval(this.themeTimer);
        this.themeTimer = null;
    }

    _analyzeFrame() {
        if (this.video.paused || this.video.ended || this.video.readyState < 2) return;

        // Downsample for performance
        const w = 50;
        const h = Math.round(this.video.videoHeight / (this.video.videoWidth / w));
        this.analyzerCanvas.width = w;
        this.analyzerCanvas.height = h;

        try {
            this.analyzerCtx.drawImage(this.video, 0, 0, w, h);
            const data = this.analyzerCtx.getImageData(0, 0, w, h).data;

            let r = 0, g = 0, b = 0, count = 0;
            // Sample every 4th pixel for speed
            for (let i = 0; i < data.length; i += 16) {
                // Ignore very dark pixels to keep colors vibrant
                if (data.at(i) + data.at(i + 1) + data.at(i + 2) > 60) {
                    r += data.at(i);
                    g += data.at(i + 1);
                    b += data.at(i + 2);
                    count++;
                }
            }

            if (count > 0) {
                const avgR = Math.round(r / count);
                const avgG = Math.round(g / count);
                const avgB = Math.round(b / count);

                // Boost saturation for the accent
                const hsl = this._rgbToHsl(avgR, avgG, avgB);
                const accentHsl = `hsl(${hsl.h}, ${Math.min(100, hsl.s + 20)}%, ${Math.max(40, Math.min(70, hsl.l))}%)`;
                const bgRgb = `${Math.round(avgR * 0.1)}, ${Math.round(avgG * 0.1)}, ${Math.round(avgB * 0.1)}`;

                this.modal.style.setProperty('--player-accent', accentHsl);
                this.modal.style.setProperty('--player-accent-glow', `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, 0.4)`);
                this.modal.style.setProperty('--player-bg', `rgb(${bgRgb})`);
                this.modal.style.setProperty('--player-bg-rgb', bgRgb);

                // Also update the sidebar if it exists
                const playerInfo = this.modal.querySelector('.player-info');
                if (playerInfo) {
                    playerInfo.style.background = `rgba(${bgRgb}, 0.8)`;
                }
                themeManager.applyDynamicPlayerTheme(this.modal, {
                    r: avgR, g: avgG, b: avgB,
                    h: hsl.h, s: hsl.s, l: hsl.l
                });
            }
        } catch (e) {
            console.warn("Theme analysis failed:", e);
        }
    }

    _rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) h = s = 0;
        else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    /**
     * Professional Standard: Seek Preview via Sprite Sheet
     * Replaces the old hidden-video approach (Option B) which caused lag.
     * Uses a pre-generated JPEG tile grid (Option A) for zero-decode-overhead previews.
     */
    _bindSeekPreview() {
        if (!this.transportTrack || !this.seekPreview) return;

        this.transportTrack.addEventListener('mousemove', (e) => this._handleSeekMove(e));
        this.transportTrack.addEventListener('mouseleave', () => this._handleSeekLeave());
        this.transportTrack.addEventListener('mouseenter', () => {
            if (this._sprite) this.seekPreview.classList.add('visible');
        });
    }

    _handleSeekMove(e) {
        if (!this.video.duration || isNaN(this.video.duration)) return;
        if (!this._sprite) return; // Don't show preview box if sprite isn't ready

        const rect = this.transportTrack.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seekTime = pct * this.video.duration;

        // ── Sprite math ──────────────────────────────────────────────────────
        const { url, thumb_w, thumb_h, columns, interval } = this._sprite;
        const frameIndex = Math.floor(seekTime / interval);
        const col = frameIndex % columns;
        const row = Math.floor(frameIndex / columns);
        const bgX = -(col * thumb_w);
        const bgY = -(row * thumb_h);

        if (this.previewFrame) {
            this.previewFrame.style.backgroundImage = `url(${url})`;
            this.previewFrame.style.backgroundPosition = `${bgX}px ${bgY}px`;
        }

        // ── Clamp preview box to player edges ─────────────────────────────
        // getBoundingClientRect gives us accurate positioning regardless of
        // nested elements (fixes the offsetX inaccuracy edge case).
        const trackRect = this.transportTrack.getBoundingClientRect();
        const playerRect = this.modal.getBoundingClientRect();
        const halfPreview = thumb_w / 2;

        let left = e.clientX - trackRect.left; // position relative to track
        // Convert to percentage for CSS left
        const leftPct = (left / trackRect.width) * 100;

        // Clamp in pixels so the box doesn't overflow either side of the player
        const leftPx = e.clientX - playerRect.left;
        const clampedPx = Math.max(halfPreview, Math.min(playerRect.width - halfPreview, leftPx));
        this.seekPreview.style.left = `${clampedPx - (trackRect.left - playerRect.left)}px`;
        this.seekPreview.classList.add('visible');

        // ── Time label ────────────────────────────────────────────────────
        if (this.previewTimeDisplay) {
            this.previewTimeDisplay.textContent = this._formatTime(seekTime, this.video.duration);
        }
    }

    _handleSeekLeave() {
        this.seekPreview.classList.remove('visible');
    }

    /**
     * Fetch sprite sheet metadata from the backend.
     * If the server returns 202 (still generating), retries with backoff up to ~2 min.
     */
    async _loadSprite(mediaId) {
        this._sprite = null;
        if (this.previewFrame) {
            this.previewFrame.style.backgroundImage = 'none';
        }
        clearTimeout(this._spriteRetryTimer);

        // Check cache first
        if (this._spriteCache.has(mediaId)) {
            const cached = this._spriteCache.get(mediaId);
            if (cached) {
                this._sprite = cached;
                // Pre-load the sprite image
                const img = new Image();
                img.src = cached.url;
            }
            return;
        }

        let attempts = 0;
        const maxAttempts = 8;
        const delays = [2000, 4000, 8000, 12000, 16000, 20000, 30000, 40000];

        const tryFetch = async () => {
            try {
                const res = await fetch(`/api/media/${mediaId}/sprites`, {
                    credentials: 'include',
                });
                if (res.status === 200) {
                    const data = await res.json();
                    this._sprite = data;
                    this._spriteCache.set(mediaId, data);

                    // Pre-load the sprite image so first hover is instant
                    const img = new Image();
                    img.src = data.url;
                    return;
                }
                if (res.status === 404) {
                    // Cache the 404 as null so we don't retry or request again
                    this._spriteCache.set(mediaId, null);
                    return;
                }
                // 202 = still generating — schedule retry
                if (res.status === 202 && attempts < maxAttempts) {
                    attempts++;
                    this._spriteRetryTimer = setTimeout(tryFetch, delays.at(attempts - 1) ?? 40000);
                }
            } catch (_) {
                // Network error: retry silently
                if (attempts < maxAttempts) {
                    attempts++;
                    this._spriteRetryTimer = setTimeout(tryFetch, delays.at(attempts - 1) ?? 40000);
                }
            }
        };
        tryFetch();
    }

    async _onRenameClick() {
        console.log("Starting rename flow...");
        if (!this.currentMedia) {
            console.warn("No active media to rename.");
            return;
        }
        const currentTitle = this.currentMedia.title || 'Untitled';

        // Dynamically create and show a custom modal for renaming
        const newTitle = await new Promise((resolve) => {
            let dialog = document.getElementById('player-rename-dialog');
            if (!dialog) {
                dialog = document.createElement('dialog');
                dialog.id = 'player-rename-dialog';
                dialog.className = 'glass-modal';
                dialog.style.maxWidth = '400px';
                dialog.style.padding = '0';
                dialog.style.border = 'none';
                dialog.style.background = 'transparent';
                document.body.appendChild(dialog);
            }

            const dialogCard = document.createElement('div');
            dialogCard.className = 'dialog-card text-center';

            const renameTitleHtml = '<h3>Rename Media</h3><p class="text-muted text-sm" style="margin-bottom: 16px;">Modify the media display title below:</p>';

            const inputField = document.createElement('input');
            inputField.type = 'text';
            inputField.id = 'rename-input';
            inputField.className = 'form-control';
            inputField.style.cssText = 'width: 100%; padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(255, 255, 255, 0.05); color: #fff; font-size: 0.95rem; margin-bottom: 20px; box-sizing: border-box;';
            inputField.value = currentTitle;

            const actionDiv = document.createElement('div');
            actionDiv.className = 'dialog-actions';
            actionDiv.style.cssText = 'display: flex; gap: 12px;';
            actionDiv.innerHTML = `
                <button class="btn btn-ghost w-100" id="rename-cancel" style="padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #fff; cursor: pointer;">Cancel</button>
                <button class="btn btn-accent w-100" id="rename-save" style="padding: 10px; border-radius: 8px; border: none; background: var(--player-accent, #00aaff); color: #000; font-weight: 600; cursor: pointer; box-shadow: 0 0 10px var(--player-accent-glow);">Save</button>
            `;

            dialogCard.innerHTML = renameTitleHtml;
            dialogCard.appendChild(inputField);
            dialogCard.appendChild(actionDiv);

            dialog.innerHTML = '';
            dialog.appendChild(dialogCard);

            const input = dialog.querySelector('#rename-input');
            const cancelBtn = dialog.querySelector('#rename-cancel');
            const saveBtn = dialog.querySelector('#rename-save');

            const close = (val) => {
                dialog.close();
                resolve(val);
            };

            cancelBtn.addEventListener('click', () => close(null));
            saveBtn.addEventListener('click', () => {
                const val = input.value.trim();
                if (val) close(val);
            });

            // Handle enter key
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const val = input.value.trim();
                    if (val) close(val);
                }
            });

            dialog.showModal();
            input.focus();
            input.select();
        });

        if (!newTitle) {
            console.log("Rename cancelled by user.");
            return;
        }

        try {
            await api.renameMedia(this.currentMedia.id, newTitle);

            // Instantly mutate displayed titles without reloading
            this.currentMedia.title = newTitle;
            if (this.tapeTitle) this.tapeTitle.textContent = newTitle;
            const sideTitle = document.getElementById('tape-title');
            if (sideTitle) sideTitle.textContent = newTitle;

            // Update queue item dynamically in the playlist queue sheet
            const activeQueueItem = this.queueList?.querySelector('.queue-item.active .queue-item-title');
            if (activeQueueItem) activeQueueItem.textContent = newTitle;

            toast('Media renamed successfully', 'success');
        } catch (e) {
            console.error("Failed to rename media", e);
            toast(`Failed to rename: ${e.message}`, 'error');
        }
    }

    async _onDeleteClick() {
        console.log("Starting delete flow...");
        if (!this.currentMedia) {
            console.warn("No active media to delete.");
            return;
        }

        const confirmed = await confirm("Delete File", "Are you sure you want to delete this file?");
        if (!confirmed) {
            console.log("Delete cancelled by user.");
            return;
        }

        const mediaId = this.currentMedia.id;

        try {
            // First stop the player and release all browser file handles
            console.log("Stopping video and releasing file handles...");
            this.video.pause();
            this._cleanup();

            // Wait a tiny bit (e.g. 200ms) for the server to close socket/file handles
            await new Promise(resolve => setTimeout(resolve, 200));

            await api.deleteMedia(mediaId);

            toast('File successfully deleted', 'success');

            // Remove the deleted media item from this.queue and this.originalQueue
            this.queue = this.queue.filter(item => item.id !== mediaId);
            this.originalQueue = this.originalQueue.filter(item => item.id !== mediaId);

            // If the queue is empty, eject from player
            if (this.queue.length === 0) {
                this.eject();
                return;
            }

            // If there's a next media item, skip playback to it.
            if (this.queueIndex >= this.queue.length) {
                this.queueIndex = 0;
            }

            // Instantly load the next media item and play
            this._loadCurrent();
        } catch (e) {
            console.error("Failed to delete media", e);
            toast(`Failed to delete: ${e.message}`, 'error');

            // If it failed, reload current media to restore state
            this._loadCurrent();
        }
    }

    async toggleFavorite() {
        if (!this.currentMedia) return;
        try {
            await api.toggleFavorite(this.currentMedia.id);
            this.currentMedia.is_favorite = !this.currentMedia.is_favorite;
            this._updateFavoriteButton();

            // Dispatch a global event or refresh views if needed
            document.dispatchEvent(new CustomEvent('favorite-toggled', {
                detail: { mediaId: this.currentMedia.id, isFavorite: this.currentMedia.is_favorite }
            }));

            toast(this.currentMedia.is_favorite ? 'Added to favorites' : 'Removed from favorites', 'success');
        } catch (e) {
            console.error("Failed to toggle favorite:", e);
            toast('Failed to toggle favorite', 'error');
        }
    }

    _updateFavoriteButton() {
        if (!this.btnFavorite || !this.currentMedia) return;
        this.btnFavorite.classList.toggle('active', !!this.currentMedia.is_favorite);
    }

    async downloadCurrentMedia() {
        if (!this.currentMedia) return;
        let url = `/api/media/${this.currentMedia.id}/download`;
        if (this.currentMedia.requires_pin) {
            const pin = await showPinDialog("Enter PIN to download this PG-Locked media:");
            if (!pin) return;
            url += `?pin=${encodeURIComponent(pin)}`;
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = this.currentMedia.title || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}
