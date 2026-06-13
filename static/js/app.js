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
import { themeManager } from './theme-manager.js';
import { toast, persistNsfwPreference, syncNsfwFromUser, prefetchThumbnails, clearContentCaches, showModal } from './utils.js';

import { getSidebarHTML, getDialogsHTML } from './components/uiElements.js';
import { getPlayerHTML } from './components/playerUI.js';

import { HomeView } from './views/home.js';
import { LibraryView } from './views/library.js';
import { AdminView } from './views/admin.js';
import { HistoryView } from './views/history.js';
import { ProfileView } from './views/profile.js';
import { LoginView } from './views/login.js';
import { UploadView } from './views/upload.js';
import { FavoritesView } from './views/favorites.js';
import { PlaylistsView } from './views/playlists.js';
import { ShortiesView } from './views/shorties.js';

class ObservableState {
    constructor(initialState = {}) {
        this.state = initialState;
        this.listeners = new Set();
    }
    get() { return this.state; }
    set(newState) {
        this.state = { ...this.state, ...newState };
        this.listeners.forEach(l => l(this.state));
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

class App {
    constructor() {
        window.appInstance = this;
        this.api = new ApiClient();
        this.socket = null;
        this.player = null;
        this.user = JSON.parse(localStorage.getItem('mediahub_user') || 'null');
        this.token = localStorage.getItem('mediahub_token');

        if (this.user) {
            syncNsfwFromUser(this.user);
        }

        this.store = new ObservableState({
            user: this.user,
            token: this.token,
            r18Enabled: sessionStorage.getItem('r18_enabled') === 'true'
        });

        this.user = this.store.get().user;
        this.token = this.store.get().token;

        this.store.subscribe(state => {
            this.user = state.user;
            this.token = state.token;
            if (this.els) {
                this.updateUI();
            }
        });

        if (this.token) {
            this.api.setToken(this.token);
        }

        themeManager.init(this.user, this.api);

        window.addEventListener('mediahub-unauthorized', () => {
            this.logout();
        });

        // Global Error Boundaries
        window.addEventListener('error', (e) => this._handleGlobalError(e.error || e.message));
        window.addEventListener('unhandledrejection', (e) => this._handleGlobalError(e.reason));

        const makeLibView = (fmt, options = {}) => class extends LibraryView {
            constructor(c) {
                super(c);
                this._fixedFormat = fmt;
                this._modeKey = options.storageKey || fmt;
                this._titleOverride = options.title || (fmt === 'movies_series' ? 'Movies' : null);
                this._currentPath = options.forceInitialFilter
                    ? ''
                    : (localStorage.getItem(`lib_${this._modeKey}_current_path`) || "");
                this._movieFilter = options.forceInitialFilter
                    ? (options.initialFilter || 'all')
                    : (localStorage.getItem(`lib_${this._modeKey}_filter`) || options.initialFilter || 'all');
                if (options.forceInitialFilter) {
                    localStorage.setItem(`lib_${this._modeKey}_filter`, this._movieFilter);
                    localStorage.setItem(`lib_${this._modeKey}_current_path`, '');
                }
                this.hlsJsPlayer = player.hlsJsPlayer; // Expose hls.js for future direct control
            }

            _mediaType() {
                if (this._fixedFormat !== 'movies_series') {
                    return this._fixedFormat;
                }
                return this._movieFilter === 'all' ? 'movies_series' : this._movieFilter;
            }

            async render() {
                await super.render();
                if (this._fixedFormat === 'movies_series') {
                    this._renderFilterBar();
                }
            }

            async _loadPath(path) {
                this._currentPath = path;
                localStorage.setItem(`lib_${this._modeKey}_current_path`, path);
                this._renderBreadcrumbs();

                const target = document.getElementById('lib-content');
                if (target) {
                    target.innerHTML = `
                        <div class="skeleton-grid fade-in">
                            ${Array(8).fill().map(() => `
                                <div class="skeleton-card">
                                    <div class="skeleton-poster shimmer-bg"></div>
                                    <div class="skeleton-title shimmer-bg"></div>
                                </div>
                            `).join('')}
                        </div>
                    `;
                }

                try {
                    let endpoint = `/media/folders?path=${encodeURIComponent(String(path))}`;
                    const type = this._mediaType();
                    if (type) endpoint += `&type=${encodeURIComponent(type)}`;

                    const res = await (typeof api.request === 'function' ? api.request("/api/media/folders", { query: { path: String(path), type: type } }) : api._fetch(endpoint));
                    this._folders = res.folders || [];
                    this._items = res.items || [];

                    prefetchThumbnails(this._items, 10);

                    this._renderContent();
                } catch (err) {
                    const target = document.getElementById('lib-content');
                    if (target) {
                        target.innerHTML =
                            `<div class="empty-state">
                                <div class="empty-icon">Y"?</div>
                                <h3>Connection Error</h3>
                                <p>${err.message}</p>
                            </div>`;
                    }
                }
            }

            _setMovieFilter(filter) {
                this._movieFilter = filter;
                localStorage.setItem(`lib_${this._modeKey}_filter`, filter);
                this._currentPath = '';
                localStorage.setItem(`lib_${this._modeKey}_current_path`, '');
                window.scrollTo(0, 0);
                this.render().then(() => {
                    if (typeof this._loadPath === 'function') {
                        this._loadPath(this._currentPath);
                    }
                });
            }

            _renderFilterBar() {
                const header = this.container.querySelector('.view-header');
                if (!header) return;

                let bar = this.container.querySelector('#movies-filter-bar');
                if (!bar) {
                    bar = document.createElement('div');
                    bar.id = 'movies-filter-bar';
                    header.insertAdjacentElement('afterend', bar);
                }

                bar.className = 'movie-filter-bar surface mb-md';
                bar.innerHTML = `
                    <div class="movie-filter-bar-head">
                        <div>
                            <div class="section-title" style="margin-bottom:4px;">Category</div>
                            <div class="text-muted text-xs">Series is filtered inside Movies instead of living on its own tab.</div>
                        </div>
                        <div class="tabs movie-filter-tabs">
                            <button class="tab ${this._movieFilter === 'all' ? 'active' : ''}" data-movie-filter="all">All</button>
                            <button class="tab ${this._movieFilter === 'movies' ? 'active' : ''}" data-movie-filter="movies">Movies</button>
                            <button class="tab ${this._movieFilter === 'series' ? 'active' : ''}" data-movie-filter="series">Series</button>
                        </div>
                    </div>
                `;

                bar.querySelectorAll('[data-movie-filter]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const filter = e.currentTarget.dataset.movieFilter;
                        if (filter && filter !== this._movieFilter) {
                            this._setMovieFilter(filter);
                        }
                    });
                });
            }
        };

        const routes = [
            { path: '/', view: async () => HomeView, requiresAuth: true },
            { path: '/playlists', view: async () => PlaylistsView, requiresAuth: true },
            { path: '/shorties', view: async () => ShortiesView, requiresAuth: true },
            { path: '/library', view: async () => LibraryView, requiresAuth: true }, // General Library view
            { path: '/history', view: async () => HistoryView, requiresAuth: true },
            { path: '/upload', view: async () => LibraryView, requiresAuth: true },
            { path: '/explorer', view: async () => LibraryView, requiresAuth: true },
            { path: '/admin', view: async () => AdminView, requiresAuth: true },
            { path: '/profile', view: async () => ProfileView, requiresAuth: true },
            { path: '/login', view: async () => LoginView, requiresAuth: false },
            { path: '*', view: async () => HomeView, requiresAuth: true }
        ];

        this.router = new Router(routes);
        this.init();
    }

    async init() {
        // --- UI Injection ---
        // Inject sidebar inside #app-root right before #main-area
        const mainArea = document.getElementById('main-area');
        if (mainArea && !document.getElementById('sidebar')) {
            mainArea.insertAdjacentHTML('beforebegin', getSidebarHTML());
        }
        // Inject overlays and dialogs at the end of body
        if (!document.getElementById('sidebar-overlay')) {
            document.body.insertAdjacentHTML('beforeend', getDialogsHTML());
        }
        // Inject player modal at the end of body
        if (!document.getElementById('player-modal')) {
            document.body.insertAdjacentHTML('beforeend', getPlayerHTML());
        }

        this.els = {
            sidebar: document.getElementById('sidebar'),
            sidebarOverlay: document.getElementById('sidebar-overlay'),
            scrollTopBtn: document.getElementById('scroll-top-btn'),
            globalSearch: document.getElementById('global-search-input'),
            btnShareQr: document.getElementById('btn-share-qr'),
            btnShortcutsHelp: document.getElementById('btn-shortcuts-help'),
            shortcutsDialog: document.getElementById('shortcuts-dialog'),
            mobileMenuBtn: document.getElementById('mobile-menu-btn'),
            topbarMobile: document.getElementById('topbar-mobile'),
            topbarUser: document.getElementById('topbar-user'),
            pageTitle: document.getElementById('page-title'),
            adminNotifBadge: document.getElementById('admin-notif-badge'),
            scanStatusContainer: document.getElementById('scan-status-container'),
            scanText: document.getElementById('scan-text'),
            btnNsfwToggle: document.getElementById('btn-nsfw-toggle'),
            nsfwToggleIcon: document.getElementById('nsfw-toggle-icon'),
            nsfwToggleLabel: document.getElementById('nsfw-toggle-label'),
        };

        this.sidebar = this.els.sidebar;
        this.viewTarget = document.getElementById('view-target');

        // Initialize VHS Player
        this.player = new PlayerManager();
        const pModal = document.getElementById('player-modal');
        if (pModal) {
            pModal.showModal = function () {
                this.classList.add('active');
                document.body.classList.add('player-active');
            };
            pModal.close = function () {
                this.classList.remove('active');
                document.body.classList.remove('player-active');
            };
        }

        // Sync Fullscreen with the browser fullscreen API
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
            this.player?.toggleFullscreen();
        });

        // Socket
        if (this.token) this.initSocket();

        // Nav
        if (this.token) {
            try {
                const freshUser = await this.api.me();
                localStorage.setItem('mediahub_user', JSON.stringify(freshUser));
                this.store.set({ user: freshUser });
                syncNsfwFromUser(freshUser);
            } catch (err) {
                console.error("Failed to refresh user profile:", err);
            }

        // Auto-scan if library is entirely empty
        try {
            const libCheck = await this.api.getLibrary({ per_page: 1 });
            if (!libCheck || !libCheck.items || libCheck.items.length === 0) {
                this.api.rescan().then(() => {
                    clearContentCaches();
                }).catch(() => {});
            }
        } catch (e) {}
        }

        this.checkR18SessionPrompt();
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
                const searchInput = document.getElementById('home-search') || document.getElementById('lib-search');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }

            // Space → Play/Pause
            if (e.code === 'Space' && !isInput) {
                e.preventDefault();
                this.player?.toggle();
            }

            // F → Fullscreen
            if (e.key && e.key.toLowerCase() === 'f' && !isInput) {
                e.preventDefault();
                this.player?.toggleFullscreen();
            }
        });

        // Scroll to Top Logic
        window.addEventListener('scroll', () => {
            if (window.scrollY > 500) this.els.scrollTopBtn?.classList.add('visible');
            else this.els.scrollTopBtn?.classList.remove('visible');
        }, { passive: true });

        this.els.scrollTopBtn?.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Global persistent search bar routing
        this.els.globalSearch?.addEventListener('input', async (e) => {
            const val = e.target.value;
            if (window.location.pathname !== '/library') {
                this.router.navigate('/library');
                await new Promise(resolve => {
                    const handler = (ev) => {
                        if (ev.detail.path === '/library') {
                            window.removeEventListener('route-loaded', handler);
                            resolve();
                        }
                    };
                    window.addEventListener('route-loaded', handler);
                });
            }

            const libSearch = document.getElementById('lib-search');
            if (libSearch) {
                libSearch.value = val;
                libSearch.dispatchEvent(new Event('input'));
            }
        });

        // Share QR
        this.els.btnShareQr?.addEventListener('click', () => this._showShareQR());
        document.getElementById('btn-share-close')?.addEventListener('click', () => {
            document.getElementById('share-dialog')?.close();
        });

        // Mobile Search trigger
        document.getElementById('mobile-search-trigger')?.addEventListener('click', () => {
            document.getElementById('global-search-input')?.focus();
        });

        // SFW mode toggle (on = hide 18+ content)
        this.els.btnNsfwToggle?.addEventListener('change', async () => {
            const sfwOn = this.els.btnNsfwToggle.checked;
            const nextNsfw = !sfwOn;
            try {
                const user = await persistNsfwPreference(nextNsfw);
                this.store.set({ r18Enabled: nextNsfw, user });
                clearContentCaches();
                this.updateUI();

                toast(sfwOn ? 'SFW Mode: Showing Safe Content Only' : 'NSFW Mode: Showing All Content', 'success');

                await this.handleNavigation();
            } catch (err) {
                this.els.btnNsfwToggle.checked = !sfwOn;
                toast(err.message || 'Failed to update content filter', 'error');
            }
        });

        // Shortcuts Cheatsheet Modal
        this.els.btnShortcutsHelp?.addEventListener('click', () => {
            this.els.shortcutsDialog?.showModal();
        });

        // Re-organize nav bar, group by type and use, combine history & analytics
        const navContainer = document.querySelector('.sidebar-nav');
        if (navContainer && !navContainer.dataset.organized) {
            navContainer.dataset.organized = 'true';

            const existingLinks = Array.from(navContainer.querySelectorAll('.nav-link'));
            const linkMap = {};
            existingLinks.forEach(l => {
                const href = l.getAttribute('href');
                linkMap[href] = l;
            });

            const createLink = (href, icon, label, className = '') => {
                if (linkMap[href]) {
                    if (className) linkMap[href].classList.add(...className.split(' '));
                    return linkMap[href];
                }
                const el = document.createElement('a');
                el.href = href;
                el.className = `nav-link ${className}`;
                el.setAttribute('data-link', '');
                el.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>`;
                return el;
            };

            linkMap['/'] = createLink('/', '🏠', 'Home');
            linkMap['/library'] = createLink('/library', '📚', 'Library');
            linkMap['/shorties'] = createLink('/shorties', '📱', 'Shorties');
            linkMap['/playlists'] = createLink('/playlists', '🗂️', 'Playlists');
            linkMap['/history'] = createLink('/history', '⏱️', 'History');
            linkMap['/admin'] = createLink('/admin', '📊', 'Analytics', 'admin-only');
            linkMap['/profile'] = createLink('/profile', '👤', 'Profile');

            const renderGroup = (title, hrefs) => {
                const group = document.createElement('div');
                group.className = 'nav-group';

                const titleEl = document.createElement('div');
                titleEl.className = 'nav-group-title text-xs text-muted';
                titleEl.style.cssText = 'padding: 16px 16px 8px; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; font-size: 0.75rem;';
                titleEl.textContent = title;
                group.appendChild(titleEl);

                hrefs.forEach(href => {
                    if (href === 'nsfw-toggle') {
                        const wrap = document.getElementById('nsfw-toggle-wrap');
                        if (wrap) {
                            group.appendChild(wrap);
                        }
                    } else if (linkMap[href]) {
                        group.appendChild(linkMap[href]);
                    }
                });
                return group;
            };

            navContainer.innerHTML = '';

            navContainer.appendChild(renderGroup('Discover', ['/', 'nsfw-toggle', '/shorties']));
            navContainer.appendChild(renderGroup('My Media', ['/library', '/playlists']));
            navContainer.appendChild(renderGroup('Activity & Analytics', ['/history', '/admin']));
            navContainer.appendChild(renderGroup('Settings', ['/profile']));

            if (this.els.adminNotifBadge && linkMap['/admin']) {
                linkMap['/admin'].appendChild(this.els.adminNotifBadge);
            }
        }

        // Hamburger Menu (Mobile)
        const toggleSidebar = (force) => {
            if (!this.els.sidebar) return;
            const isOpen = force !== undefined ? force : !this.els.sidebar.classList.contains('mobile-open');
            this.els.sidebar.classList.toggle('mobile-open', isOpen);
            if (this.els.sidebarOverlay) this.els.sidebarOverlay.classList.toggle('active', isOpen);
        };

        this.els.mobileMenuBtn?.addEventListener('click', () => toggleSidebar());
        this.els.sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));

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
                const currentUser = this.store.get().user || {};

                // Alert standard user of status change
                if (currentUser && currentUser.id === msg.user_id) {
                    if (msg.request_type === 'adult_elevation' && msg.status === 'approved') {
                        currentUser.is_adult = true;
                        localStorage.setItem('mediahub_user', JSON.stringify(currentUser));
                        this.store.set({ user: currentUser });
                        clearContentCaches(); // Clear home cache when user's adult status changes
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
            // Unregister any active service workers to prevent caching issues during development
            navigator.serviceWorker.getRegistrations().then(function (registrations) {
                for (let registration of registrations) {
                    registration.unregister();
                }
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
            if (navigator.clipboard) {
                navigator.clipboard.writeText(currentUrl);
            } else {
                const el = document.createElement('textarea');
                el.value = currentUrl;
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
            }
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        };

        dialog.showModal();
    }

    async updateAdminBadge() {
        const badge = this.els.adminNotifBadge;
        if (!badge) return;
        if (!this.token || !this.user || !(this.user.role === 'admin' || this.user.role === 'super-admin')) {
            badge.style.display = 'none';
            return;
        }
        try {
            const res = await this.api.getRequests();
            const requests = Array.isArray(res) ? res : (res?.items || []);
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

        if (this.els.sidebar) this.els.sidebar.hidden = !showNav;

        // Handle mobile top bar too
        if (this.els.topbarMobile) this.els.topbarMobile.style.display = showNav ? 'flex' : 'none';

        if (showNav) {
            const isAdmin = this.user.role === 'admin' || this.user.role === 'super-admin';
            document.querySelectorAll('.admin-only').forEach(el => el.hidden = !isAdmin);
            if (this.els.topbarUser) this.els.topbarUser.textContent = this.user.username;
            this.updateAdminBadge();

            // Handle NSFW sidebar button visibility and text state
            const isAdult = this.user.is_adult === true || this.user.is_adult === 1 || isAdmin;
            if (this.els.btnNsfwToggle) {
                const wrap = document.getElementById('nsfw-toggle-wrap');
                if (isAdult) {
                    if (wrap) wrap.style.display = 'flex';
                    else this.els.btnNsfwToggle.style.display = 'flex';

                    const isNsfwEnabled = sessionStorage.getItem('r18_enabled') === 'true';
                    if (this.els.nsfwToggleLabel) {
                        this.els.nsfwToggleLabel.textContent = isNsfwEnabled ? 'NSFW Only' : 'SFW Only';
                    }
                    this.els.btnNsfwToggle.checked = !isNsfwEnabled;
                } else {
                    if (wrap) wrap.style.display = 'none';
                    else this.els.btnNsfwToggle.style.display = 'none';
                }
            }
        }

        this.updateNavActive();
    }

    updateNavActive() {
        const path = window.location.pathname;
        document.querySelectorAll('.nav-link[data-link]').forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === path);
        });

        // Update Dynamic Title
        const titleMap = {
            '/': 'Home', '/library': 'Library', '/upload': 'Upload', '/explorer': 'Upload', '/admin': 'Insights', '/history': 'History', '/profile': 'Profile',
            '/series': 'Movies', '/videos': 'Videos', '/shorties': 'Shorties', '/playlists': 'Playlists'
        };
        if (this.els.pageTitle) { // The title for /upload will be handled by UploadView
            this.els.pageTitle.textContent = titleMap[path] || 'Watch';
        }
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

    async onLoginSuccess(token, user) {
        localStorage.setItem('mediahub_token', token);
        localStorage.setItem('mediahub_user', JSON.stringify(user));
        this.token = token;
        this.user = user;
        this.api.setToken(token);
        this.store.set({ token, user });

        if (token) this.initSocket();

        // Refresh user profile in background
        try {
            const freshUser = await this.api.me();
            localStorage.setItem('mediahub_user', JSON.stringify(freshUser));
            this.store.set({ user: freshUser });
            syncNsfwFromUser(freshUser);
        } catch (err) {
            console.error("Failed to refresh user profile:", err);
        }

        // Auto-scan if library is entirely empty
        try {
            const libCheck = await this.api.getLibrary({ per_page: 1 });
            if (!libCheck || !libCheck.items || libCheck.items.length === 0) {
                this.api.rescan().then(() => {
                    clearContentCaches();
                }).catch(() => {});
            }
        } catch (e) {}

        this.checkR18SessionPrompt();

        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.hidden = false;
        const mainArea = document.getElementById('main-area');
        if (mainArea) mainArea.style.marginLeft = '';

        this.router.navigate('/');
    }

    logout() {
        localStorage.removeItem('mediahub_token');
        localStorage.removeItem('mediahub_user');
        sessionStorage.removeItem('r18_enabled');
        sessionStorage.removeItem('r18_prompted');
        this.store.set({ user: null, token: null, r18Enabled: false });
        window.location.href = '/login';
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
            <div class="dialog-card text-center" style="position: relative;">
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

        if (!dialog.open) {
            dialog.showModal();
        }

        dialog.onclose = () => {
            this.handleNavigation();
        };

        dialog.querySelector('#r18-no-btn').onclick = () => {
            sessionStorage.setItem('r18_enabled', 'false');
            sessionStorage.setItem('r18_prompted', 'true');
            this.store.set({ r18Enabled: false });
            clearContentCaches();
            dialog.close();
        };

        dialog.querySelector('#r18-yes-btn').onclick = () => {
            sessionStorage.setItem('r18_enabled', 'true');
            sessionStorage.setItem('r18_prompted', 'true');
            this.store.set({ r18Enabled: true });
            clearContentCaches();
            dialog.close();
        };

        dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
        });
    }

    async pollScanStatus() {
        if (!this.token) {
            if (this.els.scanStatusContainer) this.els.scanStatusContainer.style.display = 'none';
            return;
        }

        clearTimeout(this._scanTimer);

        if (document.hidden) {
            this._scanTimer = setTimeout(() => this.pollScanStatus(), 5000);
            return;
        }

        try {
            const status = await this.api.getScanStatus();
            const container = this.els.scanStatusContainer;
            const textEl = this.els.scanText;

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

    _handleGlobalError(error) {
        console.error('[Global Error Boundary]', error);
        const viewTarget = document.getElementById('view-target');
        if (viewTarget) {
            viewTarget.innerHTML = `
                <div class="empty-state" style="margin-top: 10vh;">
                    <div class="empty-icon" style="font-size: 3rem; margin-bottom: 16px;">💥</div>
                    <h3 style="margin-bottom: 8px;">UI Crash Detected</h3>
                    <p class="text-muted text-sm" style="margin-bottom: 24px; max-width: 500px; margin-left: auto; margin-right: auto; word-break: break-word;">
                        ${error?.message || error || 'An unexpected error prevented this page from rendering.'}
                    </p>
                    <button class="btn btn-accent" id="btn-crash-home">Return Home</button>
                    <button class="btn btn-ghost" style="margin-left: 8px;" id="btn-crash-reload">Reload Page</button>
                </div>
            `;
            document.getElementById('btn-crash-home')?.addEventListener('click', () => {
                window.location.href = '/';
            });
            document.getElementById('btn-crash-reload')?.addEventListener('click', () => {
                window.location.reload();
            });
        }
    }
}

const appInstance = new App();
window.appInstance = appInstance;
api = appInstance.api;
player = appInstance.player;
router = appInstance.router;

export default appInstance;
