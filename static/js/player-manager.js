export class PlayerManager {
  constructor({ dialog, video, title, status, onEvent }) {
    this.dialog = dialog;
    this.video = video;
    this.title = title;
    this.status = status;
    this.onEvent = onEvent;
    this.currentMedia = null;
    this.lastReportedSecond = 0;
    this.hlsInstance = null;

    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });

    this.video.addEventListener("timeupdate", () => {
      if (!this.currentMedia) return;
      const currentSecond = Math.floor(this.video.currentTime || 0);
      if (currentSecond - this.lastReportedSecond >= 10) {
        this.lastReportedSecond = currentSecond;
        this.onEvent(this.currentMedia.id, {
          position_seconds: currentSecond,
          completed: false,
          event_type: "progress",
        });
      }
    });

    this.video.addEventListener("ended", () => {
      if (!this.currentMedia) return;
      this.onEvent(this.currentMedia.id, {
        position_seconds: this.video.duration || 0,
        completed: true,
        event_type: "complete",
      });
    });

    this.video.addEventListener("error", () => {
      this.status.textContent = "Playback failed to load. Try again or rescan the library.";
    });
  }

  open(media, stream) {
    this.close();
    this.currentMedia = media;
    this.lastReportedSecond = 0;
    this.title.textContent = media.title;
    this.video.poster = media.thumbnail_path || "/static/placeholder.svg";

    if (stream.mode === "hls" && window.Hls && typeof window.Hls.isSupported === "function" && window.Hls.isSupported()) {
      this.hlsInstance = new window.Hls();
      this.hlsInstance.loadSource(stream.url);
      this.hlsInstance.attachMedia(this.video);
      this.status.textContent = "Adaptive HLS playback";
    } else {
      this.video.src = stream.url;
      this.status.textContent =
        stream.mode === "direct" ? "Direct file playback" : "Native HLS playback";
    }

    if (!this.dialog.open) {
      this.dialog.showModal();
    }

    this.video.play().catch(() => {
      this.status.textContent = "Playback is ready. Press play if autoplay was blocked.";
    });
  }

  close() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.removeAttribute("poster");
    this.video.load();
    this.destroyHls();
    this.currentMedia = null;
    this.lastReportedSecond = 0;
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  destroyHls() {
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
  }
}
