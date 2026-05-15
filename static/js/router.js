/**
 * MediaHub — Client-side Router
 */
export class Router {
    constructor(routes = []) {
        this.routes = routes;
        this.container = document.getElementById('view-target');
        this.currentView = null;

        document.addEventListener('click', (e) => {
            const link = e.target.closest('[data-link]');
            if (link) {
                e.preventDefault();
                this.navigate(link.getAttribute('href'));
            }
        });
    }

    navigate(path) {
        if (window.location.pathname !== path) {
            history.pushState(null, '', path);
        }
        window.dispatchEvent(new PopStateEvent('popstate'));
    }

    async loadRoute(path) {
        const route = this.routes.find(r => r.path === path) ||
                      this.routes.find(r => r.path === '*');

        if (!route) {
            this.container.innerHTML = '<div class="empty-state"><p>Page not found</p></div>';
            return;
        }

        // Clean up current view
        if (this.currentView && typeof this.currentView.destroy === 'function') {
            this.currentView.destroy();
        }

        const ViewClass = await route.view();
        this.currentView = new ViewClass(this.container);

        if (typeof this.currentView.render === 'function') {
            await this.currentView.render();
        }
    }
}
