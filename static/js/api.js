export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class ApiClient {
  constructor() {
    this.token = "";
    this.inFlight = new Map();
    this.cache = new Map();
  }

  setToken(token) { this.token = token || ""; }

  buildPath(path, query = {}) {
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return `${url.pathname}${url.search}`;
  }

  async request(path, options = {}) {
    const { headers: rawHeaders, json, query, signal, ttl = 0, ...requestOptions } = options;
    const method = (options.method || "GET").toUpperCase();
    const isGET = method === "GET";
    const isMutation = !isGET && method !== "HEAD";
    const cacheKey = `${method}:${path}:${JSON.stringify(json || "")}:${JSON.stringify(query || "")}`;

    if (isGET && ttl > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.data;
      }
    }

    if (this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    const promise = (async () => {
      const headers = new Headers(rawHeaders || {});
      // We are now using cookie-based auth natively via credentials: 'same-origin'
      if (json !== undefined) headers.set("Content-Type", "application/json");
      if (sessionStorage.getItem('r18_enabled') === 'false') {
        headers.set("X-Disable-R18", "true");
      }

      if (!isGET && method !== "HEAD") {
        if (!headers.has("Idempotency-Key") && !headers.has("X-Idempotency-Key")) {
          const idKey = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
          headers.set("Idempotency-Key", idKey);
        }
      }

      try {
        const response = await fetch(this.buildPath(path, query), {
          ...requestOptions,
          headers,
          signal,
          credentials: "same-origin",
          body: json !== undefined ? JSON.stringify(json) : requestOptions.body,
        });

        if (!response.ok) {
          if (response.status === 401) {
            window.dispatchEvent(new CustomEvent("mediahub-unauthorized"));
          }
          let detail = "Request failed.";
          try {
            const body = await response.json();
            if (Array.isArray(body.detail)) {
              detail = body.detail.map(e => `${e.loc[e.loc.length - 1]}: ${e.msg}`).join(', ');
            } else {
              detail = body.detail || detail;
            }
          } catch { }
          throw new ApiError(detail, response.status);
        }

        if (response.status === 204) return null;
        const ct = response.headers.get("content-type") || "";
        return ct.includes("application/json") ? response.json() : response.text();
      } finally {
        if (isMutation) {
          this.inFlight.delete(cacheKey);
        }
      }
    })();

    if (isMutation) {
      this.inFlight.set(cacheKey, promise);
    }

    return promise;
  }

  // === Auth ===
  login(username, password) {
    return this.request("/api/auth/token", {
      method: "POST",
      body: new URLSearchParams({ username, password }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }
  me() { return this.request("/api/auth/me"); }

  // === Media ===
  getLibrary(params = {}) { return this.request("/api/media/library", { query: params }); }
  getVideosByType(params = {}) { return this.request("/api/media/library", { query: params }); }
  getSmartHome() { return this.request("/api/media/smart/home"); }
  getHeroContent() { return this.request("/api/media/home/hero"); }
  getHomeRows(offset = 0) { return this.request("/api/media/home/rows", { query: { offset } }); }
  getSearch(q) { return this.request("/api/media/search", { query: { q } }); }
  async stream(mediaId, pin = "", priority = true) {
    const res = await this.request(`/api/media/${mediaId}/stream`, { query: { pin, priority } });
    if (res && res.url && this.token) {
      res.url += (res.url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(this.token)}`;
    }
    return res;
  }
  recordPlayback(mediaId, payload) { return this.request(`/api/media/${mediaId}/events`, { method: "POST", json: payload }); }
  rescan() { return this.request("/api/media/rescan", { method: "POST" }); }
  toggleFavorite(mediaId) { return this.request(`/api/media/${mediaId}/favorite`, { method: "POST" }); }
  getFavorites() { return this.request("/api/media/favorites"); }
  deleteMedia(mediaId) { return this.request(`/api/media/${mediaId}`, { method: "DELETE" }); }
  renameMedia(mediaId, title) { return this.request(`/api/media/${mediaId}/rename`, { method: "POST", json: { title } }); }
  getScanStatus() { return this.request("/api/media/scan-status"); }
  optimizeDatabase() { return this.request("/api/system/optimize", { method: "POST" }); }
  clearHLSCache() { return this.request("/api/system/clear-hls", { method: "POST" }); }
  clearThumbsCache() { return this.request("/api/system/clear-thumbs", { method: "POST" }); }
  getRecentErrors() { return this.request("/api/system/recent-errors"); }


  // === History & Continue ===
  getHistory() { return this.request("/api/media/history"); }
  clearHistory() { return this.request("/api/media/history", { method: "DELETE" }); }
  getContinueWatching() { return this.request("/api/media/continue"); }

  // === Files ===
  browse(path = "", pin = "") { return this.request("/api/files", { query: { path, pin } }); }
  upload(path, file, pin = "") {
    const fd = new FormData(); fd.append("upload_file", file);
    return this.request("/api/files/upload", { method: "POST", query: { path, pin }, body: fd });
  }
  rename(path, newName, pin = "") { return this.request("/api/files/rename", { method: "POST", query: { pin }, json: { path, new_name: newName } }); }
  deleteFile(path, pin = "") { return this.request("/api/files/delete", { method: "POST", query: { pin }, json: { path } }); }
  getFolderSettings(path) { return this.request("/api/files/settings", { query: { path } }); }
  updateFolderSettings(path, settings) { return this.request("/api/files/settings", { method: "POST", query: { path }, json: settings }); }

  // === Requests ===
  getRequests() { return this.request("/api/requests"); }
  submitRequest(type, targetPath = null) { return this.request("/api/requests", { method: "POST", json: { request_type: type, target_path: targetPath } }); }
  processRequest(requestId, status, comment = null) { return this.request(`/api/requests/${requestId}/action`, { method: "POST", json: { status, admin_comment: comment } }); }

  // === Playlists ===
  getPlaylists() { return this.request("/api/playlists"); }
  createPlaylist(title, description = "") { return this.request("/api/playlists", { method: "POST", json: { title, description } }); }
  getPlaylist(id) { return this.request(`/api/playlists/${id}`); }
  deletePlaylist(id) { return this.request(`/api/playlists/${id}`, { method: "DELETE" }); }
  addToPlaylist(id, mediaId) { return this.request(`/api/playlists/${id}/items`, { method: "POST", json: { media_id: mediaId } }); }
  removeFromPlaylist(id, itemId) { return this.request(`/api/playlists/${id}/items/${itemId}`, { method: "DELETE" }); }

  // === Users (admin) ===
  getUsers() { return this.request("/api/users"); }
  createUser(data) { return this.request("/api/users", { method: "POST", json: data }); }
  updateUser(id, data) { return this.request(`/api/users/${id}`, { method: "PUT", json: data }); }
  deleteUser(id) { return this.request(`/api/users/${id}`, { method: "DELETE" }); }
  resetUserPassword(id, newPassword) { return this.request(`/api/users/${id}/reset-password`, { method: "POST", json: { new_password: newPassword } }); }

  // === Webhooks ===
  getWebhooks() { return this.request("/api/webhooks"); }
  createWebhook(data) { return this.request("/api/webhooks", { method: "POST", json: data }); }
  updateWebhook(id, data) { return this.request(`/api/webhooks/${id}`, { method: "PATCH", json: data }); }
  deleteWebhook(id) { return this.request(`/api/webhooks/${id}`, { method: "DELETE" }); }

  // === Profile ===
  updateProfile(data) { return this.request("/api/users/me/profile", { method: "PUT", json: data }); }
  changePassword(current, newPw) { return this.request("/api/users/me/password", { method: "PUT", json: { current_password: current, new_password: newPw } }); }

  // === System ===
  getMetrics() { return this.request("/api/system/metrics"); }
  getSessions() { return this.request("/api/system/sessions"); }
  getSettings() { return this.request("/api/system/settings"); }
  getAudit() { return this.request("/api/system/audit"); }
}
