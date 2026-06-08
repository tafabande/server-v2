import { api, router } from '../app.js';
import { escapeHtml, formatBytes, formatDateTime, toast } from '../utils.js';

export class UploadView {
    constructor(container) {
        this.container = container;
        this._queue = [];
        this._problems = [];
        this._dragDepth = 0;
        this._uploading = false;
        this._canUpload = false;
        this._destinationKey = 'upload_destination_path';
    }

    async render() {
        const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
        this._canUpload = user.role === 'admin' || user.role === 'family';
        this._queue = [];
        this._problems = [];

        const savedDestination = localStorage.getItem(this._destinationKey) || '';
        const destinationLabel = savedDestination ? savedDestination : 'Root';

        this.container.innerHTML = `
            <div class="view-header flex-between mb-lg">
                <div>
                    <h1 class="page-title">Upload</h1>
                    <p class="page-subtitle">Send files into shared storage without the old explorer page.</p>
                </div>
                <div class="upload-summary-chip">
                    Destination: <span id="upload-destination-label">${escapeHtml(destinationLabel)}</span>
                </div>
            </div>

            <div class="upload-layout">
                <section class="surface upload-panel">
                    <div class="section-title">Upload files</div>
                    <p class="text-muted text-sm" style="margin-bottom: 16px;">
                        Choose a destination path, add a folder PIN if needed, then drop files or use the picker.
                    </p>

                    ${this._canUpload ? '' : `
                        <div class="upload-warning mb-md">
                            Upload access is limited to admin and family accounts.
                        </div>
                    `}

                    <div class="form-row">
                        <div class="form-group">
                            <label for="upload-path">Destination path</label>
                            <input id="upload-path" class="input" type="text" placeholder="Movies/Season 01" value="${escapeHtml(savedDestination)}" ${this._canUpload ? '' : 'disabled'}>
                        </div>
                        <div class="form-group">
                            <label for="upload-pin">Folder PIN</label>
                            <input id="upload-pin" class="input" type="password" placeholder="Optional" ${this._canUpload ? '' : 'disabled'}>
                        </div>
                    </div>

                    <div id="upload-dropzone" class="upload-dropzone ${this._canUpload ? '' : 'is-disabled'}">
                        <strong>Drop files here</strong>
                        <p>or choose files below</p>
                    </div>

                    <div class="upload-actions">
                        <label class="btn btn-ghost ${this._canUpload ? '' : 'disabled'}" style="cursor: pointer;">
                            Choose Files
                            <input id="upload-file-input" type="file" hidden multiple ${this._canUpload ? '' : 'disabled'}>
                        </label>
                        <button id="upload-start-btn" class="btn btn-accent" ${this._canUpload ? '' : 'disabled'}>Start Upload</button>
                        <button id="upload-clear-btn" class="btn btn-ghost" type="button">Clear</button>
                    </div>

                    <div class="section-title" style="margin-top: 24px;">Queued Files</div>
                    <div id="upload-queue" class="upload-queue">
                        <div class="empty-state upload-empty">
                            <p>No files selected.</p>
                        </div>
                    </div>
                </section>

                <aside class="surface upload-sidebar">
                    <div class="section-title">Current Problems</div>
                    <div id="current_problems" class="upload-problem-list">
                        <div class="empty-state upload-empty">
                            <p>No current problems.</p>
                        </div>
                    </div>

                    <div class="upload-side-note">
                        <div class="text-sm" style="font-weight: 700; margin-bottom: 6px;">18+ requests live in Profile settings.</div>
                        <p class="text-muted text-xs" style="margin-bottom: 12px;">
                            Use your Profile page if you need to request adult access.
                        </p>
                        <button id="upload-profile-btn" class="btn btn-ghost btn-sm" type="button">Open Profile</button>
                    </div>
                </aside>
            </div>
        `;

        this._bindEvents();
        this._renderQueue();
        this._renderProblems();
    }

    _bindEvents() {
        const pathInput = document.getElementById('upload-path');
        const pinInput = document.getElementById('upload-pin');
        const fileInput = document.getElementById('upload-file-input');
        const startBtn = document.getElementById('upload-start-btn');
        const clearBtn = document.getElementById('upload-clear-btn');
        const profileBtn = document.getElementById('upload-profile-btn');
        const dropzone = document.getElementById('upload-dropzone');

        pathInput?.addEventListener('input', (event) => {
            const value = event.target.value.trim();
            localStorage.setItem(this._destinationKey, value);
            this._syncDestinationLabel(value);
        });

        fileInput?.addEventListener('change', (event) => {
            this._setFiles(event.target.files);
        });

        startBtn?.addEventListener('click', () => {
            this._startUpload();
        });

        clearBtn?.addEventListener('click', () => {
            this._clearSelection();
        });

        profileBtn?.addEventListener('click', () => {
            router.navigate('/profile');
        });

        this._onDragEnter = (event) => {
            if (!this._canUpload) return;
            event.preventDefault();
            this._dragDepth += 1;
            dropzone?.classList.add('is-dragover');
        };

        this._onDragOver = (event) => {
            if (!this._canUpload) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        };

        this._onDragLeave = (event) => {
            if (!this._canUpload) return;
            event.preventDefault();
            this._dragDepth = Math.max(0, this._dragDepth - 1);
            if (this._dragDepth === 0) {
                dropzone?.classList.remove('is-dragover');
            }
        };

        this._onDrop = (event) => {
            if (!this._canUpload) return;
            event.preventDefault();
            this._dragDepth = 0;
            dropzone?.classList.remove('is-dragover');
            const files = event.dataTransfer?.files;
            if (files && files.length > 0) {
                this._setFiles(files);
            }
        };

        window.addEventListener('dragenter', this._onDragEnter);
        window.addEventListener('dragover', this._onDragOver);
        window.addEventListener('dragleave', this._onDragLeave);
        window.addEventListener('drop', this._onDrop);
    }

    _setFiles(fileList) {
        this._queue = Array.from(fileList || []).map((file) => ({
            file,
            state: 'ready',
            detail: 'Ready to upload',
        }));
        this._renderQueue();
    }

    _clearSelection() {
        this._queue = [];
        const fileInput = document.getElementById('upload-file-input');
        if (fileInput) fileInput.value = '';
        this._renderQueue();
    }

    _syncDestinationLabel(value) {
        const label = document.getElementById('upload-destination-label');
        if (label) {
            label.textContent = value ? value : 'Root';
        }
    }

    _getDestination() {
        return (document.getElementById('upload-path')?.value || '').trim();
    }

    _getPin() {
        return (document.getElementById('upload-pin')?.value || '').trim();
    }

    _recordProblem(message, kind = 'error') {
        this._problems.unshift({
            message,
            kind,
            time: new Date().toISOString(),
        });
        this._problems = this._problems.slice(0, 6);
        this._renderProblems();
    }

    _renderQueue() {
        const target = document.getElementById('upload-queue');
        if (!target) return;

        if (this._queue.length === 0) {
            target.innerHTML = `
                <div class="empty-state upload-empty">
                    <p>No files selected.</p>
                </div>
            `;
            return;
        }

        target.innerHTML = this._queue.map((item) => {
            const statusLabel = item.state === 'done'
                ? 'Done'
                : item.state === 'error'
                    ? 'Failed'
                    : item.state === 'uploading'
                        ? 'Uploading'
                        : 'Ready';

            return `
                <div class="upload-file-item ${item.state}">
                    <div class="upload-file-main">
                        <div class="upload-file-name">${escapeHtml(item.file.name)}</div>
                        <div class="upload-file-meta">
                            ${formatBytes(item.file.size)}${item.detail ? ` | ${escapeHtml(item.detail)}` : ''}
                        </div>
                    </div>
                    <span class="badge ${item.state === 'error' ? 'badge-error' : item.state === 'done' ? 'badge-success' : 'badge-muted'}">
                        ${statusLabel}
                    </span>
                </div>
            `;
        }).join('');
    }

    _renderProblems() {
        const target = document.getElementById('current_problems');
        if (!target) return;

        if (this._problems.length === 0) {
            target.innerHTML = `
                <div class="empty-state upload-empty">
                    <p>No current problems.</p>
                </div>
            `;
            return;
        }

        target.innerHTML = this._problems.map((problem) => `
            <div class="upload-problem-item ${problem.kind}">
                <div class="upload-problem-message">${escapeHtml(problem.message)}</div>
                <div class="upload-problem-time">${formatDateTime(problem.time)}</div>
            </div>
        `).join('');
    }

    async _startUpload() {
        if (!this._canUpload) {
            this._recordProblem('Uploads are limited to admin and family accounts.', 'warning');
            toast('Upload access denied.', 'error');
            return;
        }

        if (this._uploading) {
            return;
        }

        if (this._queue.length === 0) {
            this._recordProblem('Choose at least one file before uploading.', 'warning');
            toast('Pick files first.', 'warning');
            return;
        }

        const destination = this._getDestination();
        const pin = this._getPin();
        const fileInput = document.getElementById('upload-file-input');
        const startBtn = document.getElementById('upload-start-btn');

        localStorage.setItem(this._destinationKey, destination);
        this._syncDestinationLabel(destination);

        this._uploading = true;
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Uploading...';
        }

        const pendingItems = this._queue.filter((item) => item.state !== 'done');
        let successCount = 0;
        for (const item of pendingItems) {
            item.state = 'uploading';
            item.detail = 'Uploading...';
            this._renderQueue();

            try {
                await api.upload(destination, item.file, pin);
                item.state = 'done';
                item.detail = 'Uploaded successfully';
                successCount += 1;
                toast(`Uploaded: ${item.file.name}`, 'success');
            } catch (err) {
                item.state = 'error';
                item.detail = err.message || 'Upload failed';
                this._recordProblem(`${item.file.name}: ${item.detail}`, 'error');
                toast(`Upload failed: ${item.file.name}`, 'error');
            }

            this._renderQueue();
        }

        this._uploading = false;
        if (startBtn) {
            startBtn.disabled = !this._canUpload;
            startBtn.textContent = 'Start Upload';
        }

        if (this._queue.every((item) => item.state === 'done')) {
            this._queue = [];
            if (fileInput) fileInput.value = '';
            this._renderQueue();
            if (successCount > 0) {
                toast(`Uploaded ${successCount} file${successCount === 1 ? '' : 's'}.`, 'success');
            }
        } else {
            this._queue = this._queue.filter((item) => item.state === 'error');
            this._renderQueue();
        }
    }

    destroy() {
        window.removeEventListener('dragenter', this._onDragEnter);
        window.removeEventListener('dragover', this._onDragOver);
        window.removeEventListener('dragleave', this._onDragLeave);
        window.removeEventListener('drop', this._onDrop);
    }
}
