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
  }

  setToken(token) {
    this.token = token || "";
  }

  buildPath(path, query = {}) {
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return `${url.pathname}${url.search}`;
  }

  async request(path, options = {}) {
    const { headers: rawHeaders, json, query, ...requestOptions } = options;
    const headers = new Headers(rawHeaders || {});
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    if (json !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(this.buildPath(path, query), {
      ...requestOptions,
      headers,
      body: json !== undefined ? JSON.stringify(json) : requestOptions.body,
    });

    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("streamdrop-unauthorized"));
      }
      let detail = "Request failed.";
      try {
        const payload = await response.json();
        detail = payload.detail || detail;
      } catch {
        detail = response.statusText || detail;
      }
      throw new ApiError(detail, response.status);
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
  }

  async login(username, password) {
    return this.request("/api/auth/token", {
      method: "POST",
      body: new URLSearchParams({ username, password }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  async me() {
    return this.request("/api/auth/me");
  }

  async getLibrary() {
    return this.request("/api/media/library");
  }

  async browse(path = "", pin = "") {
    return this.request("/api/files", { query: { path, pin } });
  }

  async stream(mediaId, pin = "") {
    return this.request(`/api/media/${mediaId}/stream`, { query: { pin } });
  }

  async upload(path, file, pin = "") {
    const formData = new FormData();
    formData.append("upload_file", file);

    return this.request("/api/files/upload", {
      method: "POST",
      query: { path, pin },
      body: formData,
    });
  }

  async rename(path, newName, pin = "") {
    return this.request("/api/files/rename", {
      method: "POST",
      query: { pin },
      json: { path, new_name: newName },
    });
  }

  async delete(path, pin = "") {
    return this.request("/api/files/delete", {
      method: "POST",
      query: { pin },
      json: { path },
    });
  }

  async recordPlayback(mediaId, payload) {
    return this.request(`/api/media/${mediaId}/events`, {
      method: "POST",
      json: payload,
    });
  }

  async rescan() {
    return this.request("/api/media/rescan", { method: "POST" });
  }

  async getSettings() {
    return this.request("/api/system/settings");
  }
}
