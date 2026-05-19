/**
 * MediaHub — Modern Cinematic Video Player Manager
 */
import { api } from './app.js';
import { isAdultApproved, toast, confirm } from './utils.js';

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
        
        // Dynamic Theming State
        this.themeTimer = null;
        this.analyzerCanvas = document.createElement('canvas');
        this.analyzerCtx = this.analyzerCanvas.getContext('2d', { willReadFrequently: true });

        // Preview State
        // Zero-Latency Preload State
        this.preloadHls = null;
        this.preloadedMediaId = null;
        this.preloadVideo = document.createElement('video');
        this.preloadVideo.muted = true;
        
        this._lastProgressSecond = -1;

        this._bindElements();
        this._bindEvents();
        this._bindKeyboard();
        this._bindGestures();
        this._bindSeekPreview();
        
        // Throttling for seek preview
        this._lastSeekUpdateTime = 0;
        this._validDuration = 0;
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

        // Seek Preview Elements
        this.seekPreview = document.getElementById('seek-preview');
        this.previewVideo = document.getElementById('preview-video');
        this.previewTimeDisplay = document.getElementById('seek-preview-time');

        // Volume
        this.volumeBar = document.getElementById('volume-bar');
        this.volumeSegments = this.volumeBar?.querySelectorAll('.volume-seg');
    }

    _bindEvents() {
        this.btnPlay?.addEventListener('click', (e) => { e.stopPropagation(); this.togglePlay(); });
        this.btnPrev?.addEventListener('click', (e) => { e.stopPropagation(); this.previous(); });
        this.btnNext?.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
        this.btnShuffle?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleShuffle(); });
        this.btnQueueToggle?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleQueueSheet(); });
        this.btnBack?.addEventListener('click', (e) => { e.stopPropagation(); this.eject(); });
        this.btnSettings?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDrawer(); });

        this._boundUpdateTransport = () => this._updateTransport();
        this._boundPlay = () => {
            this._onPlayState(true);
            this._startThemeAnalysis();
        };
        this._boundPause = () => {
            this._onPlayState(false);
            this._stopThemeAnalysis();
        };
        this._boundEnded = () => this._onEnded();
        this._boundTimeUpdate = () => this._onTimeUpdate();
        this._boundLoaded = () => this._onLoaded();

        this.video.addEventListener('timeupdate', this._boundUpdateTransport);
        this.video.addEventListener('play', this._boundPlay);
        this.video.addEventListener('pause', this._boundPause);
        this.video.addEventListener('ended', this._boundEnded);
        this.video.addEventListener('timeupdate', this._boundTimeUpdate);
        this.video.addEventListener('loadedmetadata', this._boundLoaded);

        this.transportTrack?.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = this.transportTrack.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const dur = this._getDuration();
            if (dur > 1) {
                this.video.currentTime = pct * dur;
            }
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
                if (item.id === 'item-rename') {
                    this.toggleDrawer(false);
                    this._onRenameClick();
                }
                if (item.id === 'item-delete') {
                    this.toggleDrawer(false);
                    this._onDeleteClick();
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

        // Volume Bar click handling
        this.volumeSegments?.forEach((seg, i) => {
            seg.addEventListener('click', (e) => {
                e.stopPropagation();
                // segments are in reverse order in HTML (8 at top, 1 at bottom)
                const vol = (8 - i) / 8;
                this.setVolume(vol);
            });
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

    togglePlay() {
        if (this.isLoading || (!this.video.src && !this.hls)) return;
        
        if (this.video.paused) {
            this.video.play().catch(err => {
                console.warn("Play interrupted or failed:", err);
            });
        } else {
            this.video.pause();
        }
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
            document.body.classList.add('player-active');
        }
        
        this._loadCurrent();
    }

    async _loadCurrent() {
        const media = this.queue[this.queueIndex];
        if (!media) return;

        if (media.adult_only && !isAdultApproved()) {
            toast('18+ Content: Access denied.', 'error');
            this.eject();
            return;
        }

        this._cleanup();
        this.currentMedia = media;
        
        // Update UI
        if (this.tapeTitle) this.tapeTitle.textContent = media.title || 'Untitled';
        const sideTitle = document.getElementById('tape-title');
        if (sideTitle) sideTitle.textContent = media.title || 'Untitled';
        
        this._renderQueueSheet();
        this._showControls();

        this.isLoading = true;
        this.modal.classList.add('is-loading');

        try {
            this._upNextShown = false;
            this._prefetchedNext = false;
            
            // Adaptive Error Failover: Check if we can swap from preload
            if (this.preloadedMediaId === this.currentMedia.id && this.preloadHls) {
                console.log("Zero-Latency: Swapping to preloaded stream");
                this.hls = this.preloadHls;
                this.hls.detachMedia();
                this.hls.attachMedia(this.video);
                this.preloadHls = null;
                this.preloadedMediaId = null;
                this._startPlayback();
                return;
            }

            const res = await api.stream(this.currentMedia.id, { priority: true });
            if (!res || !res.url) throw new Error("No stream URL");

            if (res.mode === 'hls' && typeof Hls !== 'undefined' && Hls.isSupported()) {
                this._initMainStream(res.url, res.mode);
            } else {
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

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.warn("HLS Fatal Error:", data.type);
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        this.hls.startLoad();
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

    async _handleFailover() {
        if (!this.currentMedia) return;
        console.log("Adaptive Failover: Attempting direct stream fallback");
        try {
            // Force direct mode in backend or just use file endpoint if available
            const directUrl = `/api/media/${this.currentMedia.id}/file`;
            this.video.src = directUrl;
            this._startPlayback();
        } catch (e) {
            this.showToast("Playback Failure");
            this.eject();
        }
    }

    /**
     * Proactively trigger transcoding for the next item in the queue
     */
    async _prefetchNext() {
        if (this._prefetchedNext) return;
        if (this.queueIndex < this.queue.length - 1) {
            const nextMedia = this.queue[this.queueIndex + 1];
            if (nextMedia && nextMedia.stream_mode !== 'direct') {
                console.log("Adaptive Buffer: Pre-initializing background transcode for:", nextMedia.title);
                this._prefetchedNext = true;
                try {
                    const res = await api.stream(nextMedia.id, { priority: false });
                    
                    // Zero-Latency: Preload the next stream in a background HLS instance
                    if (res.mode === 'hls' && typeof Hls !== 'undefined' && Hls.isSupported()) {
                        this._preloadNext(res.url, nextMedia.id);
                    }
                } catch (e) {
                    this._prefetchedNext = false; // allow retry
                }
            }
        }
    }

    _preloadNext(url, mediaId) {
        if (this.preloadHls) {
            this.preloadHls.destroy();
        }
        
        console.log("Zero-Latency: Pre-buffering next item...");
        this.preloadHls = new Hls({
            startLevel: 0, // lowest for background pre-buffer
            maxBufferLength: 15,
            autoStartLoad: true
        });
        
        this.preloadedMediaId = mediaId;
        this.preloadHls.loadSource(url);
        this.preloadHls.attachMedia(this.preloadVideo);
    }

    _startPlayback() {
        this.isLoading = false;
        this.modal.classList.remove('is-loading');
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

    _getDuration() {
        if (this.video.duration && !isNaN(this.video.duration) && this.video.duration !== Infinity) {
            this._validDuration = this.video.duration;
            return this.video.duration;
        }
        if (this.currentMedia && this.currentMedia.duration_seconds) {
            return this.currentMedia.duration_seconds;
        }
        return this._validDuration > 0 ? this._validDuration : 1;
    }

    seek(seconds) {
        const dur = this._getDuration();
        if (dur <= 1) return;
        this.video.currentTime = Math.max(0, Math.min(dur, this.video.currentTime + seconds));
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

    _handleVideoEnd() {
        if (this.queueIndex < this.queue.length - 1) {
            this._showUpNextOverlay();
        } else {
            this.showToast('Playlist Finished');
            setTimeout(() => this.close(), 3000);
        }
    }

    _showUpNextOverlay() {
        const nextMedia = this.queue[this.queueIndex + 1];
        if (!nextMedia) return;

        const overlay = document.getElementById('up-next-overlay');
        if (!overlay) return;

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
                overlay.classList.remove('visible');
                this.next();
            }
        }, 1000);

        overlay.querySelector('.btn-cancel-next').onclick = () => {
            clearInterval(this._upNextInterval);
            overlay.classList.remove('visible');
        };

        overlay.querySelector('.btn-play-now').onclick = () => {
            clearInterval(this._upNextInterval);
            overlay.classList.remove('visible');
            this.next();
        };
    }

    eject() {
        if (this.currentMedia && this.video.currentTime > 5) {
            const dur = this._getDuration();
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.currentTime,
                completed: this.video.ended || (dur && this.video.currentTime / dur > 0.95),
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

    setVolume(val) {
        const vol = Math.max(0, Math.min(1, val));
        this.video.volume = vol;
        
        // Update visual segments (8 total)
        const activeCount = Math.round(vol * 8);
        this.volumeSegments?.forEach((seg, i) => {
            // segments are 0..7 (8 down to 1)
            seg.classList.toggle('active', (8 - i) <= activeCount);
        });

        this.showToast(`Volume: ${Math.round(vol * 100)}%`);
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
        const dur = this._getDuration();
        if (this.currentMedia) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: dur,
                completed: true,
                event_type: 'complete',
            }).catch(() => {});
        }
        this._handleVideoEnd();
    }

    _onTimeUpdate() {
        // If the UI element doesn't exist, stop executing the function
        if (!this.transportCurrent) {
            return;
        }

        const dur = this._getDuration();
        // Update seek bar etc (assumed existing logic or I'll add it)
        const pct = dur > 1 ? (this.video.currentTime / dur) * 100 : 0;
        if (this.transportFill) this.transportFill.style.width = `${pct}%`;
        
        if (this.transportCurrent) this.transportCurrent.textContent = this._formatTime(this.video.currentTime);
        if (this.transportTotal) this.transportTotal.textContent = this._formatTime(dur);

        // Intelligent Auto-Next Trigger
        if (dur > 30 && dur - this.video.currentTime < 10) {
            if (!this._upNextShown && this.queueIndex < this.queue.length - 1) {
                this._upNextShown = true;
                this._showUpNextOverlay();
            }
        }

        // Adaptive Buffer: Prefetch next item when 70% done
        if (dur > 0 && (this.video.currentTime / dur) > 0.7) {
            this._prefetchNext();
        }
    }

    _onLoaded() {
        const dur = this._getDuration();
        if (this.transportTotal) this.transportTotal.textContent = this._formatTime(dur);
        
        const tapeDur = document.getElementById('tape-duration');
        if (tapeDur) tapeDur.textContent = this._formatTime(dur);
        
        const tapeRes = document.getElementById('tape-resolution');
        if (tapeRes) tapeRes.textContent = `${this.video.videoWidth}x${this.video.videoHeight}`;
        
        const tapeFormat = document.getElementById('tape-format');
        if (tapeFormat) tapeFormat.textContent = this.currentMedia?.video_codec?.toUpperCase() || 'VIDEO';

        const tapeQual = document.getElementById('tape-quality');
        if (tapeQual) tapeQual.textContent = this.video.videoHeight >= 1080 ? 'FHD' : (this.video.videoHeight >= 720 ? 'HD' : 'SD');
    }

    _updateTransport() {
        const dur = this._getDuration();
        if (dur <= 1) return;
        const pct = (this.video.currentTime / dur) * 100;
        if (this.transportFill) this.transportFill.style.width = `${pct}%`;
        if (this.transportCurrent) this.transportCurrent.textContent = this._formatTime(this.video.currentTime);

        const tapePos = document.getElementById('tape-position');
        if (tapePos) tapePos.textContent = this._formatTime(this.video.currentTime);

        const currentSec = Math.floor(this.video.currentTime);
        if (this.currentMedia && currentSec % 15 === 0 && currentSec > 5 && currentSec !== this._lastProgressSecond) {
            this._lastProgressSecond = currentSec;
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
        // 1. Remove the event listeners first so they stop firing callbacks
        if (this.video) {
            if (this._boundUpdateTransport) this.video.removeEventListener('timeupdate', this._boundUpdateTransport);
            if (this._boundPlay) this.video.removeEventListener('play', this._boundPlay);
            if (this._boundPause) this.video.removeEventListener('pause', this._boundPause);
            if (this._boundEnded) this.video.removeEventListener('ended', this._boundEnded);
            if (this._boundTimeUpdate) this.video.removeEventListener('timeupdate', this._boundTimeUpdate);
            if (this._boundLoaded) this.video.removeEventListener('loadedmetadata', this._boundLoaded);
        }

        if (this.hls) { this.hls.destroy(); this.hls = null; }
        if (this.previewHls) { this.previewHls.destroy(); this.previewHls = null; }
        
        this._stopThemeAnalysis();
        
        this.video.src = '';
        this.video.load();

        if (this.previewVideo) {
            this.previewVideo.src = '';
            this.previewVideo.load();
        }

        if (this.transportFill) this.transportFill.style.width = '0%';
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

    _formatTime(s) {
        if (!s || isNaN(s)) return '00:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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
                if (data[i] + data[i+1] + data[i+2] > 60) {
                    r += data[i];
                    g += data[i+1];
                    b += data[i+2];
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
     * Professional Standard: Seek Preview (Frame-by-frame)
     */
    _bindSeekPreview() {
        if (!this.transportTrack || !this.seekPreview) return;

        this.transportTrack.addEventListener('mousemove', (e) => this._handleSeekMove(e));
        this.transportTrack.addEventListener('mouseleave', () => this._handleSeekLeave());
        this.transportTrack.addEventListener('mouseenter', () => {
            this.seekPreview.classList.add('visible');
        });
    }

    _handleSeekMove(e) {
        const dur = this._getDuration();
        if (dur <= 1) return;

        const rect = this.transportTrack.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seekTime = pct * dur;

        // Position preview
        this.seekPreview.style.left = `${pct * 100}%`;
        this.previewTimeDisplay.textContent = this._formatTime(seekTime);

        // Update preview frame (Throttled for performance)
        const now = Date.now();
        if (now - this._lastSeekUpdateTime > 50) { // Max 20fps preview seek
            if (this.previewVideo.readyState >= 1) {
                this.previewVideo.currentTime = seekTime;
                this._lastSeekUpdateTime = now;
            }
        }
    }

    _handleSeekLeave() {
        this.seekPreview.classList.remove('visible');
        this._lastSeekUpdateTime = 0;
    }

    _initPreviewStream(url) {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            if (this.previewHls) this.previewHls.destroy();
            this.previewHls = new Hls({
                autoStartLoad: true,
                startLevel: 0, // Low quality for preview
                capLevelToPlayerSize: true
            });
            this.previewHls.loadSource(url);
            this.previewHls.attachMedia(this.previewVideo);
        } else {
            this.previewVideo.src = url;
        }
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
            
            dialog.innerHTML = `
                <div class="dialog-card text-center" style="padding: 24px; background: rgba(18, 18, 18, 0.95); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);">
                    <h3 style="margin-bottom: 12px; color: #fff; font-size: 1.2rem;">Rename Media</h3>
                    <p class="text-muted text-sm" style="margin-bottom: 16px;">Modify the media display title below:</p>
                    <input type="text" id="rename-input" class="form-control" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(255, 255, 255, 0.05); color: #fff; font-size: 0.95rem; margin-bottom: 20px; box-sizing: border-box;" value="${currentTitle.replace(/"/g, '&quot;')}">
                    <div class="dialog-actions" style="display: flex; gap: 12px;">
                        <button class="btn btn-ghost w-100" id="rename-cancel" style="padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #fff; cursor: pointer;">Cancel</button>
                        <button class="btn btn-accent w-100" id="rename-save" style="padding: 10px; border-radius: 8px; border: none; background: var(--player-accent, #00aaff); color: #000; font-weight: 600; cursor: pointer; box-shadow: 0 0 10px var(--player-accent-glow);">Save</button>
                    </div>
                </div>
            `;
            
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
            const appModule = await import('./app.js');
            const activeApi = appModule.api || appModule.default?.api;
            await activeApi.renameMedia(this.currentMedia.id, newTitle);
            
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

            const appModule = await import('./app.js');
            const activeApi = appModule.api || appModule.default?.api;
            await activeApi.deleteMedia(mediaId);
            
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
}

