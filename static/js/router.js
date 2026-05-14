/**
 * MediaHub Vanilla Router
 * Handles cinematic multi-page transitions.
 */

export class Router {
    constructor(routes, containerId = 'app-shell-content') {
        this.routes = routes;
        this.container = document.getElementById(containerId);
        this.currentPath = null;
        
        window.addEventListener('popstate', () => this.loadRoute(window.location.pathname));
        
        // Hijack internal links
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-link]');
            if (link) {
                e.preventDefault();
                this.navigate(link.getAttribute('href'));
            }
        });
    }

    async navigate(url) {
        if (url === this.currentPath) return;
        window.history.pushState(null, null, url);
        await this.loadRoute(url);
    }

    async loadRoute(path) {
        this.currentPath = path;
        
        // Find matching route or fallback to home
        let route = this.routes.find(r => r.path === path) || this.routes.find(r => r.path === '*');
        
        if (!route) return;

        // If route requires auth and we are not logged in, redirect to login
        const isAuthenticated = !!localStorage.getItem('mediahub_token');
        if (route.requiresAuth && !isAuthenticated) {
            this.navigate('/login');
            return;
        }

        try {
            // Optional: Show a small loading transition
            this.container.style.opacity = '0.5';
            
            const view = await route.view();
            this.container.innerHTML = view.html;
            
            if (view.init) {
                await view.init();
            }
            
            this.container.style.opacity = '1';
            
            // Update active state in nav
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.toggle('active', link.getAttribute('href') === path);
            });
            
        } catch (error) {
            console.error('Failed to load route:', error);
            this.container.innerHTML = `<div class="error-view"><h2>Something went wrong</h2><p>${error.message}</p></div>`;
        }
    }
}
