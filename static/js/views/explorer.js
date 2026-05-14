import { api, player } from '../app.js';
import { ExplorerManager } from '../explorer-manager.js';

/**
 * Explorer View
 */
export const ExplorerView = {
    html: `
        <div class="explorer-view">
            <header class="view-header">
                <div>
                    <h2>File Explorer</h2>
                    <p id="explorer-path" class="path-label">shared_media/</p>
                </div>
                <div class="header-actions">
                    <button id="go-up-button" class="ghost-button">Up One Level</button>
                    <label class="file-upload primary-button">
                        <span>Upload Media</span>
                        <input id="upload-input" type="file" />
                    </label>
                </div>
            </header>

            <div class="explorer-toolbar">
                <div class="search-field">
                    <input id="explorer-search" type="search" placeholder="Filter current folder..." />
                </div>
                <div class="pin-field">
                    <input id="pin-input" type="password" placeholder="Admin PIN" />
                </div>
                <div id="explorer-summary" class="section-note">No folder loaded.</div>
            </div>

            <div id="explorer-root" class="explorer-grid">
                <div class="section-loader">
                    <div class="spinner"></div>
                    <p>Fetching directory listing...</p>
                </div>
            </div>
        </div>
    `,
    init: async () => {
        let currentPath = '';

        const explorer = new ExplorerManager({
            root: document.getElementById('explorer-root'),
            pathLabel: document.getElementById('explorer-path'),
            summaryLabel: document.getElementById('explorer-summary'),
            onOpenDirectory: async (path) => {
                currentPath = path;
                await loadDir(path);
            },
            onPlayMedia: async (path) => {
                // Implementation for playing from path (would need mapping path to media ID)
                console.log('Play media from path:', path);
            },
            onRename: async (path) => {
                const newName = prompt('Enter new name:');
                if (newName) {
                    await api.rename(path, newName, document.getElementById('pin-input').value);
                    await loadDir(currentPath);
                }
            },
            onDelete: async (path) => {
                if (confirm(`Delete ${path}?`)) {
                    await api.delete(path, document.getElementById('pin-input').value);
                    await loadDir(currentPath);
                }
            }
        });

        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        explorer.setPermissions({
            canRename: ['admin', 'family'].includes(user.role),
            canDelete: user.role === 'admin'
        });

        const loadDir = async (path = '') => {
            try {
                const listing = await api.browse(path, document.getElementById('pin-input').value);
                explorer.setListing(listing);
            } catch (e) {
                console.error('Failed to browse', e);
                document.getElementById('explorer-root').innerHTML = `<p class="error-text">Failed to browse: ${e.message}</p>`;
            }
        };

        // Initial load
        await loadDir();

        // Event listeners
        document.getElementById('explorer-search').addEventListener('input', (e) => {
            explorer.setQuery(e.target.value);
        });

        document.getElementById('go-up-button').addEventListener('click', () => {
            const parts = currentPath.split('/').filter(Boolean);
            parts.pop();
            const parent = parts.join('/');
            currentPath = parent;
            loadDir(parent);
        });

        document.getElementById('upload-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await api.upload(currentPath, file, document.getElementById('pin-input').value);
                await loadDir(currentPath);
            }
        });
    }
};
