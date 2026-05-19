/**
 * MediaHub — Shared Utilities
 */

export function toast(message, type = 'info', action = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type} flex-between gap-md`;
    
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);

    if (action) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-ghost';
        btn.style.color = 'inherit';
        btn.style.borderColor = 'currentColor';
        btn.style.opacity = '0.8';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            action.onClick();
            el.remove();
        });
        el.appendChild(btn);
    }

    container.appendChild(el);

    if (!action) {
        setTimeout(() => {
            if (!el.parentElement) return;
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
            el.style.transition = 'all 0.2s ease';
            setTimeout(() => el.remove(), 250);
        }, 3000);
    }
}

export function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function thumbUrl(media) {
    if (!media || !media.thumbnail_path) return '/static/placeholder.svg';
    
    try {
        // We decode first to handle cases where the path might already be partially encoded,
        // then we encode each segment properly. This ensures characters like '#' or '?'
        // are escaped so they don't truncate the URL or get treated as fragments.
        const decoded = decodeURIComponent(media.thumbnail_path);
        return decoded.split('/').map(s => s ? encodeURIComponent(s) : '').join('/');
    } catch (e) {
        // If decoding fails (e.g. invalid % sequence), just encode the segments as they are.
        return media.thumbnail_path.split('/').map(s => s ? encodeURIComponent(s) : '').join('/');
    }
}

export function confirm(title, message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('confirm-dialog');
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;

        const accept = document.getElementById('confirm-accept');
        const cancel = document.getElementById('confirm-cancel');

        const cleanup = () => {
            accept.removeEventListener('click', onAccept);
            cancel.removeEventListener('click', onCancel);
            dialog.close();
        };

        const onAccept = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        accept.addEventListener('click', onAccept);
        cancel.addEventListener('click', onCancel);
        dialog.showModal();
    });
}

export function debounce(fn, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

export function isAdultApproved() {
    const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
    return user.role === 'admin' || user.role === 'super-admin' || user.is_adult === true;
}

export async function showAdultAccessDialog() {
    const { api } = await import('./app.js');
    
    let dialog = document.getElementById('adult-access-dialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'adult-access-dialog';
        dialog.className = 'glass-modal';
        dialog.style.maxWidth = '400px';
        document.body.appendChild(dialog);
    }
    
    dialog.innerHTML = `
        <div class="dialog-card text-center" style="padding: 24px; position: relative;">
            <div class="spinner" style="margin: 20px auto;"></div>
            <p class="text-muted text-sm">Checking access request status...</p>
        </div>
    `;
    dialog.showModal();
    
    let latestReq = null;
    try {
        const requests = await api.getRequests();
        latestReq = requests
            .filter(r => r.request_type === 'adult_elevation')
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    } catch (e) {
        console.error("Failed to load requests", e);
    }
    
    let contentHtml = '';
    if (latestReq) {
        if (latestReq.status === 'pending') {
            contentHtml = `
                <div class="status-indicator warning" style="font-size: 2.5rem; margin-bottom: 16px;">⏳</div>
                <h3 style="margin-bottom: 8px;">18+ Request Pending</h3>
                <p class="text-muted text-sm" style="margin-bottom: 16px;">
                    Your elevation request submitted on <strong>${formatDate(latestReq.created_at)}</strong> is currently pending review by an administrator.
                </p>
                <div class="dialog-actions">
                    <button class="btn btn-ghost w-100 close-dialog">Close</button>
                </div>
            `;
        } else if (latestReq.status === 'denied') {
            contentHtml = `
                <div class="status-indicator error" style="font-size: 2.5rem; color: var(--error); margin-bottom: 16px;">❌</div>
                <h3 style="margin-bottom: 8px;">Elevation Request Denied</h3>
                <p class="text-muted text-sm" style="margin-bottom: 12px;">
                    Your previous R18 elevation request was denied by the administrator.
                </p>
                <div class="p-xs surface rounded text-xs text-error" style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 8px; border-radius: var(--radius); margin-bottom: 16px; text-align: left;">
                    <strong>Admin Comment:</strong> "${latestReq.admin_comment || 'No reason provided.'}"
                </div>
                <div class="dialog-actions" style="display: flex; flex-direction: column; gap: 8px;">
                    <button class="btn btn-accent w-100 request-elevation-btn">🔞 Re-request Elevation</button>
                    <button class="btn btn-ghost w-100 close-dialog">Close</button>
                </div>
            `;
        } else {
            contentHtml = `
                <div class="status-indicator success" style="font-size: 2.5rem; color: var(--success); margin-bottom: 16px;">✅</div>
                <h3 style="margin-bottom: 8px;">Access Approved!</h3>
                <p class="text-muted text-sm" style="margin-bottom: 16px;">
                    Your account has been elevated to 18+ status. Please reload to sync your session.
                </p>
                <div class="dialog-actions">
                    <button class="btn btn-accent w-100 reload-btn">Reload Page</button>
                </div>
            `;
        }
    } else {
        contentHtml = `
            <div class="status-indicator error" style="font-size: 3rem; margin-bottom: 16px;">🔞</div>
            <h3 style="margin-bottom: 8px;">18+ Content Restricted</h3>
            <p class="text-muted text-sm" style="margin-bottom: 20px;">
                This folder or video is marked as <strong>R18 / Adult Content</strong>. Your account must be verified as 18+ to access this material.
            </p>
            <div class="dialog-actions" style="display: flex; flex-direction: column; gap: 8px;">
                <button class="btn btn-accent w-100 request-elevation-btn">🔞 Request 18+ Elevation</button>
                <button class="btn btn-ghost w-100 close-dialog">Close</button>
            </div>
        `;
    }
    
    dialog.innerHTML = `
        <div class="dialog-card text-center" style="padding: 24px; position: relative;">
            <button class="close-dialog" style="position: absolute; top: 12px; right: 12px; border: none; background: transparent; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
            ${contentHtml}
        </div>
    `;
    
    const closeBtns = dialog.querySelectorAll('.close-dialog');
    closeBtns.forEach(btn => btn.addEventListener('click', () => dialog.close()));
    
    const requestBtn = dialog.querySelector('.request-elevation-btn');
    if (requestBtn) {
        requestBtn.addEventListener('click', async () => {
            try {
                dialog.innerHTML = `
                    <div class="dialog-card text-center" style="padding: 24px;">
                        <div class="spinner" style="margin: 20px auto;"></div>
                        <p class="text-muted text-sm">Submitting elevation request...</p>
                    </div>
                `;
                await api.submitRequest('adult_elevation');
                toast('Elevation request submitted successfully', 'success');
                dialog.close();
                
                const currentPath = window.location.pathname;
                if (currentPath === '/profile' || currentPath === '/explorer' || currentPath === '/library') {
                    window.location.reload();
                }
            } catch (e) {
                toast(e.message, 'error');
                dialog.close();
            }
        });
    }
    
    const reloadBtn = dialog.querySelector('.reload-btn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }
}
