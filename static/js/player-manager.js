/**
 * MediaHub — VHS/Synthwave Video Player Manager
 * Full custom controls with keyboard shortcuts and mobile gestures.
 */
import { api } from './app.js';

export class PlayerManager {
    constructor() {
        this.modal = document.getElementById('player-modal');
        this.video = document.getElementById('player-video');
        this.hls = null;
        this.currentMedia = null;
        this.queue = [];
        this.originalQueue = [];
        this.queueIndex = 0;
        this.isShuffle = false;
        this.controlsTimer = null;

        this._bindElements();
        this._bindEvents();
        this._bindKeyboard();
        this._bindMobileGestures();
    }

    _bindElements() {
        this.transportTrack = document.getElementById('transport-track');
        this.transportFill = document.getElementById('transport-fill');
        this.transportCurrent = document.getElementById('transport-current');
        this.transportTotal = document.getElementById('transport-total');

        this.tapeTitle = document.getElementById('tape-title');
        this.tapeFormat = document.getElementById('tape-format');
        this.tapeResolution = document.getElementById('tape-resolution');
        this.tapeDuration = document.getElementById('tape-duration');
        this.tapePosition = document.getElementById('tape-position');
        this.tapeQuality = document.getElementById('tape-quality');

        this.volumeBar = document.getElementById('volume-bar');
        this.playerStatus = document.getElementById('player-status');

        this.btnPlay = document.getElementById('btn-play');
        this.btnStop = document.getElementById('btn-stop');
        this.btnRew = document.getElementById('btn-rew');
        this.btnFf = document.getElementById('btn-ff');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');
        this.btnShuffle = document.getElementById('btn-shuffle');
        this.btnEject = document.getElementById('btn-eject');
        this.btnMute = document.getElementById('btn-mute');
        this.btnFullscreen = document.getElementById('btn-fullscreen');
    }

    _bindEvents() {
        this.btnPlay.addEventListener('click', () => this.togglePlay());
        this.btnStop.addEventListener('click', () => this.stop());
        this.btnRew.addEventListener('click', () => this.seek(-10));
        this.btnFf.addEventListener('click', () => this.seek(10));
        this.btnPrev.addEventListener('click', () => this.playPrevious());
        this.btnNext.addEventListener('click', () => this.playNext());
        this.btnShuffle.addEventListener('click', () => this.toggleShuffle());
        this.btnEject.addEventListener('click', () => this.eject());
        this.btnMute.addEventListener('click', () => this.toggleMute());
        this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

        this.video.addEventListener('timeupdate', () => this._updateTransport());
        this.video.addEventListener('play', () => this._onPlayState(true));
        this.video.addEventListener('pause', () => this._onPlayState(false));
        this.video.addEventListener('ended', () => this._onEnded());
        this.video.addEventListener('loadedmetadata', () => this._onLoaded());

        // Transport click to seek
        this.transportTrack.addEventListener('click', (e) => {
            const rect = this.transportTrack.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            this.video.currentTime = pct * this.video.duration;
        });

        // Volume segments click
        this.volumeBar?.addEventListener('click', (e) => {
            const seg = e.target.closest('.volume-seg');
            if (!seg) return;
            const level = parseInt(seg.dataset.seg) / 8;
            this.video.volume = level;
            this._updateVolumeLEDs();
        });

        // Show/hide controls on mouse movement
        this.modal.addEventListener('mousemove', () => this._showControls());
        this.modal.addEventListener('click', () => this._showControls());

        // Dialog close
        this.modal.addEventListener('close', () => this._cleanup());
    }

    _bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (!this.modal.open) return;
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.seek(-10);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.seek(10);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.video.volume = Math.min(1, this.video.volume + 0.125);
                    this._updateVolumeLEDs();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.video.volume = Math.max(0, this.video.volume - 0.125);
                    this._updateVolumeLEDs();
                    break;
                case 'n':
                case 'N':
                    this.playNext();
                    break;
                case 'p':
                case 'P':
                    this.playPrevious();
                    break;
                case 's':
                case 'S':
                    this.toggleShuffle();
                    break;
                case 'f':
                case 'F':
                    this.toggleFullscreen();
                    break;
                case 'm':
                case 'M':
                    this.toggleMute();
                    break;
                case 'Escape':
                    this.eject();
                    break;
            }
        });
    }

    _bindMobileGestures() {
        let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
        let lastTapTime = 0, lastTapX = 0;

        const screen = this.modal.querySelector('.player-screen');
        if (!screen) return;

        screen.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchStartTime = Date.now();
        }, { passive: true });

        screen.addEventListener('touchend', (e) => {
            const touch = e.changedTouches[0];
            const dx = touch.clientX - touchStartX;
            const dy = touch.clientY - touchStartY;
            const elapsed = Date.now() - touchStartTime;

            // Double-tap detection
            const now = Date.now();
            if (elapsed < 200 && Math.abs(dx) < 30 && Math.abs(dy) < 30) {
                if (now - lastTapTime < 300 && Math.abs(touch.clientX - lastTapX) < 50) {
                    const half = window.innerWidth / 2;
                    if (touch.clientX < half) this.seek(-10);
                    else this.seek(10);
                    lastTapTime = 0;
                    return;
                }
                lastTapTime = now;
                lastTapX = touch.clientX;
            }

            // Vertical swipe right side = volume
            if (elapsed < 400 && Math.abs(dy) > 60 && Math.abs(dx) < 40) {
                if (touchStartX > window.innerWidth * 0.6) {
                    const delta = dy < 0 ? 0.125 : -0.125;
                    this.video.volume = Math.max(0, Math.min(1, this.video.volume + delta));
                    this._updateVolumeLEDs();
                }
            }
        }, { passive: true });
    }

    play(mediaOrArray, startIndex = 0) {
        if (Array.isArray(mediaOrArray)) {
            this.originalQueue = [...mediaOrArray];
            this.queue = [...mediaOrArray];
            this.queueIndex = startIndex;
        } else {
            this.originalQueue = [mediaOrArray];
            this.queue = [mediaOrArray];
            this.queueIndex = 0;
        }

        if (this.isShuffle) {
            this.shuffleQueue();
        }

        this._loadCurrent();
    }

    async _loadCurrent() {
        if (this.queueIndex < 0 || this.queueIndex >= this.queue.length) return;
        const media = this.queue[this.queueIndex];
        
        // Clean up previous stream
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.video.src = '';
        
        this.currentMedia = media;
        this._showControls();

        // Update tape info
        this.tapeTitle.textContent = media.title || '—';
        this.tapeFormat.textContent = `${media.video_codec || '?'} / ${media.container || '?'}`;
        this.tapeResolution.textContent = media.width && media.height ? `${media.width}×${media.height}` : '—';
        this.tapeDuration.textContent = this._formatTime(media.duration_seconds || 0);
        this.tapeQuality.textContent = media.hls_status === 'ready' ? 'HLS' : 'DIRECT';

        this.playerStatus.textContent = 'Loading tape...';

        try {
            const stream = await api.stream(media.id);

            if (stream.mode === 'hls' && typeof Hls !== 'undefined' && Hls.isSupported()) {
                this.hls = new Hls({
                    maxBufferLength: 30,
                    enableWorker: true,
                });
                this.hls.loadSource(stream.url);
                this.hls.attachMedia(this.video);
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    this.video.play();
                });
                this.hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                    const level = this.hls.levels[data.level];
                    if (level) {
                        this.tapeQuality.textContent = `${Math.round(level.bitrate / 1000)}k`;
                    }
                });
                this.hls.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) {
                        this.playerStatus.textContent = `HLS Error: ${data.type}`;
                    }
                });
            } else {
                this.video.src = stream.url;
                this.video.play();
            }

            this.modal.showModal();
        } catch (err) {
            this.playerStatus.textContent = `Error: ${err.message}`;
            console.error('Player error:', err);
        }
    }

    playNext() {
        if (this.queueIndex < this.queue.length - 1) {
            this.queueIndex++;
            this._loadCurrent();
        } else {
            this.stop();
        }
    }

    playPrevious() {
        if (this.video.currentTime > 3) {
            this.video.currentTime = 0;
        } else if (this.queueIndex > 0) {
            this.queueIndex--;
            this._loadCurrent();
        }
    }

    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        this.btnShuffle?.classList.toggle('active', this.isShuffle);
        
        if (this.isShuffle) {
            this.shuffleQueue();
        } else {
            // Restore original queue order, but keep the current item playing
            const current = this.queue[this.queueIndex];
            this.queue = [...this.originalQueue];
            this.queueIndex = this.queue.indexOf(current);
            if (this.queueIndex === -1) this.queueIndex = 0;
        }
    }

    shuffleQueue() {
        if (this.queue.length <= 1) return;
        const current = this.queue[this.queueIndex];
        
        // Fisher-Yates shuffle starting from the next item
        // Wait, just shuffle the whole array and put current at index 0
        const itemsToShuffle = this.queue.filter(m => m !== current);
        for (let i = itemsToShuffle.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [itemsToShuffle[i], itemsToShuffle[j]] = [itemsToShuffle[j], itemsToShuffle[i]];
        }
        
        if (current) {
            this.queue = [current, ...itemsToShuffle];
        } else {
            this.queue = itemsToShuffle;
        }
        this.queueIndex = 0;
    }

    togglePlay() {
        if (this.video.paused) this.video.play();
        else this.video.pause();
    }

    stop() {
        this.video.pause();
        this.video.currentTime = 0;
        this._onPlayState(false);
    }

    seek(seconds) {
        if (!this.video.duration) return;
        this.video.currentTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    }

    eject() {
        // Save position before closing
        if (this.currentMedia && this.video.currentTime > 5) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.currentTime,
                completed: this.video.ended || (this.video.duration && this.video.currentTime / this.video.duration > 0.95),
                event_type: 'stop',
            }).catch(() => {});
        }

        this.modal.close();
    }

    toggleMute() {
        this.video.muted = !this.video.muted;
        this.btnMute.querySelector('.vhs-btn-icon').textContent = this.video.muted ? '🔇' : '🔊';
        this._updateVolumeLEDs();
    }

    toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen();
        else this.modal.requestFullscreen?.();
    }

    _onPlayState(playing) {
        this.btnPlay.querySelector('.vhs-btn-icon').textContent = playing ? '⏸' : '▶';
        this.btnPlay.querySelector('.vhs-btn-label').textContent = playing ? 'Pause' : 'Play';
        this.btnPlay.classList.toggle('active', playing);
        this.playerStatus.textContent = playing ? '▶ PLAY' : '⏸ PAUSED';
    }

    _onEnded() {
        this.playerStatus.textContent = '⏹ END OF TAPE';
        this.btnPlay.classList.remove('active');
        if (this.currentMedia) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.duration,
                completed: true,
                event_type: 'complete',
            }).catch(() => {});
        }
        
        if (this.queueIndex < this.queue.length - 1) {
            setTimeout(() => this.playNext(), 1500);
        }
    }

    _onLoaded() {
        this.transportTotal.textContent = this._formatTimeSm(this.video.duration);
        this.tapeDuration.textContent = this._formatTime(this.video.duration);
        this._updateVolumeLEDs();
    }

    _updateTransport() {
        if (!this.video.duration) return;
        const pct = (this.video.currentTime / this.video.duration) * 100;
        this.transportFill.style.width = `${pct}%`;
        this.transportCurrent.textContent = this._formatTimeSm(this.video.currentTime);
        this.tapePosition.textContent = this._formatTime(this.video.currentTime);

        // Periodic save
        if (this.currentMedia && Math.floor(this.video.currentTime) % 15 === 0 && this.video.currentTime > 5) {
            api.recordPlayback(this.currentMedia.id, {
                position_seconds: this.video.currentTime,
                completed: false,
                event_type: 'progress',
            }).catch(() => {});
        }
    }

    _updateVolumeLEDs() {
        const vol = this.video.muted ? 0 : this.video.volume;
        const activeLevels = Math.round(vol * 8);
        const segs = this.volumeBar.querySelectorAll('.volume-seg');

        segs.forEach(seg => {
            const level = parseInt(seg.dataset.seg);
            const isOn = level <= activeLevels;

            seg.classList.remove('on', 'green', 'yellow', 'red');
            if (isOn) {
                seg.classList.add('on');
                if (level <= 5) seg.classList.add('green');
                else if (level <= 7) seg.classList.add('yellow');
                else seg.classList.add('red');
            }
        });
    }

    _showControls() {
        this.modal.classList.add('controls-visible');
        clearTimeout(this.controlsTimer);
        this.controlsTimer = setTimeout(() => {
            if (!this.video.paused) {
                this.modal.classList.remove('controls-visible');
            }
        }, 3000);
    }

    _cleanup() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.video.src = '';
        this.video.load();
        this.transportFill.style.width = '0%';
        this.currentMedia = null;
        this.playerStatus.textContent = '';
    }

    _formatTime(s) {
        if (!s || isNaN(s)) return '00:00:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    _formatTimeSm(s) {
        if (!s || isNaN(s)) return '00:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
}
