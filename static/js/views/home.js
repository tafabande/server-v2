import { api, player } from '../app.js';
import { GalleryManager } from '../gallery-manager.js';

/**
 * Home View
 */
export const HomeView = {
    html: `
        <section class="glass-panel hero-panel" id="hero-panel">
          <div class="hero-copy">
            <p class="brand-tag">Premium Streaming / Realtime Sync</p>
            <h2 id="hero-title" class="hero-title">Loading...</h2>
            <p id="hero-description" class="hero-description">
              Surfacing your media library...
            </p>

            <div id="hero-metadata" class="hero-metadata"></div>

            <div class="hero-actions">
              <button id="hero-play" class="btn btn-primary" disabled>
                <span class="nav-icon">play_arrow</span> Play Feature
              </button>
              <button id="hero-open-folder" class="btn btn-secondary">
                <span class="nav-icon">info</span> View Details
              </button>
            </div>
          </div>

          <div class="hero-art">
            <div class="hero-frame">
              <img id="hero-thumb" class="media-thumb" src="/static/placeholder.svg" alt="Featured artwork" />
              <div class="hero-overlay">
                <span id="hero-badge" class="hero-badge">Offline</span>
              </div>
            </div>
          </div>
        </section>

        <section id="gallery-root" class="gallery-root">
            <div class="section-loader">
                <div class="spinner"></div>
                <p>Syncing library...</p>
            </div>
        </section>
    `,
    init: async () => {
        const gallery = new GalleryManager({
            root: document.getElementById('gallery-root'),
            hero: {
                title: document.getElementById('hero-title'),
                description: document.getElementById('hero-description'),
                thumb: document.getElementById('hero-thumb'),
                badge: document.getElementById('hero-badge'),
                play: document.getElementById('hero-play'),
                meta: document.getElementById('hero-metadata'),
            },
            onPlay: async (media) => {
                try {
                    const stream = await api.stream(media.id);
                    player.open(media, stream);
                } catch (e) {
                    console.error('Playback failed', e);
                }
            }
        });

        // Fetch library
        try {
            const groups = await api.getLibrary();
            gallery.setLibrary(groups);
        } catch (e) {
            console.error('Failed to load library', e);
            document.getElementById('gallery-root').innerHTML = `<p class="error-text">Failed to sync library: ${e.message}</p>`;
        }

        // Listen for library updates
        window.addEventListener('streamdrop-socket-message', (e) => {
            if (e.detail.type === 'library-updated') {
                api.getLibrary().then(groups => gallery.setLibrary(groups));
            }
        });

        // Backward compatibility for legacy events
        window.addEventListener('mediahub-socket-message', (e) => {
            if (e.detail.type === 'library-updated') {
                api.getLibrary().then(groups => gallery.setLibrary(groups));
            }
        });
    }
};
