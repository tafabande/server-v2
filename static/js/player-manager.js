/**
 * MediaHub — Modern Cinematic Video Player Manager
 */
import { api } from './app.js';

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

        this._bindElements();
        this._bindEvents();
        this._bindKeyboard();
        this._bindGestures();
    }

    _bindElements() {
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
        this.btnShuffle = document.getElementById('btn-shuffle');
        this.btnQueueToggle = document.getElementById('btn-queue-toggle');
        this.btnBack = document.getElementById('btn-back');
        this.btnSettings = document.getElementById('btn-settings');
        
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
    }

    _bindEvents() {
        this.btnPlay?.addEventListener('click', (e) => { e.stopPropagation(); this.togglePlay(); });
        this.btnPrev?.addEventListener('click', (e) => { e.stopPropagation(); this.previous(); });
        this.btnNext?.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
        this.btnShuffle?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleShuffle(); });
        this.btnQueueToggle?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleQueueSheet(); });
        this.btnBack?.addEventListener('click', (e) => { e.stopPropagation(); this.eject(); });
        this.btnSettings?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDrawer(); });

        this.video.addEventListener('timeupdate', () => this._updateTransport());
        this.video.addEventListener('play', () => this._onPlayState(true));
        this.video.addEventListener('pause', () => this._onPlayState(false));
        this.video.addEventListener('ended', () => this._onEnded());
        this.video.addEventListener('loadedmetadata', () => this._onLoaded());

        this.transportTrack?.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = this.transportTrack.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            this.video.currentTime = pct * this.video.duration;
            this._showControls();
        });

        // Drawer Logic
        this.drawer?.addEventListener('click', (e) => e.stopPropagation());
        this.drawerBack?.addEventListener('click', () => this._showMainMenu());
        
        this.mainMenu.querySelectorAll('.drawer-item').forEach(item => {
            item.addEventListener('click', () => {
                const menu = item.dataset.menu;
                if (menu === 'speed') this._showSubMenu('speed', 'Playback Speed');
                if (menu === 'ratio') this._showSubMenu('ratio', 'Aspect Ratio');
                if (item.id === 'item-subs') this.toggleSubtitles();
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
        this.modal.addEventListener('click', () => {
            if (this.drawer.classList.contains('open')) {
                this.toggleDrawer(false);
            } else if (this.queueSheet?.classList.contains('open')) {
                this.toggleQueueSheet(false);
            } else {
                this._showControls();
            }
        });
        this.modal.addEventListener('close', () => this._cleanup());
    }

    _bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (!this.modal.open) return;
            switch (e.key) {
                case ' ': e.preventDefault(); this.togglePlay(); break;
                case 'ArrowLeft': e.preventDefault(); this.seek(-10); break;
                case 'ArrowRight': e.preventDefault(); this.seek(10); break;
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
        this._gestureState = {
            left: { lastTap: 0, timer: null },
            middle: { lastTap: 0, timer: null },
            right: { lastTap: 0, timer: null }
        };

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

            const state = this._gestureState[zone];
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
            
            const state = this._gestureState[zone];
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

    _handleDoubleTap(zone) {
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
            this.video.playbackRate = 2.0;
            document.getElementById('speed-indicator').classList.add('visible');
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
            this.video.playbackRate = 1.0;
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

    togglePlay() {
        if (this.video.paused) this.video.play();
        else this.video.pause();
        this._showControls();
    }

    play(input, index = 0) {
        if (Array.isArray(input)) {
            this.originalQueue = [...input];
            this.queue = [...input];
            const selectedItem = this.queue[index];

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

        if (!this.modal.open) {
            this.modal.showModal();
        }
        
        this._loadCurrent();
    }

    async _loadCurrent() {
        const media = this.queue[this.queueIndex];
        if (!media) return;

        this._cleanup();
        this.currentMedia = media;
        
        // Update UI
        if (this.tapeTitle) this.tapeTitle.textContent = media.title || 'Untitled';
        const sideTitle = document.getElementById('tape-title');
        if (sideTitle) sideTitle.textContent = media.title || 'Untitled';
        
        this._renderQueueSheet();
        this._showControls();

        try {
            const res = await api.stream(media.id);
            if (!res || !res.url) throw new Error("No stream URL");

            if (res.mode === 'hls' && typeof Hls !== 'undefined' && Hls.isSupported()) {
                this.hls = new Hls({
                    startLevel: -1,
                    capLevelToPlayerSize: false,
                    enableWorker: true,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60
                });
                this.hls.loadSource(res.url);
                this.hls.attachMedia(this.video);
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    this._startPlayback();
                });
            } else {
                this.video.src = res.url;
                this._startPlayback();
            }
        } catch (err) {
            console.error("Playback error:", err);
            this.showToast("Playback Error");
        }
    }

    _startPlayback() {
        if (this.currentMedia && this.currentMedia.last_position_seconds) {
            this.video.currentTime = this.currentMedia.last_position_seconds;
        }
        this.video.play().catch(() => {
            if (this.btnPlay) this.btnPlay.classList.add('pulse');
        });
    }

    previous() {
        if (this.queueIndex <= 0) return;
        this.queueIndex--;
        this._loadCurrent();
    }

    next() {
        if (this.queueIndex >= this.queue.length - 1) return;
        this.queueIndex++;
        this._loadCurrent();
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
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
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
            
            item.innerHTML = `
                <span class="queue-item-index">${String(index + 1).padStart(2, '0')}</span>
                <span class="queue-item-title">${media.title || 'Untitled'}</span>
                ${index === this.queueIndex ? '<i class="v-icon icon-play" style="width:16px; height:16px;"></i>' : ''}
            `;
            
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

    eject() {
        if (this.currentMedia && this.video.currentTime > 5) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.currentTime,
                completed: this.video.ended || (this.video.duration && this.video.currentTime / this.video.duration > 0.95),
                event_type: 'stop',
            }).catch(() => {});
        }
        this.modal.close();
    }

    toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen();
        else this.modal.requestFullscreen?.();
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

    setAspectRatio(mode) {
        this.video.style.objectFit = mode;
        const labels = { contain: 'Fit', cover: 'Zoom', fill: 'Stretch' };
        this.valRatio.textContent = labels[mode];
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
    }

    _onEnded() {
        if (this.currentMedia) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.duration,
                completed: true,
                event_type: 'complete',
            }).catch(() => {});
        }
        if (this.queueIndex < this.queue.length - 1) {
            setTimeout(() => { this.queueIndex++; this._loadCurrent(); }, 1000);
        }
    }

    _onLoaded() {
        if (this.transportTotal) this.transportTotal.textContent = this._formatTime(this.video.duration);
        
        const tapeDur = document.getElementById('tape-duration');
        if (tapeDur) tapeDur.textContent = this._formatTime(this.video.duration);
        
        const tapeRes = document.getElementById('tape-resolution');
        if (tapeRes) tapeRes.textContent = `${this.video.videoWidth}x${this.video.videoHeight}`;
        
        const tapeFormat = document.getElementById('tape-format');
        if (tapeFormat) tapeFormat.textContent = this.currentMedia?.video_codec?.toUpperCase() || 'VIDEO';

        const tapeQual = document.getElementById('tape-quality');
        if (tapeQual) tapeQual.textContent = this.video.videoHeight >= 1080 ? 'FHD' : (this.video.videoHeight >= 720 ? 'HD' : 'SD');
    }

    _updateTransport() {
        if (!this.video.duration) return;
        const pct = (this.video.currentTime / this.video.duration) * 100;
        if (this.transportFill) this.transportFill.style.width = `${pct}%`;
        if (this.transportCurrent) this.transportCurrent.textContent = this._formatTime(this.video.currentTime);

        const tapePos = document.getElementById('tape-position');
        if (tapePos) tapePos.textContent = this._formatTime(this.video.currentTime);

        if (this.currentMedia && Math.floor(this.video.currentTime) % 15 === 0 && this.video.currentTime > 5) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.currentTime,
                completed: false,
                event_type: 'progress',
            }).catch(() => {});
        }
    }

    _showControls() {
        this.modal.classList.add('controls-visible');
        clearTimeout(this.controlsTimer);
        this.controlsTimer = setTimeout(() => {
            if (!this.video.paused && !this.drawer.classList.contains('open') && !this.queueSheet?.classList.contains('open')) {
                this.hideControls();
            }
        }, 5000); // 5-second auto-hide
    }

    hideControls() {
        this.modal.classList.remove('controls-visible');
    }

    _cleanup() {
        if (this.hls) { this.hls.destroy(); this.hls = null; }
        this.video.src = '';
        this.video.load();
        if (this.transportFill) this.transportFill.style.width = '0%';
        this.currentMedia = null;
        this.toggleDrawer(false);
        this.toggleQueueSheet(false);
    }

    _formatTime(s) {
        if (!s || isNaN(s)) return '00:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
}
