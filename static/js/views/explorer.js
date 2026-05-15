/**
 * MediaHub — Explorer View (File Manager)
 */
import { api, player } from '../app.js';
import { formatBytes, formatDate, toast, confirm } from '../utils.js';

export class ExplorerView {
    constructor(container) { this.container = container; this._currentPath = ''; }

    async render() {
        this.container.innerHTML = `
            <div class="flex-between mb-md">
                <div>
                    <h1 class="page-title">Explorer</h1>
                    <p class="page-subtitle">Browse and manage files</p>
                </div>
                <div class="flex gap-sm">
                    <button id="request-adult-btn" class="btn btn-ghost" style="display:none">🔞 Request 18+ Access</button>
                    <label class="btn btn-accent" style="cursor:pointer">
                        ↑ Upload
                        <input id="upload-input" type="file" hidden multiple>
                    </label>
                </div>
            </div>
            <div id="explorer-breadcrumb" class="breadcrumb"></div>
            <div id="explorer-list" class="surface" style="padding:0">
                <div class="loading-state"><div class="spinner"></div> Loading...</div>
            </div>
        `;

        document.getElementById('upload-input').addEventListener('change', (e) => this._handleUpload(e));
        const reqBtn = document.getElementById('request-adult-btn');
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        if (!user.is_adult) {
            reqBtn.style.display = 'block';
            reqBtn.addEventListener('click', () => this._requestAdultAccess());
        }

        await this._browse('');
    }

    async _browse(path) {
        this._currentPath = path;
        try {
            const data = await api.browse(path);
            this._renderBreadcrumb(data.path, data.parent);
            this._renderFiles(data.items);
        } catch (err) {
            document.getElementById('explorer-list').innerHTML =
                `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    _renderBreadcrumb(path, parent) {
        const crumbs = document.getElementById('explorer-breadcrumb');
        const parts = path ? path.split('/') : [];

        let html = `<a href="#" class="crumb-link" data-path="">Root</a>`;
        let accumulated = '';
        for (const part of parts) {
            accumulated += (accumulated ? '/' : '') + part;
            html += ` <span>/</span> <a href="#" class="crumb-link" data-path="${accumulated}">${part}</a>`;
        }

        crumbs.innerHTML = html;
        crumbs.querySelectorAll('.crumb-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this._browse(link.dataset.path);
            });
        });
    }

    _renderFiles(items) {
        const list = document.getElementById('explorer-list');

        if (!items || items.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>Empty folder</p></div>';
            return;
        }

        list.innerHTML = `<div class="file-list">${items.map((item, index) => `
            <div class="file-row" data-index="${index}" data-path="${item.path}" data-is-dir="${item.is_dir}" data-name="${item.name}">
                <span class="file-icon">
                    ${item.is_dir ? '📁' : (item.media ? '🎬' : '📄')}
                    ${item.locked ? '<span class="badge badge-warning" title="Locked">🔒</span>' : ''}
                    ${item.adult_only ? '<span class="badge badge-danger" title="18+ Only">🔞</span>' : ''}
                </span>
                <span class="file-name">${item.name}</span>
                <span class="file-meta">${item.is_dir ? '—' : formatBytes(item.size)}</span>
                <span class="file-meta">${formatDate(item.modified_at)}</span>
                <div class="file-actions">
                    ${item.media ? `<button class="btn btn-ghost btn-sm play-btn" title="Play">▶️</button>` : ''}
                    ${this._isAdmin() ? `
                        <button class="btn btn-ghost btn-sm toggle-lock-btn" title="${item.locked ? 'Unlock' : 'Lock'}">${item.locked ? '🔓' : '🔒'}</button>
                        <button class="btn btn-ghost btn-sm toggle-adult-btn" title="${item.adult_only ? 'Remove 18+' : 'Set 18+'}">${item.adult_only ? '🧒' : '🔞'}</button>
                    ` : ''}
                    ${!this._isAdmin() && item.locked ? `<button class="btn btn-ghost btn-sm request-access-btn" title="Request Access">🔑</button>` : ''}
                    <button class="btn btn-ghost btn-sm rename-btn" title="Rename">✏️</button>
                    <button class="btn btn-ghost btn-sm btn-danger delete-btn" title="Delete">🗑</button>
                </div>
            </div>
        `).join('')}</div>`;

        list.querySelectorAll('.file-row').forEach(row => {
            const item = items[row.dataset.index];
            // Click to browse into dirs
            row.addEventListener('click', (e) => {
                if (e.target.closest('.file-actions')) return;
                if (row.dataset.isDir === 'true') {
                    this._browse(row.dataset.path);
                }
            });

            if (item.media) {
                row.querySelector('.play-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (item.media_id) {
                        player.play(item.media_id);
                    } else {
                        toast('This file has not been indexed yet. Please run a library scan.', 'warning');
                    }
                });
            }

            row.querySelector('.rename-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this._rename(row.dataset.path, row.dataset.name);
            });

            row.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this._delete(row.dataset.path, row.dataset.name);
            });

            row.querySelector('.toggle-lock-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleSetting(item.path, { is_locked: !item.locked });
            });

            row.querySelector('.toggle-adult-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleSetting(item.path, { is_adult: !item.adult_only });
            });

            row.querySelector('.request-access-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._requestFolderAccess(item.path);
            });
        });
    }

    _isAdmin() {
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        return user.role === 'admin' || user.role === 'super-admin';
    }

    async _toggleSetting(path, settings) {
        try {
            await api.updateFolderSettings(path, settings);
            toast('Settings updated', 'success');
            await this._browse(this._currentPath);
        } catch (err) {
            toast(`Failed: ${err.message}`, 'error');
        }
    }

    async _requestAdultAccess() {
        const yes = await confirm('Request 18+ Access', 'Do you want to request your account be elevated to 18+ status?');
        if (!yes) return;
        try {
            await api.submitRequest('adult_elevation');
            toast('Request submitted', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async _requestFolderAccess(path) {
        const yes = await confirm('Request Access', `Request access to this folder?`);
        if (!yes) return;
        try {
            await api.submitRequest('folder_access', path);
            toast('Request submitted', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async _handleUpload(e) {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            try {
                await api.upload(this._currentPath, file);
                toast(`Uploaded: ${file.name}`, 'success');
            } catch (err) {
                toast(`Upload failed: ${err.message}`, 'error');
            }
        }

        e.target.value = '';
        await this._browse(this._currentPath);
    }

    async _rename(path, oldName) {
        const newName = prompt('New name:', oldName);
        if (!newName || newName === oldName) return;
        try {
            await api.rename(path, newName);
            toast('Renamed successfully', 'success');
            await this._browse(this._currentPath);
        } catch (err) {
            toast(`Rename failed: ${err.message}`, 'error');
        }
    }

    async _delete(path, name) {
        const yes = await confirm('Delete', `Delete "${name}"? This cannot be undone.`);
        if (!yes) return;
        try {
            await api.deleteFile(path);
            toast('Deleted', 'success');
            await this._browse(this._currentPath);
        } catch (err) {
            toast(`Delete failed: ${err.message}`, 'error');
        }
    }

    destroy() {}
}
