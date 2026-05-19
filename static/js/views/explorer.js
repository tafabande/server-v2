/**
 * MediaHub — Explorer View (File Manager)
 * Optimized with batch rendering for large directories.
 */
import { api, player, router } from '../app.js';
import { formatBytes, formatDate, toast, confirm, thumbUrl, debounce, isAdultApproved, showAdultAccessDialog } from '../utils.js';

export class ExplorerView {
    constructor(container) { 
        this.container = container; 
        this._currentPath = ''; 
        this._items = [];
        this._viewMode = localStorage.getItem('explorer_view_mode') || 'table';
        this._pageSize = 50;
        this._renderedCount = 0;
        this._observer = null;
    }

    async render() {
        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg">
                <div>
                    <h1 class="page-title">Explorer</h1>
                    <p class="page-subtitle">Browse and manage your files directly</p>
                </div>
                <div class="flex gap-sm">
                    <div class="search-bar" style="margin-bottom:0">
                        <input id="explorer-search" class="input" type="text" placeholder="Filter files...">
                    </div>
                    <button id="explorer-play-all" class="btn btn-accent shadow-sm" title="Play all media in this folder">▶ Play All</button>
                    <button id="request-adult-btn" class="btn btn-ghost" style="display:none">🔞 Request 18+</button>
                    <button id="explorer-toggle" class="btn btn-ghost" title="Toggle view">
                        ${this._viewMode === 'grid' ? '☰' : '▦'}
                    </button>
                    <label class="btn btn-ghost shadow-sm" style="cursor:pointer">
                        <span>↑</span> Upload
                        <input id="upload-input" type="file" hidden multiple>
                    </label>
                </div>
            </div>
            
            <div class="explorer-toolbar surface flex-between mb-md">
                <div id="explorer-breadcrumb" class="breadcrumb" style="margin-bottom:0"></div>
                <div class="text-muted text-xs" id="explorer-stats"></div>
            </div>

            <div id="explorer-list-container" class="fade-in">
                <div class="loading-state"><div class="spinner"></div> Loading files...</div>
            </div>
            <div id="explorer-sentinel" style="height: 20px; margin-top: 20px;"></div>

            <div id="drop-zone" class="drop-zone" hidden>
                <div class="drop-zone-content">
                    <div class="drop-icon">↑</div>
                    <p>Drop files to upload to this folder</p>
                </div>
            </div>
        `;

        document.getElementById('upload-input')?.addEventListener('change', (e) => this._handleUpload(e));
        document.getElementById('explorer-toggle')?.addEventListener('click', () => this._toggleView());
        document.getElementById('explorer-play-all')?.addEventListener('click', () => this._playAll());
        document.getElementById('explorer-search')?.addEventListener('input', debounce(() => this._renderList(), 300));
        
        this._setupDragAndDrop();
        this._setupInfiniteScroll();

        const reqBtn = document.getElementById('request-adult-btn');
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        if (!user.is_adult && reqBtn) {
            reqBtn.style.display = 'block';
            try {
                const requests = await api.getRequests();
                const latestAdultReq = requests
                    .filter(r => r.request_type === 'adult_elevation')
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                    
                if (latestAdultReq) {
                    if (latestAdultReq.status === 'pending') {
                        reqBtn.textContent = '⏳ 18+ Request Pending';
                        reqBtn.disabled = true;
                        reqBtn.classList.add('disabled');
                        reqBtn.style.opacity = '0.6';
                        reqBtn.style.pointerEvents = 'none';
                    } else if (latestAdultReq.status === 'denied') {
                        reqBtn.textContent = '🔞 Request 18+ (Denied)';
                        reqBtn.title = `Denied reason: "${latestAdultReq.admin_comment || 'No reason given'}"`;
                        reqBtn.addEventListener('click', () => this._requestAdultAccess());
                    } else {
                        reqBtn.addEventListener('click', () => this._requestAdultAccess());
                    }
                } else {
                    reqBtn.addEventListener('click', () => this._requestAdultAccess());
                }
            } catch (err) {
                console.error("Could not fetch requests in explorer", err);
                reqBtn.addEventListener('click', () => this._requestAdultAccess());
            }
        }

        await this._browse('');
    }

    _setupInfiniteScroll() {
        this._observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && this._renderedCount < this._items.length) {
                this._renderNextBatch();
            }
        }, { rootMargin: '400px' });

        const sentinel = document.getElementById('explorer-sentinel');
        if (sentinel) this._observer.observe(sentinel);
    }

    _setupDragAndDrop() {
        const zone = document.getElementById('drop-zone');
        if (!zone) return;

        this._dragCounter = 0;

        this._onDragEnter = (e) => {
            e.preventDefault();
            this._dragCounter++;
            if (this._dragCounter === 1) {
                zone.hidden = false;
            }
        };

        this._onDragLeave = (e) => {
            e.preventDefault();
            this._dragCounter--;
            if (this._dragCounter === 0) {
                zone.hidden = true;
            }
        };

        this._onDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        };

        this._onDrop = async (e) => {
            e.preventDefault();
            this._dragCounter = 0;
            zone.hidden = true;
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                await this._handleUpload({ target: { files } });
            }
        };

        window.addEventListener('dragenter', this._onDragEnter);
        window.addEventListener('dragleave', this._onDragLeave);
        window.addEventListener('dragover', this._onDragOver);
        window.addEventListener('drop', this._onDrop);
    }

    async _browse(path) {
        this._currentPath = path;
        try {
            const data = await api.browse(path);
            this._items = data.items || [];
            this._renderedCount = 0;
            
            this._renderBreadcrumb(data.path, data.parent);
            
            const stats = document.getElementById('explorer-stats');
            if (stats) {
                const files = this._items.filter(i => !i.is_dir).length;
                const dirs = this._items.filter(i => i.is_dir).length;
                stats.textContent = `${dirs} folders, ${files} files`;
            }

            const container = document.getElementById('explorer-list-container');
            if (container) {
                container.innerHTML = '';
                if (this._items.length === 0) {
                    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>This folder is empty</p></div>';
                } else {
                    if (this._viewMode === 'grid') {
                        container.innerHTML = `<div id="explorer-grid" class="explorer-grid"></div>`;
                    } else {
                        container.innerHTML = `
                            <div class="surface" style="padding:0; overflow:hidden;">
                                <div class="file-list">
                                    <div id="explorer-table-body"></div>
                                </div>
                            </div>`;
                    }
                    this._renderList();
                }
            }
        } catch (err) {
            const container = document.getElementById('explorer-list-container');
            if (container) {
                container.innerHTML =
                    `<div class="empty-state">
                        <div class="empty-icon">❌</div>
                        <p>${err.message}</p>
                    </div>`;
            }
        }
    }

    _renderBreadcrumb(path, parent) {
        const crumbs = document.getElementById('explorer-breadcrumb');
        if (!crumbs) return;
        const parts = path ? path.split('/') : [];

        let html = `<a href="#" class="crumb-link" data-path="">Root</a>`;
        let accumulated = '';
        for (const part of parts) {
            accumulated += (accumulated ? '/' : '') + part;
            html += ` <span class="crumb-sep">/</span> <a href="#" class="crumb-link" data-path="${accumulated}">${part}</a>`;
        }

        crumbs.innerHTML = html;
        crumbs.querySelectorAll('.crumb-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this._browse(link.dataset.path);
            });
        });
    }

    _renderList() {
        const query = document.getElementById('explorer-search')?.value.toLowerCase() || '';
        this._filteredItems = query 
            ? this._items.filter(i => i.name.toLowerCase().includes(query))
            : [...this._items];
            
        const container = document.getElementById('explorer-list-container');
        if (!container) return;
        
        const listBody = this._viewMode === 'grid' 
            ? document.getElementById('explorer-grid')
            : document.getElementById('explorer-table-body');
            
        if (listBody) listBody.innerHTML = '';
        this._renderedCount = 0;
        this._renderNextBatch();
    }

    _renderNextBatch() {
        const itemsToRender = this._filteredItems || this._items;
        const start = this._renderedCount;
        const end = Math.min(start + this._pageSize, itemsToRender.length);
        const batch = itemsToRender.slice(start, end);
        
        if (batch.length === 0) return;

        if (this._viewMode === 'grid') {
            const grid = document.getElementById('explorer-grid');
            if (!grid) return;
            batch.forEach((item) => {
                const card = document.createElement('div');
                card.className = `explorer-card ${item.is_dir ? 'is-dir' : ''} ${item.adult_only ? 'is-adult' : ''}`;
                const isMedia = !!item.media;
                const icon = item.is_dir ? '📁' : (isMedia ? '🎬' : '📄');
                card.innerHTML = `
                    <div class="explorer-card-preview">
                        ${isMedia ? `<img src="${thumbUrl(item)}" loading="lazy" onerror="this.parentNode.innerHTML='<span class=\'big-icon\'>${icon}</span>'">` : `<span class="big-icon">${icon}</span>`}
                        <div class="explorer-card-badges">
                            ${item.locked ? '<span class="badge badge-warning">🔒</span>' : ''}
                            ${item.adult_only ? '<span class="badge badge-danger">🔞</span>' : ''}
                        </div>
                    </div>
                    <div class="explorer-card-info">
                        <div class="explorer-card-name">${item.name}</div>
                        <div class="explorer-card-meta">${item.is_dir ? 'Folder' : formatBytes(item.size)}</div>
                    </div>
                `;
                this._bindItemEvents(card, item);
                grid.appendChild(card);
            });
        } else {
            const body = document.getElementById('explorer-table-body');
            if (!body) return;
            batch.forEach((item) => {
                const row = document.createElement('div');
                row.className = `file-row ${item.adult_only ? 'is-adult' : ''}`;
                
                const toggleHtml = item.is_dir 
                    ? `<span class="explorer-tree-toggle collapsed" title="Expand Folder">▼</span>` 
                    : `<span style="width:28px; display:inline-block"></span>`;
                
                row.innerHTML = `
                    ${toggleHtml}
                    <span class="file-icon">
                        ${item.is_dir ? '📁' : (item.media ? '🎬' : '📄')}
                        ${item.locked ? '<span class="badge badge-warning" title="Locked">🔒</span>' : ''}
                        ${item.adult_only ? '<span class="badge badge-danger" title="18+ Only">🔞</span>' : ''}
                    </span>
                    <span class="file-name">${item.name}</span>
                    <span class="file-meta hide-mobile">${item.is_dir ? '—' : formatBytes(item.size)}</span>
                    <span class="file-meta hide-mobile">${formatDate(item.modified_at)}</span>
                    <div class="file-actions">
                        ${item.media ? `<button class="btn btn-ghost btn-sm play-btn" title="Play">▶</button>` : ''}
                        ${this._isAdmin() ? `<button class="btn btn-ghost btn-sm folder-settings-btn" title="Settings">⚙</button>` : ''}
                        ${!this._isAdmin() && item.locked ? `<button class="btn btn-ghost btn-sm request-access-btn" title="Request Access">🔑</button>` : ''}
                        <button class="btn btn-ghost btn-sm rename-btn" title="Rename">✏️</button>
                        <button class="btn btn-ghost btn-sm btn-danger delete-btn" title="Delete">🗑</button>
                    </div>
                `;
                this._bindItemEvents(row, item);
                body.appendChild(row);
            });
        }

        this._renderedCount = end;
    }

    async _toggleSubfolder(toggleEl, item, parentRow) {
        let subContainer = parentRow.nextElementSibling;
        const isSubContainer = subContainer && subContainer.classList.contains('explorer-subcontent-container');

        if (toggleEl.classList.contains('collapsed')) {
            toggleEl.classList.remove('collapsed');
            if (isSubContainer) {
                subContainer.style.display = 'block';
            } else {
                subContainer = document.createElement('div');
                subContainer.className = 'explorer-subcontent-container';
                subContainer.innerHTML = '<div class="loading-state" style="padding:10px;"><div class="spinner spinner-sm"></div> Loading...</div>';
                parentRow.after(subContainer);

                try {
                    const data = await api.browse(item.path);
                    const subitems = data.items || [];
                    if (subitems.length === 0) {
                        subContainer.innerHTML = '<div class="text-muted text-xs" style="padding:10px 0 10px 28px;">This folder is empty</div>';
                    } else {
                        subContainer.innerHTML = '';
                        subitems.forEach(subitem => {
                            const subRow = document.createElement('div');
                            subRow.className = `file-row ${subitem.adult_only ? 'is-adult' : ''}`;
                            
                            const toggleHtml = subitem.is_dir 
                                ? `<span class="explorer-tree-toggle collapsed" title="Expand Folder">▼</span>` 
                                : `<span style="width:28px; display:inline-block"></span>`;

                            subRow.innerHTML = `
                                ${toggleHtml}
                                <span class="file-icon">
                                    ${subitem.is_dir ? '📁' : (subitem.media ? '🎬' : '📄')}
                                    ${subitem.locked ? '<span class="badge badge-warning" title="Locked">🔒</span>' : ''}
                                    ${subitem.adult_only ? '<span class="badge badge-danger" title="18+ Only">🔞</span>' : ''}
                                </span>
                                <span class="file-name">${subitem.name}</span>
                                <span class="file-meta hide-mobile">${subitem.is_dir ? '—' : formatBytes(subitem.size)}</span>
                                <span class="file-meta hide-mobile">${formatDate(subitem.modified_at)}</span>
                                <div class="file-actions">
                                    ${subitem.media ? `<button class="btn btn-ghost btn-sm play-btn" title="Play">▶</button>` : ''}
                                    ${this._isAdmin() ? `<button class="btn btn-ghost btn-sm folder-settings-btn" title="Settings">⚙</button>` : ''}
                                    ${!this._isAdmin() && subitem.locked ? `<button class="btn btn-ghost btn-sm request-access-btn" title="Request Access">🔑</button>` : ''}
                                    <button class="btn btn-ghost btn-sm rename-btn" title="Rename">✏️</button>
                                    <button class="btn btn-ghost btn-sm btn-danger delete-btn" title="Delete">🗑</button>
                                </div>
                            `;
                            this._bindItemEvents(subRow, subitem);
                            subContainer.appendChild(subRow);
                        });
                    }
                } catch (err) {
                    subContainer.innerHTML = `<div class="text-error text-xs" style="padding:10px 0 10px 28px;">${err.message}</div>`;
                }
            }
        } else {
            toggleEl.classList.add('collapsed');
            if (isSubContainer) {
                subContainer.style.display = 'none';
            }
        }
    }

    _playAll() {
        const mediaItems = this._items.filter(i => i.media && i.media_id);
        if (mediaItems.length === 0) {
            toast('No playable media in this folder.', 'warning');
            return;
        }
        
        const playable = isAdultApproved() 
            ? mediaItems 
            : mediaItems.filter(i => !i.adult_only);
            
        if (playable.length === 0) {
            toast('Adult content hidden. Verify age to play all.', 'error', {
                label: 'Verify',
                onClick: () => router.navigate('/profile')
            });
            return;
        }

        const queue = playable.map(i => ({
            id: i.media_id,
            title: i.name,
            adult_only: i.adult_only
        }));
        
        player.play(queue, 0);
        toast(`Playing ${queue.length} items from folder`, 'success');
    }

    _bindItemEvents(el, item) {
        el.addEventListener('dblclick', (e) => {
             if (item.media && item.media_id) {
                 this._playMedia(item);
             } else if (item.is_dir) {
                 const toggle = el.querySelector('.explorer-tree-toggle');
                 if (toggle) {
                     this._toggleSubfolder(toggle, item, el);
                 } else {
                     this._browse(item.path);
                 }
             }
        });

        el.addEventListener('click', (e) => {
            if (e.target.closest('.file-actions') || e.target.closest('.explorer-tree-toggle')) return;
            if (item.is_dir) {
                if (item.adult_only && !isAdultApproved()) {
                    showAdultAccessDialog();
                    return;
                }
                this._browse(item.path);
            } else if (item.media) {
                this._playMedia(item);
            }
        });

        el.querySelector('.explorer-tree-toggle')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleSubfolder(e.currentTarget, item, el);
        });

        el.querySelector('.play-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._playMedia(item);
        });

        el.querySelector('.rename-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._rename(item.path, item.name);
        });

        el.querySelector('.delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._delete(item.path, item.name);
        });

        el.querySelector('.folder-settings-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openSettings(item.path, item.name);
        });

        el.querySelector('.request-access-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._requestFolderAccess(item.path);
        });
    }

    _playMedia(item) {
        if (item.adult_only && !isAdultApproved()) {
            showAdultAccessDialog();
            return;
        }
        if (item.media_id) {
            player.play(item.media_id);
        } else {
            toast('This file has not been indexed yet.', 'warning');
        }
    }

    _isAdmin() {
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        return user.role === 'admin' || user.role === 'super-admin';
    }

    async _openSettings(path, name) {
        const dialog = document.getElementById('folder-settings-dialog');
        if (!dialog) return;
        const folderLabel = document.getElementById('settings-folder-name');
        const lockCheck = document.getElementById('settings-locked');
        const adultCheck = document.getElementById('settings-adult');
        const cancelBtn = document.getElementById('settings-cancel');
        const saveBtn = document.getElementById('settings-save');

        if (folderLabel) folderLabel.textContent = `Settings: ${name}`;
        
        try {
            const settings = await api.getFolderSettings(path);
            if (lockCheck) lockCheck.checked = settings.is_locked;
            if (adultCheck) adultCheck.checked = settings.is_adult;
        } catch (err) {
            toast('Failed to load settings', 'error');
            return;
        }

        const onSave = async (e) => {
            e.preventDefault();
            try {
                await api.updateFolderSettings(path, {
                    is_locked: lockCheck.checked,
                    is_adult: adultCheck.checked
                });
                toast('Settings saved', 'success');
                dialog.close();
                this._browse(this._currentPath);
            } catch (err) {
                toast(err.message, 'error');
            }
        };

        const onCancel = () => dialog.close();
        const onClose = () => {
            saveBtn?.removeEventListener('click', onSave);
            cancelBtn?.removeEventListener('click', onCancel);
            dialog.removeEventListener('close', onClose);
        };

        saveBtn?.addEventListener('click', onSave);
        cancelBtn?.addEventListener('click', onCancel);
        dialog.addEventListener('close', onClose);
        dialog.showModal();
    }

    async _requestAdultAccess() {
        const yes = await confirm('Request 18+ Access', 'Elevate account to 18+ status?');
        if (!yes) return;
        try {
            await api.submitRequest('adult_elevation');
            toast('Request submitted', 'success');
            this.render();
        } catch (err) { toast(err.message, 'error'); }
    }

    async _requestFolderAccess(path) {
        const yes = await confirm('Request Access', `Request access to this folder?`);
        if (!yes) return;
        try {
            await api.submitRequest('folder_access', path);
            toast('Request submitted', 'success');
        } catch (err) { toast(err.message, 'error'); }
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

        if (e.target.tagName === 'INPUT') e.target.value = '';
        await this._browse(this._currentPath);
    }

    async _rename(path, oldName) {
        const newName = prompt('New name:', oldName);
        if (!newName || newName === oldName) return;
        try {
            await api.rename(path, newName);
            toast('Renamed successfully', 'success');
            await this._browse(this._currentPath);
        } catch (err) { toast(`Rename failed: ${err.message}`, 'error'); }
    }

    async _delete(path, name) {
        const yes = await confirm('Delete', `Delete "${name}"? This cannot be undone.`);
        if (!yes) return;
        try {
            await api.deleteFile(path);
            toast('Deleted', 'success');
            await this._browse(this._currentPath);
        } catch (err) { toast(`Delete failed: ${err.message}`, 'error'); }
    }

    _toggleView() {
        this._viewMode = this._viewMode === 'grid' ? 'table' : 'grid';
        localStorage.setItem('explorer_view_mode', this._viewMode);
        const btn = document.getElementById('explorer-toggle');
        if (btn) btn.textContent = this._viewMode === 'grid' ? '☰' : '▦';
        this._browse(this._currentPath);
    }

    destroy() {
        if (this._observer) {
            this._observer.disconnect();
        }
        window.removeEventListener('dragenter', this._onDragEnter);
        window.removeEventListener('dragleave', this._onDragLeave);
        window.removeEventListener('dragover', this._onDragOver);
        window.removeEventListener('drop', this._onDrop);
    }
}
