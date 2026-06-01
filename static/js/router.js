import { escapeHtml } from './utils.js';

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
        if (this._transitioning) return;
        this._transitioning = true;

        const route = this.routes.find(r => r.path === path) ||
                      this.routes.find(r => r.path === '*');

        if (!route) {
            this.container.innerHTML = '<div class="empty-state"><p>Page not found</p></div>';
            this._transitioning = false;
            return;
        }

        const updateUI = async () => {
            // Clean up current view
            if (this.currentView && typeof this.currentView.destroy === 'function') {
                this.currentView.destroy();
            }

            const ViewClass = await route.view();
            this.currentView = new ViewClass(this.container);

            if (typeof this.currentView.render === 'function') {
                const renderPromise = this.currentView.render();
                if (renderPromise instanceof Promise) {
                    renderPromise.catch(err => {
                        console.error('Rendering error:', err);
                        this.container.innerHTML = `<div class="empty-state"><p>Failed to load page: ${escapeHtml(err.message)}</p></div>`;
                    });
                }
            }
        };

        try {
            if (document.startViewTransition) {
                const transition = document.startViewTransition(updateUI);
                transition.ready.catch(() => {});
                transition.updateCallbackDone.catch(() => {});
                try {
                    await transition.finished;
                } catch (tErr) {
                    const skipErrors = ["TimeoutError", "AbortError", "InvalidStateError"];
                    if (skipErrors.includes(tErr.name) || tErr.message?.includes("aborted")) {
                        console.warn('View transition skipped or aborted:', tErr.message);
                    } else {
                        throw tErr;
                    }
                }
            } else {
                await updateUI();
            }
        } catch (err) {
            console.error('Routing error:', err);
            this.container.innerHTML = `<div class="empty-state"><p>Failed to load page: ${err.message}</p></div>`;
        } finally {
            this._transitioning = false;
        }
    }
}
