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
import { PlaylistsView } from './views/playlists.js';
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

        window.addEventListener('mediahub-unauthorized', () => {
            this.logout();
        });

        const routes = [
            { path: '/', view: async () => HomeView, requiresAuth: true },
            { path: '/library', view: async () => LibraryView, requiresAuth: true },
            { path: '/favorites', view: async () => FavoritesView, requiresAuth: true },
            { path: '/explorer', view: async () => ExplorerView, requiresAuth: true },
            { path: '/playlists', view: async () => PlaylistsView, requiresAuth: true },
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
                const search = document.querySelector('.search-bar .input, #lib-search, #explorer-search');
                if (search) {
                    search.focus();
                    search.select();
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

        // Share QR
        document.getElementById('btn-share-qr')?.addEventListener('click', () => this._showShareQR());

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
        window.location.href = '/login';
    }
}

const appInstance = new App();
api = appInstance.api;
player = appInstance.player;
router = appInstance.router;

export default appInstance;
