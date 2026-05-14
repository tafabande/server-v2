/**
 * MediaHub Production Entry Point
 */
import { ApiClient } from './api.js';
import { SocketClient } from './socket-client.js';
import { PlayerManager } from './player-manager.js';
import { Router } from './router.js';

// Views
import { HomeView } from './views/home.js';
import { AdminView } from './views/admin.js';
import { ExplorerView } from './views/explorer.js';
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

        // Global Auth Guard: Catch 401s from the API and force logout
        window.addEventListener('mediahub-unauthorized', () => {
            console.warn('Session expired or user not found. Redirecting to login...');
            this.logout();
        });

        const routes = [
            { path: '/', view: async () => HomeView, requiresAuth: true },
            { path: '/library', view: async () => HomeView, requiresAuth: true },
            { path: '/explorer', view: async () => ExplorerView, requiresAuth: true },
            { path: '/admin', view: async () => AdminView, requiresAuth: true },
            { path: '/profile', view: async () => ProfileView, requiresAuth: true },
            { path: '/login', view: async () => LoginView, requiresAuth: false },
            { path: '*', view: async () => HomeView, requiresAuth: true }
        ];

        this.router = new Router(routes);
        this.init();
    }

    async init() {
        this.setupGlobalElements();
        
        // Initialize Player
        this.player = new PlayerManager({
            dialog: document.getElementById('player-modal'),
            video: document.getElementById('player-video'),
            title: document.getElementById('player-title'),
            status: document.getElementById('player-status'),
            onEvent: (mediaId, payload) => this.api.recordPlayback(mediaId, payload)
        });

        // Initialize Socket if authed
        if (this.token) {
            this.initSocket();
        }

        // Handle navigation and auth checks
        await this.handleNavigation();
        
        // Hide initial boot loader
        const loader = document.getElementById('boot-loader');
        if (loader) loader.style.display = 'none';
        
        // Event listeners for router navigation
        window.addEventListener('popstate', () => this.handleNavigation());
        
        // Handle global logout
        document.getElementById('logout-button').addEventListener('click', () => this.logout());
    }

    setupGlobalElements() {
        this.sidebar = document.querySelector('.sidebar');
        this.shell = document.querySelector('.app-shell');
        this.updateUI();
    }

    updateUI() {
        if (this.token && this.user) {
            this.sidebar.hidden = false;
            if (this.user.role === 'admin' || this.user.role === 'super-admin') {
                document.querySelectorAll('.admin-only').forEach(el => el.hidden = false);
            }
        } else {
            this.sidebar.hidden = true;
        }
    }

    async handleNavigation() {
        const path = window.location.pathname;
        const route = this.router.routes.find(r => r.path === path) || this.router.routes.find(r => r.path === '*');

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
    }

    initSocket() {
        this.socket = new SocketClient({
            onMessage: (msg) => {
                // Broadcast to views
                window.dispatchEvent(new CustomEvent('mediahub-socket-message', { detail: msg }));
            },
            onStateChange: (state) => {
                console.log('Socket state:', state);
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

// Global instance for singleton pattern
const appInstance = new App();
export default appInstance;
export const api = appInstance.api;
export const player = appInstance.player;
export const router = appInstance.router;
