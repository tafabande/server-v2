import { ApiClient } from "./api.js";
import { createElement, replaceChildren } from "./dom.js";
import { ExplorerManager } from "./explorer-manager.js";
import { flattenLibrary, summarizeLibrary } from "./formatters.js";
import { GalleryManager } from "./gallery-manager.js";
import { PlayerManager } from "./player-manager.js";
import { SocketClient } from "./socket-client.js";
import { UIManager } from "./ui-manager.js";

export class MediaHubApp {
    this.elements = this.collectElements();
    
    // Global error boundary for the JS app
    window.addEventListener("unhandledrejection", (event) => {
      console.error("Unhandled promise rejection:", event.reason);
      this.handleCriticalError(event.reason);
    });

    try {
      this.ui = new UIManager({
      banner: this.elements.statusBanner,
      bannerText: this.elements.statusBannerText,
      connectionPill: this.elements.connectionPill,
      activityLabel: this.elements.activityLabel,
      sessionRole: this.elements.sessionRole,
      toastRoot: this.elements.toastRoot,
      confirmDialog: this.elements.confirmDialog,
      confirmTitle: this.elements.confirmTitle,
      confirmMessage: this.elements.confirmMessage,
      confirmAccept: this.elements.confirmAccept,
      promptDialog: this.elements.promptDialog,
      promptForm: this.elements.promptForm,
      promptTitle: this.elements.promptTitle,
      promptMessage: this.elements.promptMessage,
      promptLabel: this.elements.promptLabel,
      promptInput: this.elements.promptInput,
      promptCancel: this.elements.promptCancel,
    });

    this.galleryManager = new GalleryManager({
      root: this.elements.galleryRoot,
      hero: {
        title: this.elements.heroTitle,
        description: this.elements.heroDescription,
        thumb: this.elements.heroThumb,
        badge: this.elements.heroBadge,
        play: this.elements.heroPlay,
        meta: this.elements.heroMetadata,
      },
      onPlay: (media) => this.playMedia(media),
    });

    this.playerManager = new PlayerManager({
      dialog: this.elements.playerModal,
      video: this.elements.playerVideo,
      title: this.elements.playerTitle,
      status: this.elements.playerStatus,
      onEvent: async (mediaId, payload) => {
        try {
          await this.api.recordPlayback(mediaId, payload);
        } catch {
          // Playback telemetry should not interrupt the player.
        }
      },
    });

    this.explorerManager = new ExplorerManager({
      root: this.elements.explorerRoot,
      pathLabel: this.elements.explorerPath,
      summaryLabel: this.elements.explorerSummary,
      onOpenDirectory: async (path) => this.openDirectory(path),
      onPlayMedia: async (path) => this.playFromPath(path),
      onRename: async (path) => this.renamePath(path),
      onDelete: async (path) => this.deletePath(path),
    });

    this.socketClient = new SocketClient({
      onMessage: async (message) => this.handleSocketMessage(message),
      onStateChange: (state) => this.handleSocketState(state),
    });

    this.attachEventListeners();
    this.renderDashboard();
    this.explorerManager.clear();
    this.updatePermissions();
    } catch (err) {
      console.error("MediaHub Initialization Failure:", err);
      this.handleCriticalError(err);
    }
  }

  handleCriticalError(err) {
    const loader = document.querySelector("#boot-loader");
    if (loader) {
      loader.innerHTML = `
        <div class="loader-content error">
          <h3>System Initialization Failed</h3>
          <p>${err.message || "An unknown error occurred during startup."}</p>
          <button onclick="window.location.reload()" class="ghost-button" style="margin-top: 1rem">Retry Connection</button>
        </div>
      `;
    }
  }

  collectElements() {
    return {
      authModal: document.querySelector("#auth-modal"),
      appShell: document.querySelector(".app-shell"),
      authError: document.querySelector("#auth-error"),
      loginForm: document.querySelector("#login-form"),
      usernameInput: document.querySelector("#username-input"),
      passwordInput: document.querySelector("#password-input"),
      sessionRole: document.querySelector("#session-role"),
      connectionPill: document.querySelector("#connection-pill"),
      activityLabel: document.querySelector("#activity-label"),
      brandTitle: document.querySelector("#brand-title"),
      libraryStatus: document.querySelector("#library-status"),
      librarySearch: document.querySelector("#library-search"),
      libraryHighlights: document.querySelector("#library-highlights"),
      explorerSearch: document.querySelector("#explorer-search"),
      explorerSummary: document.querySelector("#explorer-summary"),
      pinInput: document.querySelector("#pin-input"),
      rescanButton: document.querySelector("#rescan-button"),
      logoutButton: document.querySelector("#logout-button"),
      uploadInput: document.querySelector("#upload-input"),
      galleryRoot: document.querySelector("#gallery-root"),
      explorerRoot: document.querySelector("#explorer-root"),
      explorerPath: document.querySelector("#explorer-path"),
      heroTitle: document.querySelector("#hero-title"),
      heroDescription: document.querySelector("#hero-description"),
      heroThumb: document.querySelector("#hero-thumb"),
      heroBadge: document.querySelector("#hero-badge"),
      heroPlay: document.querySelector("#hero-play"),
      heroOpenFolder: document.querySelector("#hero-open-folder"),
      heroMetadata: document.querySelector("#hero-metadata"),
      goUpButton: document.querySelector("#go-up-button"),
      playerModal: document.querySelector("#player-modal"),
      playerVideo: document.querySelector("#player-video"),
      playerTitle: document.querySelector("#player-title"),
      playerStatus: document.querySelector("#player-status"),
      playerClose: document.querySelector("#player-close"),
      statusBanner: document.querySelector("#status-banner"),
      statusBannerText: document.querySelector("#status-banner-text"),
      confirmDialog: document.querySelector("#confirm-dialog"),
      confirmTitle: document.querySelector("#confirm-title"),
      confirmMessage: document.querySelector("#confirm-message"),
      confirmAccept: document.querySelector("#confirm-accept"),
      promptDialog: document.querySelector("#prompt-dialog"),
      promptForm: document.querySelector("#prompt-form"),
      promptTitle: document.querySelector("#prompt-title"),
      promptMessage: document.querySelector("#prompt-message"),
      promptLabel: document.querySelector("#prompt-label"),
      promptInput: document.querySelector("#prompt-input"),
      promptCancel: document.querySelector("#prompt-cancel"),
      toastRoot: document.querySelector("#toast-root"),
      statTitles: document.querySelector("#stat-titles"),
      statCollections: document.querySelector("#stat-collections"),
      statRuntime: document.querySelector("#stat-runtime"),
      statLocked: document.querySelector("#stat-locked"),
    };
  }

  attachEventListeners() {
    this.elements.loginForm.addEventListener("submit", async (event) => this.handleLogin(event));

    this.elements.heroPlay.addEventListener("click", async () => {
      if (this.galleryManager.featured) {
        await this.playMedia(this.galleryManager.featured);
      }
    });

    this.elements.heroOpenFolder.addEventListener("click", async () => this.openFeaturedFolder());

    this.elements.goUpButton.addEventListener("click", async () => {
      const parent = (this.state.listing && this.state.listing.parent !== undefined) ? this.state.listing.parent : undefined;
      if (parent === null || parent === undefined) return;
      await this.openDirectory(parent);
    });

    this.elements.playerClose.addEventListener("click", () => this.playerManager.close());

    this.elements.uploadInput.addEventListener("change", async (event) => {
      const [file] = event.target.files || [];
      if (!file) return;
      await this.handleUpload(file);
      event.target.value = "";
    });

    this.elements.rescanButton.addEventListener("click", async () => this.handleRescan());

    this.elements.logoutButton.addEventListener("click", () => {
      this.playerManager.close();
      this.clearSession({ message: "Session ended.", tone: "neutral" });
    });

    this.elements.librarySearch.addEventListener("input", (event) => {
      this.galleryManager.setQuery(event.target.value);
      this.updateLibraryStatus();
    });

    this.elements.explorerSearch.addEventListener("input", (event) => {
      this.explorerManager.setQuery(event.target.value);
    });
  }

  async bootstrap() {
    this.ui.setBanner("Waiting for authentication.", "neutral");
    this.ui.setActivity("Authenticate to load your local library and live sync feed.");
    this.ui.setConnectionState("disconnected");

    const token = window.localStorage.getItem("mediahub_token");
    if (!token) {
      this.elements.authModal.classList.add("active");
      document.querySelector("#boot-loader").style.display = "none";
      this.elements.appShell.style.opacity = "1";
      this.elements.appShell.style.pointerEvents = "auto";
      return;
    }

    this.api.setToken(token);
    this.state.token = token;
    try {
      this.state.user = await this.api.me();
      await this.hydrateSession();
      this.socketClient.connect();
    } catch {
      this.clearSession({
        message: "Saved session expired. Sign in again.",
        tone: "warning",
      });
    }
  }

  async hydrateSession() {
    this.elements.authModal.classList.remove("active");
    this.elements.authError.textContent = "";
    this.updatePermissions();
    this.ui.setActivity(`Signed in as ${this.state.user.username}. Syncing library and explorer.`);
    this.ui.setBanner("Syncing your library...", "info");

    await Promise.all([this.loadSettings(), this.synchronizeWorkspace()]);

    this.ui.setActivity(`Signed in as ${this.state.user.username}. Ready to browse.`);
    this.ui.setBanner("Library ready.", "success");
    
    // Reveal the app shell
    document.querySelector("#boot-loader").style.display = "none";
    this.elements.appShell.style.opacity = "1";
    this.elements.appShell.style.pointerEvents = "auto";
  }

  updatePermissions() {
    const role = (this.state.user && this.state.user.role) || "anonymous";
    this.ui.setSessionRole(this.state.user);
    this.elements.rescanButton.hidden = role !== "admin";
    this.elements.uploadInput.disabled = !this.state.user || role === "guest";
    this.explorerManager.setPermissions({
      canRename: ["admin", "family"].includes(role),
      canDelete: role === "admin",
    });
  }

  getPin() {
    return this.elements.pinInput.value.trim();
  }

  async loadSettings() {
    const payload = await this.api.getSettings();
    this.state.settings = payload.settings || {};
    const title = this.state.settings.branding_title || "MediaHub";
    this.elements.brandTitle.textContent = title;
    document.title = title;
  }

  async synchronizeWorkspace() {
    if (this.workspaceRefreshPromise) {
      return this.workspaceRefreshPromise;
    }

    this.workspaceRefreshPromise = (async () => {
      await Promise.all([this.refreshLibrary(), this.openDirectory(this.state.currentPath)]);
    })();

    try {
      await this.workspaceRefreshPromise;
    } finally {
      this.workspaceRefreshPromise = null;
    }
  }

  async refreshLibrary() {
    const library = await this.api.getLibrary();
    this.state.library = library;
    this.galleryManager.setLibrary(library);
    this.renderDashboard();
    this.updateLibraryStatus();
  }

  renderDashboard() {
    const summary = summarizeLibrary(this.state.library);
    this.elements.statTitles.textContent = String(summary.itemCount);
    this.elements.statCollections.textContent = String(summary.groupCount);
    this.elements.statRuntime.textContent = summary.runtimeLabel;
    this.elements.statLocked.textContent = String(summary.lockedCount);

    const highlightCards = [];
    if (!summary.itemCount) {
      highlightCards.push(
        createElement("article", {
          className: "highlight-card",
          children: [
            createElement("span", { className: "highlight-label", text: "Library empty" }),
            createElement("strong", { className: "highlight-value", text: "Upload media or run a rescan" }),
          ],
        }),
      );
    } else {
      highlightCards.push(
        createElement("article", {
          className: "highlight-card",
          children: [
            createElement("span", { className: "highlight-label", text: "Direct play" }),
            createElement("strong", { className: "highlight-value", text: `${summary.directCount} titles` }),
          ],
        }),
        createElement("article", {
          className: "highlight-card",
          children: [
            createElement("span", { className: "highlight-label", text: "Adaptive HLS" }),
            createElement("strong", { className: "highlight-value", text: `${summary.hlsCount} titles` }),
          ],
        }),
        createElement("article", {
          className: "highlight-card",
          children: [
            createElement("span", {
              className: "highlight-label",
              text: summary.topCategories[0] ? "Largest collection" : "Collections",
            }),
            createElement("strong", {
              className: "highlight-value",
              text: summary.topCategories[0]
                ? `${summary.topCategories[0].label} / ${summary.topCategories[0].count}`
                : `${summary.groupCount} rows`,
            }),
          ],
        }),
        createElement("article", {
          className: "highlight-card",
          children: [
            createElement("span", { className: "highlight-label", text: "Protected content" }),
            createElement("strong", {
              className: "highlight-value",
              text: `${summary.lockedCount} PIN / ${summary.adultCount} restricted`,
            }),
          ],
        }),
      );
    }

    replaceChildren(this.elements.libraryHighlights, highlightCards);
  }

  updateLibraryStatus() {
    if (!this.state.user) {
      this.elements.libraryStatus.textContent = "Waiting for authentication.";
      return;
    }

    const query = this.elements.librarySearch.value.trim();
    const visibleItems = this.galleryManager.visibleItems.length;
    const visibleGroups = this.galleryManager.visibleGroups.length;
    const totalItems = flattenLibrary(this.state.library).length;

    if (query) {
      this.elements.libraryStatus.textContent = `${visibleItems} titles across ${visibleGroups} collections match "${query}".`;
      return;
    }

    if (!totalItems) {
      this.elements.libraryStatus.textContent = "No indexed media found in shared_media/.";
      return;
    }

    this.elements.libraryStatus.textContent = `${totalItems} titles indexed across ${this.state.library.length} collections.`;
  }

  async openDirectory(path = "") {
    try {
      const listing = await this.api.browse(path, this.getPin());
      this.state.currentPath = listing.path;
      this.state.listing = listing;
      this.explorerManager.setListing(listing);
      this.ui.setActivity(`Browsing shared_media/${listing.path || ""}`);
      return listing;
    } catch (error) {
      this.handleError(error, {
        fallbackMessage: "Folder could not be opened.",
        bannerTone: "warning",
        notifyTone: "warning",
      });
      return null;
    }
  }

  async openFeaturedFolder() {
    const featured = this.galleryManager.featured;
    if (!featured) {
      await this.openDirectory(this.state.currentPath);
      return;
    }

    const folderPath = featured.relative_path.split("/").slice(0, -1).join("/");
    await this.openDirectory(folderPath);
  }

  async playMedia(media) {
    try {
      const stream = await this.api.stream(media.id, this.getPin());
      if (stream.status === "preparing") {
        this.ui.setBanner("System is preparing high-performance stream. Playback will start momentarily.", "info");
        this.ui.notify("Preparing adaptive stream...", "info");
      }
      this.playerManager.open(media, stream);
      this.ui.setActivity(`Playing ${media.title}`);
      if (stream.status !== "preparing") {
        this.ui.setBanner(`Now playing ${media.title}.`, "success");
      }
    } catch (error) {
      this.handleError(error, {
        fallbackMessage: "Playback could not start.",
      });
    }
  }

  async playFromPath(path) {
    const media = flattenLibrary(this.state.library).find((item) => item.relative_path === path);
    if (!media) {
      this.ui.notify("That file is not indexed as media yet. Run a rescan.", "warning");
      return;
    }
    await this.playMedia(media);
  }

  async renamePath(path) {
    const currentName = path.split("/").pop() || path;
    const newName = await this.ui.prompt({
      title: "Rename entry",
      message: `Update the name for ${currentName}.`,
      label: "New name",
      value: currentName,
    });
    if (!newName || newName === currentName) {
      return;
    }

    try {
      await this.api.rename(path, newName, this.getPin());
      await this.synchronizeWorkspace();
      this.ui.setBanner("Rename completed.", "success");
      this.ui.notify("Rename completed.", "success");
    } catch (error) {
      this.handleError(error, {
        fallbackMessage: "Rename failed.",
      });
    }
  }

  async deletePath(path) {
    const confirmed = await this.ui.confirm({
      title: "Delete entry",
      message: `Delete ${path}? This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      await this.api.delete(path, this.getPin());
      await this.synchronizeWorkspace();
      this.ui.setBanner("Delete completed.", "success");
      this.ui.notify("Delete completed.", "success");
    } catch (error) {
      this.handleError(error, {
        fallbackMessage: "Delete failed.",
      });
    }
  }

  async handleUpload(file) {
    this.ui.setBanner(`Uploading ${file.name}...`, "info");
    try {
      await this.api.upload(this.state.currentPath, file, this.getPin());
      await this.synchronizeWorkspace();
      this.ui.setBanner(`Uploaded ${file.name}.`, "success");
      this.ui.notify(`Uploaded ${file.name}.`, "success");
    } catch (error) {
      this.handleError(error, {
        fallbackMessage: "Upload failed.",
      });
    }
  }

  async handleRescan() {
    this.ui.setBusy(this.elements.rescanButton, true, "Scanning...");
    this.ui.setBanner("Rescanning the library...", "info");
    try {
      const result = await this.api.rescan();
      await this.synchronizeWorkspace();
      this.ui.setBanner(result.message, "success");
      this.ui.notify(result.message, "success");
    } catch (error) {
      this.handleError(error, {
        fallbackMessage: "Rescan failed.",
      });
    } finally {
      this.ui.setBusy(this.elements.rescanButton, false);
    }
  }

  async handleLogin(event) {
    event.preventDefault();
    const submitButton = this.elements.loginForm.querySelector('button[type="submit"]');
    this.elements.authError.textContent = "";
    this.ui.setBusy(submitButton, true, "Connecting...");
    this.ui.setBanner("Starting session...", "info");

    try {
      const tokenPayload = await this.api.login(
        this.elements.usernameInput.value.trim(),
        this.elements.passwordInput.value,
      );
      this.state.token = tokenPayload.access_token;
      this.api.setToken(this.state.token);
      window.localStorage.setItem("mediahub_token", this.state.token);
      this.state.user = await this.api.me();
      await this.hydrateSession();
      this.socketClient.connect();
      this.ui.notify(`Signed in as ${this.state.user.username}.`, "success");
    } catch (error) {
      this.elements.authError.textContent = error.message || "Login failed.";
      this.ui.setBanner(error.message || "Login failed.", "error");
    } finally {
      this.ui.setBusy(submitButton, false);
    }
  }

  async handleSocketMessage(message) {
    if (!this.state.token) return;

    if (message.type === "library-updated") {
      this.ui.setBanner(
        message.count ? `Library synced: ${message.count} media item(s) indexed.` : "Library updated.",
        "info",
      );
      await this.synchronizeWorkspace();
      return;
    }

    if (message.type === "settings-updated") {
      await this.loadSettings();
      this.ui.setBanner("System settings updated.", "info");
    }
  }

  handleSocketState(state) {
    this.state.socketState = state;
    this.ui.setConnectionState(state);

    if (!this.state.user) {
      return;
    }

    const activity = {
      connected: "Live sync connected.",
      connecting: "Connecting live sync...",
      reconnecting: "Live sync dropped. Retrying...",
      disconnected: "Live sync offline.",
    };
    this.ui.setActivity(activity[state] || "Live sync offline.");

    if (state === "reconnecting") {
      this.ui.setBanner("Live sync dropped. Retrying the connection...", "warning");
    }
  }

  handleError(
    error,
    { fallbackMessage = "Request failed.", bannerTone = "error", notifyTone = "error" } = {},
  ) {
    const message = (error && error.message) || fallbackMessage;
    if (error && error.status === 401) {
      this.ui.notify("Session expired. Sign in again.", "warning");
      this.clearSession({
        message: "Session expired. Sign in again.",
        tone: "warning",
      });
      return;
    }

    this.ui.setBanner(message, bannerTone);
    this.ui.notify(message, notifyTone);
  }

  clearSession({ message = "Disconnected.", tone = "neutral" } = {}) {
    this.playerManager.close();
    this.state.token = "";
    this.state.user = null;
    this.state.library = [];
    this.state.listing = null;
    this.state.currentPath = "";
    this.state.settings = {};
    this.workspaceRefreshPromise = null;
    this.api.setToken("");
    window.localStorage.removeItem("mediahub_token");
    this.socketClient.disconnect();
    this.elements.authModal.classList.add("active");
    this.elements.authError.textContent = "";
    this.elements.librarySearch.value = "";
    this.elements.explorerSearch.value = "";
    this.elements.pinInput.value = "";
    this.galleryManager.clear();
    this.explorerManager.clear();
    this.renderDashboard();
    this.updateLibraryStatus();
    this.updatePermissions();
    this.ui.setConnectionState("disconnected");
    this.ui.setActivity("Authenticate to load your local library and live sync feed.");
    this.ui.setBanner(message, tone);
  }
}
