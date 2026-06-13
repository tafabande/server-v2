/**
 * MediaHub — Login View
 */
import { api, router } from '../app.js';

export class LoginView {
    constructor(container) { 
        this.container = container; 
        this.focusTimer = null;
    }

    async render() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.hidden = true;
        
        const mainArea = document.getElementById('main-area');
        if (mainArea) mainArea.style.marginLeft = '0';

        let videoUrl = '/static/wifey.mp4';
        let allowGuest = false;

        try {
            if (api.getPublicSettings) {
                const res = await api.getPublicSettings();
                if (res && res.settings) {
                    if (res.settings.login_video_url) {
                        videoUrl = res.settings.login_video_url;
                    }
                    if (res.settings.allow_guest_login === 'true' || res.settings.allow_guest_login === true) {
                        allowGuest = true;
                    }
                }
            }
        } catch (e) {
            // Ignore error if endpoint doesn't exist yet
        }

        let users = [];
        try {
            const res = await api.getPublicUsers();
            if (Array.isArray(res)) {
                users = res;
            } else {
                console.warn("Unexpected response for public users:", res);
            }
        } catch (e) {
            console.warn("Failed to fetch public users", e);
        }

        this.container.innerHTML = `
            <div class="auth-page">
                <video class="auth-video-bg" autoplay loop muted playsinline></video>
                <div class="auth-card" id="login-container">
                    <h1 style="margin-bottom: 24px; letter-spacing: -0.05em; text-align: center;">Who's watching?</h1>
                    
                    <div class="user-grid" id="user-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 16px; margin-bottom: 24px;">
                        ${users.map(u => `
                            <div class="user-profile flex flex-col items-center gap-2 cursor-pointer hover:scale-105 transition-transform" data-username="${u.username}">
                                <img src="${u.avatar_url}" alt="${u.username}" class="w-20 h-20 rounded-full border-2 border-transparent hover:border-primary object-cover bg-surface-variant">
                                <span class="text-on-surface font-medium">${u.username}</span>
                            </div>
                        `).join('')}
                    </div>

                    <form id="login-form" style="display: none;">
                        <div class="flex items-center gap-3 mb-6">
                            <button type="button" id="btn-back-to-users" class="p-2 -ml-2 text-on-surface hover:text-primary transition-colors focus:outline-none">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"></path>
                                </svg>
                            </button>
                            <img id="selected-user-avatar" src="" class="w-10 h-10 rounded-full border border-white/10 object-cover bg-surface-variant">
                            <span id="selected-user-name" class="text-lg font-semibold text-white"></span>
                        </div>
                        
                        <input id="login-user" type="hidden">
                        <div class="form-group">
                            <label for="login-pass">Password or PIN</label>
                            <input id="login-pass" class="input" type="password" placeholder="Enter password..." autocomplete="current-password" required>
                        </div>
                        <p id="login-error" class="text-error" hidden></p>
                        <button type="submit" class="btn btn-accent" style="width: 100%; margin-top: 8px;">Sign In</button>
                    </form>
                    
                    <div class="auth-footer" id="auth-footer">
                        ${allowGuest ? '<button id="guest-login" class="btn btn-ghost btn-sm">Continue as Guest</button>' : ''}
                    </div>
                </div>
            </div>
        `;

        const video = this.container.querySelector('.auth-video-bg');
        if (video && videoUrl) video.src = videoUrl;

        this.container.addEventListener('submit', (e) => {
            if (e.target.id === 'login-form') {
                this._handleLogin(e);
            }
        });

        this.container.addEventListener('click', (e) => {
            const guestBtn = e.target.closest('#guest-login');
            if (guestBtn) {
                this._guestLogin(guestBtn);
                return;
            }

            const userProfile = e.target.closest('.user-profile');
            if (userProfile) {
                const username = userProfile.dataset.username;
                const avatar = userProfile.querySelector('img').src;
                this._showPasswordForm(username, avatar);
                return;
            }

            const backBtn = e.target.closest('#btn-back-to-users');
            if (backBtn) {
                this._showUserGrid();
                return;
            }
        });
    }

    _showPasswordForm(username, avatarUrl) {
        const grid = this.container.querySelector('#user-grid');
        const form = this.container.querySelector('#login-form');
        const title = this.container.querySelector('h1');
        
        if (grid) grid.style.display = 'none';
        if (form) form.style.display = 'block';
        if (title) title.style.display = 'none';

        const userInput = this.container.querySelector('#login-user');
        const passInput = this.container.querySelector('#login-pass');
        const nameDisplay = this.container.querySelector('#selected-user-name');
        const avatarDisplay = this.container.querySelector('#selected-user-avatar');
        const errEl = this.container.querySelector('#login-error');

        if (userInput) userInput.value = username;
        if (nameDisplay) nameDisplay.textContent = username;
        if (avatarDisplay) avatarDisplay.src = avatarUrl;
        if (errEl) errEl.hidden = true;
        if (passInput) {
            passInput.value = '';
            passInput.focus();
        }
    }

    _showUserGrid() {
        const grid = this.container.querySelector('#user-grid');
        const form = this.container.querySelector('#login-form');
        const title = this.container.querySelector('h1');
        
        if (grid) grid.style.display = 'grid';
        if (form) form.style.display = 'none';
        if (title) title.style.display = 'block';
    }

    async _handleLogin(e) {
        e.preventDefault();
        const errEl = this.container.querySelector('#login-error');
        if (errEl) errEl.hidden = true;

        const userInput = this.container.querySelector('#login-user');
        const passInput = this.container.querySelector('#login-pass');
        
        const username = userInput ? userInput.value.trim() : '';
        const password = passInput ? passInput.value : '';

        if (!username || !password) {
            if (errEl) {
                errEl.textContent = 'Please enter both fields.';
                errEl.hidden = false;
            }
            return;
        }

        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.textContent : 'Sign In';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Authenticating...';
        }

        try {
            const data = await api.login(username, password);
            await this._saveSession(data);
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message || 'Login failed.';
                errEl.hidden = false;
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }

    async _guestLogin(btn) {
        if (!btn) return;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Connecting...';

        const errEl = this.container.querySelector('#login-error');

        try {
            const data = await api.login('guest', 'guest');
            await this._saveSession(data);
        } catch (err) {
            if (errEl) {
                errEl.textContent = 'Guest login unavailable.';
                errEl.hidden = false;
            }
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    async _saveSession(data) {
        localStorage.setItem('mediahub_token', data.access_token);
        localStorage.setItem('mediahub_user', JSON.stringify(data.user));
        
        try {
            await window.appInstance.init();
            router.navigate('/');
        } catch (err) {
            localStorage.removeItem('mediahub_token');
            localStorage.removeItem('mediahub_user');

            const errEl = document.getElementById('login-error');
            if (errEl) {
                errEl.textContent = 'Session initialization failed.';
                errEl.hidden = false;
            }
            throw err;
        }
    }

    destroy() {
        if (this.focusTimer) {
            clearTimeout(this.focusTimer);
        }
        // Ensure sidebar is unhidden when navigating away from login (crucial for mobile)
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.hidden = false;
        
        const mainArea = document.getElementById('main-area');
        if (mainArea) mainArea.style.marginLeft = '';
    }
}
