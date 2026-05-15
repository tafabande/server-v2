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

        // Global Ctrl+K → search
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const search = document.querySelector('.search-bar .input');
                if (search) search.focus();
            }
        });

        // Highlight active nav link
        this.updateNavActive();
    }

    updateUI() {
        if (this.token && this.user) {
            this.sidebar.hidden = false;
            const isAdmin = this.user.role === 'admin' || this.user.role === 'super-admin';
            document.querySelectorAll('.admin-only').forEach(el => el.hidden = !isAdmin);
            const topUser = document.getElementById('topbar-user');
            if (topUser) topUser.textContent = this.user.username;
        } else {
            this.sidebar.hidden = true;
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
