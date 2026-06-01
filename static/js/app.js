/**
 * MediaHub — Main Application Entry Point
 */
export let api = null;
export let player = null;
export let router = null;

import { ApiClient } from './api.js';
import { SocketClient } from './socket-client.js';
import { PlayerManager } from './player-manager.js';
import { Router } from './router.js';

import { HomeView } from './views/home.js';
import { LibraryView } from './views/library.js';
import { AdminView } from './views/admin.js';
import { ExplorerView } from './views/explorer.js';
import { HistoryView } from './views/history.js';
import { ProfileView } from './views/profile.js';
import { LoginView } from './views/login.js';
import { FavoritesView } from './views/favorites.js';

class App {
    constructor() {
        this.api = new ApiClient();
        this.socket = null;
        this.player = null;
        this.user = JSON.parse(localStorage.getItem('mediahub_user') || 'null');
        this.token = localStorage.getItem('mediahub_token');

        if (this.token) {
            this.api.setToken(this.token);
        }

        // Apply theme preference on load
        if (this.user) {
            const theme = this.user.preferences?.theme || 'default';
            document.documentElement.setAttribute('data-theme', theme);
            this._updateThemeIcon(theme);
        } else {
            document.documentElement.setAttribute('data-theme', 'default');
            this._updateThemeIcon('default');
        }

        window.addEventListener('mediahub-unauthorized', () => {
            this.logout();
        });

        const routes = [
            { path: '/', view: async () => HomeView, requiresAuth: true },
            { path: '/library', view: async () => LibraryView, requiresAuth: true },
            { path: '/favorites', view: async () => FavoritesView, requiresAuth: true },
            { path: '/explorer', view: async () => ExplorerView, requiresAuth: true },
            { path: '/history', view: async () => HistoryView, requiresAuth: true },
            { path: '/admin', view: async () => AdminView, requiresAuth: true },
            { path: '/profile', view: async () => ProfileView, requiresAuth: true },
            { path: '/login', view: async () => LoginView, requiresAuth: false },
            { path: '*', view: async () => HomeView, requiresAuth: true }
        ];

        this.router = new Router(routes);
        this.init();
    }

    async init() {
        this.sidebar = document.getElementById('sidebar');
        this.viewTarget = document.getElementById('view-target');

        // Initialize VHS Player
        this.player = new PlayerManager();

        // Socket
        if (this.token) this.initSocket();

        // Check for R18 confirmation prompt if logged in
        this.checkR18SessionPrompt();

        // Nav
        await this.handleNavigation();

        // Hide boot loader
        const loader = document.getElementById('boot-loader');
        if (loader) loader.style.display = 'none';

        // Events
        window.addEventListener('popstate', () => this.handleNavigation());
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());

        // Global Shortcuts
        document.addEventListener('keydown', (e) => {
            const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;

            // Ctrl+K or '/' → search focus
            if (((e.ctrlKey || e.metaKey) && e.key === 'k') || (e.key === '/' && !isInput)) {
                e.preventDefault();
                const globalSearch = document.getElementById('global-search-input');
                if (globalSearch) {
                    globalSearch.focus();
                    globalSearch.select();
                }
            }

            // Space → Play/Pause
            if (e.code === 'Space' && !isInput) {
                e.preventDefault();
                this.player?.toggle();
            }

            // F → Fullscreen
            if (e.key.toLowerCase() === 'f' && !isInput) {
                e.preventDefault();
                this.player?.toggleFullscreen();
            }
        });

        // Scroll to Top Logic
        const scrollBtn = document.getElementById('scroll-top-btn');
        window.addEventListener('scroll', () => {
            if (window.scrollY > 500) scrollBtn?.classList.add('visible');
            else scrollBtn?.classList.remove('visible');
        }, { passive: true });

        scrollBtn?.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Global persistent search bar routing
        const globalSearch = document.getElementById('global-search-input');
        globalSearch?.addEventListener('input', async (e) => {
            const val = e.target.value;
            if (window.location.pathname !== '/library') {
                this.router.navigate('/library');
                // Allow view to render
                await new Promise(r => setTimeout(r, 150));
            }

            const libSearch = document.getElementById('lib-search');
            if (libSearch) {
                libSearch.value = val;
                libSearch.dispatchEvent(new Event('input'));
            }
        });

        // Share QR
        document.getElementById('btn-share-qr')?.addEventListener('click', () => this._showShareQR());

        // Theme Toggle
        document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'default';
            const nextTheme = currentTheme === 'light' ? 'default' : 'light';
            document.documentElement.setAttribute('data-theme', nextTheme);

            if (this.user) {
                this.user.preferences = this.user.preferences || {};
                this.user.preferences.theme = nextTheme;
                localStorage.setItem('mediahub_user', JSON.stringify(this.user));
                this.api.updateProfile({ preferences: this.user.preferences }).catch(() => { });
            }
            this._updateThemeIcon(nextTheme);
        });

        // Shortcuts Cheatsheet Modal
        document.getElementById('btn-shortcuts-help')?.addEventListener('click', () => {
            document.getElementById('shortcuts-dialog')?.showModal();
        });

        // Hamburger Menu (Mobile)
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const sidebarOverlay = document.getElementById('sidebar-overlay');

        const toggleSidebar = (force) => {
            if (!this.sidebar) return;
            const isOpen = force !== undefined ? force : !this.sidebar.classList.contains('mobile-open');
            this.sidebar.classList.toggle('mobile-open', isOpen);
            if (sidebarOverlay) sidebarOverlay.classList.toggle('active', isOpen);
        };

        mobileMenuBtn?.addEventListener('click', () => toggleSidebar());
        sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));

        // Auto close sidebar on nav link click in mobile
        document.querySelectorAll('.sidebar .nav-link').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 767) {
                    toggleSidebar(false);
                }
            });
        });

        // Highlight active nav link
        this.updateNavActive();

        // Update admin badge on load
        this.updateAdminBadge();

        // Real-time Request Notifications
        window.addEventListener('mediahub-socket-message', (e) => {
            const msg = e.detail;
            if (msg.type === 'request-updated') {
                const currentUser = JSON.parse(localStorage.getItem('mediahub_user') || '{}');

                // Alert standard user of status change
                if (currentUser && currentUser.id === msg.user_id) {
                    if (msg.request_type === 'adult_elevation' && msg.status === 'approved') {
                        currentUser.is_adult = true;
                        localStorage.setItem('mediahub_user', JSON.stringify(currentUser));
                        this.updateUI();
                    }

                    import('./utils.js').then(({ toast }) => {
                        let text = '';
                        if (msg.request_type === 'adult_elevation') {
                            text = `Your 18+ elevation request was ${msg.status}!`;
                        } else {
                            const folderName = msg.target_path ? msg.target_path.split('/').pop() : 'folder';
                            text = `Your access request for "${folderName}" was ${msg.status}!`;
                        }
                        if (msg.admin_comment) {
                            text += ` Reason: "${msg.admin_comment}"`;
                        }
                        toast(text, msg.status === 'approved' ? 'success' : msg.status === 'denied' ? 'error' : 'info');
                    });
                }

                // Alert admins of incoming pending requests
                if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'super-admin')) {
                    if (msg.status === 'pending') {
                        import('./utils.js').then(({ toast }) => {
                            toast(`New pending request received from user.`, 'info');
                        });
                    }
                    this.updateAdminBadge();
                }
            }
        });

        // Start real-time scan status polling
        this.pollScanStatus();

        // Register PWA Service Worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('Service Worker registered successfully:', reg.scope))
                    .catch(err => console.error('Service Worker registration failed:', err));
            });
        }
    }

    async _showShareQR() {
        const { QRGenerator } = await import('./qr-generator.js');
        const dialog = document.getElementById('share-dialog');
        const container = document.getElementById('qr-container');
        const urlEl = document.getElementById('share-url');
        const copyBtn = document.getElementById('btn-copy-url');

        const currentUrl = window.location.origin;
        urlEl.textContent = currentUrl;

        QRGenerator.generate(currentUrl, container);

        copyBtn.onclick = () => {
            navigator.clipboard.writeText(currentUrl);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        };

        dialog.showModal();
    }

    async updateAdminBadge() {
        const badge = document.getElementById('admin-notif-badge');
        if (!badge) return;
        if (!this.token || !this.user || !(this.user.role === 'admin' || this.user.role === 'super-admin')) {
            badge.style.display = 'none';
            return;
        }
        try {
            const requests = await this.api.getRequests();
            const pendingCount = requests.filter(r => r.status === 'pending').length;
            if (pendingCount > 0) {
                badge.textContent = pendingCount;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        } catch (e) {
            console.error("Failed to update admin badge", e);
        }
    }

    updateUI() {
        const isLoginPage = window.location.pathname === '/login';
        const isAuth = !!(this.token && this.user);
        const showNav = isAuth && !isLoginPage;

        if (this.sidebar) this.sidebar.hidden = !showNav;

        // Handle mobile top bar too
        const topbar = document.querySelector('.topbar-mobile');
        if (topbar) topbar.style.display = showNav ? 'flex' : 'none';

        if (showNav) {
            const isAdmin = this.user.role === 'admin' || this.user.role === 'super-admin';
            document.querySelectorAll('.admin-only').forEach(el => el.hidden = !isAdmin);
            const topUser = document.getElementById('topbar-user');
            if (topUser) topUser.textContent = this.user.username;
            this.updateAdminBadge();
        }
    }

    updateNavActive() {
        const path = window.location.pathname;
        document.querySelectorAll('.nav-link[data-link]').forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === path);
        });
    }

    async handleNavigation() {
        const path = window.location.pathname;
        const route = this.router.routes.find(r => r.path === path) ||
            this.router.routes.find(r => r.path === '*');

        if (route.requiresAuth && !this.token) {
            this.router.navigate('/login');
            return;
        }

        if (path === '/login' && this.token) {
            this.router.navigate('/');
            return;
        }

        await this.router.loadRoute(path);
        window.scrollTo(0, 0);
        this.updateUI();
        this.updateNavActive();
    }

    initSocket() {
        this.socket = new SocketClient({
            onMessage: (msg) => {
                window.dispatchEvent(new CustomEvent('mediahub-socket-message', { detail: msg }));
            },
            onStateChange: (state) => {
                console.log('Socket:', state);
            }
        });
        this.socket.connect();
    }

    logout() {
        localStorage.removeItem('mediahub_token');
        localStorage.removeItem('mediahub_user');
        sessionStorage.removeItem('r18_enabled');
        sessionStorage.removeItem('r18_prompted');
        window.location.href = '/login';
    }

    _updateThemeIcon(theme) {
        const iconEl = document.getElementById('theme-toggle-icon');
        const labelEl = document.querySelector('#btn-theme-toggle .nav-label');
        if (!iconEl) return;
        if (theme === 'light') {
            iconEl.textContent = '🌙';
            if (labelEl) labelEl.textContent = 'Dark Mode';
        } else {
            iconEl.textContent = '☀';
            if (labelEl) labelEl.textContent = 'Light Mode';
        }
    }

    checkR18SessionPrompt() {
        if (!this.token || !this.user) {
            sessionStorage.removeItem('r18_enabled');
            sessionStorage.removeItem('r18_prompted');
            return;
        }

        const isElevated = this.user.role === 'admin' || this.user.role === 'super-admin' || this.user.is_adult === true;
        if (!isElevated) {
            sessionStorage.setItem('r18_enabled', 'false');
            sessionStorage.setItem('r18_prompted', 'true');
            return;
        }

        if (sessionStorage.getItem('r18_prompted') === 'true') {
            return;
        }

        // Default to disabled while the prompt is open to secure the background view
        if (sessionStorage.getItem('r18_enabled') === null) {
            sessionStorage.setItem('r18_enabled', 'false');
        }

        // Show the dialog
        this._showR18PromptDialog();
    }

    _showR18PromptDialog() {
        let dialog = document.getElementById('r18-session-prompt-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'r18-session-prompt-dialog';
            dialog.className = 'glass-modal';
            dialog.style.maxWidth = '400px';
            document.body.appendChild(dialog);
        }

        dialog.innerHTML = `
            <div class="dialog-card text-center" style="padding: 32px 24px; position: relative; background: rgba(15, 10, 15, 0.95); border: 1px solid rgba(244, 63, 94, 0.25); box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(244, 63, 94, 0.15);">
                <div class="status-indicator warning" style="font-size: 3.5rem; margin-bottom: 20px; filter: drop-shadow(0 0 10px rgba(244, 63, 94, 0.4));">🔞</div>
                <h3 style="margin-bottom: 12px; font-family: 'Outfit', 'Inter', sans-serif; font-weight: 800; letter-spacing: -0.5px; color: #fff; background: linear-gradient(135deg, #fff 0%, #f43f5e 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Session Security</h3>
                <p class="text-muted text-sm" style="margin-bottom: 24px; color: #ccc; line-height: 1.6; font-size: 0.95rem;">
                    Your account is elevated. Would you like to enable <strong>18+ Restricted Content</strong> for this session?
                </p>
                <div class="dialog-actions" style="display: flex; gap: 12px; margin-top: 24px;">
                    <button class="btn btn-ghost" id="r18-no-btn" style="flex: 1; padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; font-weight: 600; background: rgba(255,255,255,0.05); color: #fff;">No, Restrict</button>
                    <button class="btn btn-accent" id="r18-yes-btn" style="flex: 1; padding: 12px; border: none; border-radius: 10px; font-weight: 600; background: linear-gradient(135deg, #f43f5e 0%, #be123c 100%); color: #fff; box-shadow: 0 4px 15px rgba(244, 63, 94, 0.4);">Yes, Enable</button>
                </div>
            </div>
        `;

        dialog.showModal();

        dialog.querySelector('#r18-no-btn').addEventListener('click', () => {
            sessionStorage.setItem('r18_enabled', 'false');
            sessionStorage.setItem('r18_prompted', 'true');
            dialog.close();
            window.location.reload();
        });

        dialog.querySelector('#r18-yes-btn').addEventListener('click', () => {
            sessionStorage.setItem('r18_enabled', 'true');
            sessionStorage.setItem('r18_prompted', 'true');
            dialog.close();
            window.location.reload();
        });

        dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
        });
    }

    async pollScanStatus() {
        if (!this.token) {
            const container = document.getElementById('sidebar-scan-status-container');
            if (container) container.style.display = 'none';
            return;
        }

        clearTimeout(this._scanTimer);

        if (document.hidden) {
            this._scanTimer = setTimeout(() => this.pollScanStatus(), 5000);
            return;
        }

        try {
            const status = await this.api.getScanStatus();
            const container = document.getElementById('sidebar-scan-status-container');
            const textEl = document.getElementById('sidebar-scan-text');

            if (container && textEl) {
                if (status.scanning) {
                    textEl.textContent = `Scanning: ${status.progress_percent}% (${status.files_scanned}/${status.files_total})`;
                    container.style.display = 'flex';
                    this._scanTimer = setTimeout(() => this.pollScanStatus(), 1000);
                } else {
                    container.style.display = 'none';
                    this._scanTimer = setTimeout(() => this.pollScanStatus(), 5000);
                }
            }
        } catch (e) {
            // Silently back off on network/server errors to prevent console spam
            this._scanTimer = setTimeout(() => this.pollScanStatus(), 10000);
        }
    }
}

const appInstance = new App();
api = appInstance.api;
player = appInstance.player;
router = appInstance.router;

export default appInstance;
