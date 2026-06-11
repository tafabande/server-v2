// static/js/api.js

/**
 * ApiClient handles all API interactions, including authentication and token management.
 */
export class ApiClient {
    constructor() {
        this.baseUrl = '/api';
        // The token should be managed dynamically, perhaps refreshed,
        // and ideally stored securely (e.g., HttpOnly cookie for web apps, or a more robust client-side storage for SPAs).
        // For simplicity and to match player-manager's usage, we'll assume localStorage for now.
        this.token = localStorage.getItem('jwt_token');
    }

    // Method to update the token, useful after login/refresh
    setToken(newToken) {
        this.token = newToken;
        if (newToken) {
            localStorage.setItem('jwt_token', newToken);
        } else {
            localStorage.removeItem('jwt_token');
        }
    }

    async _fetch(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers,
        });
        if (!response.ok) {
            if (response.status === 401) {
                // Handle unauthorized access: clear token, maybe redirect to login
                this.setToken(null);
                // Optionally, trigger a global event or redirect:
                // window.location.href = '/login';
            }
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    // Methods inferred from player-manager.js usage
    async recordPlayback(mediaId, payload) {
        return this._fetch(`/media/${mediaId}/events`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async stream(mediaId, quality = null, preferHls = true) {
        const params = new URLSearchParams();
        if (quality) params.append('quality', quality);
        if (preferHls) params.append('prefer_hls', 'true');
        return this._fetch(`/media/${mediaId}/stream?${params.toString()}`);
    }

    async toggleFavorite(mediaId) {
        return this._fetch(`/media/${mediaId}/favorite`, { method: 'POST' });
    }

    async renameMedia(mediaId, newTitle) {
        return this._fetch(`/media/${mediaId}/rename`, {
            method: 'POST',
            body: JSON.stringify({ new_title: newTitle }),
        });
    }

    async deleteMedia(mediaId) {
        return this._fetch(`/media/${mediaId}`, { method: 'DELETE' });
    }

    async likeMedia(mediaId) {
        return this._fetch(`/media/${mediaId}/like`, { method: 'POST' });
    }
}