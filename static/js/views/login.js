/**
 * MediaHub — Login View
 */
import { api } from '../app.js';

export class LoginView {
    constructor(container) { this.container = container; }

    async render() {
        document.getElementById('sidebar').hidden = true;
        document.getElementById('main-area').style.marginLeft = '0';

        this.container.innerHTML = `
            <div class="auth-page">
                <div class="auth-card surface">
                    <h1>MediaHub</h1>
                    <p class="page-subtitle">Sign in to your media server</p>
                    <form id="login-form">
                        <div class="form-group">
                            <label for="login-user">Username</label>
                            <input id="login-user" class="input" type="text" placeholder="Username" autocomplete="username" autofocus required>
                        </div>
                        <div class="form-group">
                            <label for="login-pass">Password</label>
                            <input id="login-pass" class="input" type="password" placeholder="Password" autocomplete="current-password" required>
                        </div>
                        <p id="login-error" class="text-error" hidden></p>
                        <button type="submit" class="btn btn-accent" style="width: 100%; margin-top: 8px;">Sign In</button>
                    </form>
                    <div class="auth-footer">
                        <button id="guest-login" class="btn btn-ghost btn-sm">Continue as Guest</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('login-form').addEventListener('submit', (e) => this._handleLogin(e));
        document.getElementById('guest-login').addEventListener('click', () => this._guestLogin());
    }

    async _handleLogin(e) {
        e.preventDefault();
        const errEl = document.getElementById('login-error');
        errEl.hidden = true;

        const username = document.getElementById('login-user').value.trim();
        const password = document.getElementById('login-pass').value;

        if (!username || !password) {
            errEl.textContent = 'Please enter both fields.';
            errEl.hidden = false;
            return;
        }

        try {
            const data = await api.login(username, password);
            this._saveSession(data);
        } catch (err) {
            errEl.textContent = err.message || 'Login failed.';
            errEl.hidden = false;
        }
    }

    async _guestLogin() {
        try {
            const data = await api.login('guest', 'guest');
            this._saveSession(data);
        } catch (err) {
            const errEl = document.getElementById('login-error');
            errEl.textContent = 'Guest login unavailable.';
            errEl.hidden = false;
        }
    }

    _saveSession(data) {
        localStorage.setItem('mediahub_token', data.access_token);
        localStorage.setItem('mediahub_user', JSON.stringify(data.user));
        window.location.href = '/';
    }

    destroy() {
        document.getElementById('main-area').style.marginLeft = '';
    }
}
