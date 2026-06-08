/**
 * MediaHub — Shared Utilities
 */

export function toast(message, type = 'info', action = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type} flex-between gap-md`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    if (type === 'success') icon.textContent = '✅';
    else if (type === 'error') icon.textContent = '❌';
    else if (type === 'warning') icon.textContent = '⚠️';
    else icon.textContent = 'ℹ️';

    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.gap = '12px';

    const text = document.createElement('span');
    text.textContent = message;
    text.style.fontWeight = '500';

    content.appendChild(icon);
    content.appendChild(text);

    el.appendChild(content);

    if (action) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-accent';
        btn.style.marginLeft = '12px';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            action.onClick();
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px) scale(0.95)';
            setTimeout(() => el.remove(), 250);
        });
        el.appendChild(btn);
    }

    container.appendChild(el);

    if (!action) {
        setTimeout(() => {
            if (!el.parentElement) return;
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px) scale(0.95)';
            el.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            setTimeout(() => el.remove(), 300);
        }, 3500);
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

function withR18Param(url) {
    if (!url || url.startsWith('/static/')) return url;
    if (isNsfwEnabled() || url.includes('disable_r18=')) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}disable_r18=true`;
}

export function thumbUrl(mediaOrId) {
    if (mediaOrId == null) return '/static/placeholder.svg';

    let url = '/static/placeholder.svg';

    if (typeof mediaOrId === 'number' || (typeof mediaOrId === 'string' && /^\d+$/.test(mediaOrId))) {
        url = `/api/media/${mediaOrId}/thumbnail`;
    } else if (typeof mediaOrId === 'object') {
        if (mediaOrId.thumbnail_path) {
            try {
                const decoded = decodeURIComponent(mediaOrId.thumbnail_path);
                url = decoded.split('/').map(s => s ? encodeURIComponent(s) : '').join('/');
            } catch {
                url = mediaOrId.thumbnail_path.split('/').map(s => s ? encodeURIComponent(s) : '').join('/');
            }
        } else if (mediaOrId.id != null) {
            url = `/api/media/${mediaOrId.id}/thumbnail`;
        }
    }

    return withR18Param(url);
}

export function homeCacheKey() {
    return `mediahub_home_cache_${sessionStorage.getItem('r18_enabled') || 'false'}`;
}

export function clearContentCaches() {
    const r18 = sessionStorage.getItem('r18_enabled') || 'false';
    ['true', 'false'].forEach((state) => {
        localStorage.removeItem(`mediahub_home_cache_${state}`);
    });
    localStorage.removeItem('mediahub_home_cache');
    localStorage.removeItem('mediahub_home_cache_time');
    localStorage.removeItem(`mediahub_home_cache_${r18}_time`);
}

export function isNsfwEnabled() {
    return sessionStorage.getItem('r18_enabled') === 'true';
}

export function syncNsfwFromUser(user) {
    if (!user) {
        sessionStorage.setItem('r18_enabled', 'false');
        return false;
    }
    const isAdult = user.role === 'admin' || user.role === 'super-admin' || user.is_adult === true;
    if (!isAdult) {
        sessionStorage.setItem('r18_enabled', 'false');
        return false;
    }
    if (sessionStorage.getItem('r18_enabled') === null) {
        const enabled = user.preferences?.nsfw === true;
        sessionStorage.setItem('r18_enabled', enabled ? 'true' : 'false');
    }
    return sessionStorage.getItem('r18_enabled') === 'true';
}

export async function persistNsfwPreference(enabled) {
    const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
    user.preferences = user.preferences || {};
    user.preferences.nsfw = enabled;
    sessionStorage.setItem('r18_enabled', enabled ? 'true' : 'false');
    localStorage.setItem('mediahub_user', JSON.stringify(user));
    clearContentCaches();

    const { api } = await import('./app.js');
    await api.updateProfile({ preferences: user.preferences });
    return user;
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
    const { api, router } = await import('./app.js');

    let dialog = document.getElementById('adult-access-dialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'adult-access-dialog';
        dialog.className = 'glass-modal';
        dialog.style.maxWidth = '400px';
        document.body.appendChild(dialog);
    }

    dialog.innerHTML = `
        <div class="dialog-card text-center" style="position: relative;">
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
                    <strong>Admin Comment:</strong> "${escapeHtml(latestReq.admin_comment || 'No reason provided.')}"
                </div>
                <div class="dialog-actions" style="display: flex; flex-direction: column; gap: 8px;">
                    <button class="btn btn-accent w-100 profile-settings-btn">Open Profile Settings</button>
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
                This folder or video is marked as <strong>R18 / Adult Content</strong>. Use Profile settings to request access.
            </p>
            <div class="dialog-actions" style="display: flex; flex-direction: column; gap: 8px;">
                <button class="btn btn-accent w-100 profile-settings-btn">Open Profile Settings</button>
                <button class="btn btn-ghost w-100 close-dialog">Close</button>
            </div>
        `;
    }

    dialog.innerHTML = `
        <div class="dialog-card text-center" style="position: relative;">
            <button class="close-dialog" style="position: absolute; top: 12px; right: 12px; border: none; background: transparent; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
            ${contentHtml}
        </div>
    `;

    const closeBtns = dialog.querySelectorAll('.close-dialog');
    closeBtns.forEach(btn => btn.addEventListener('click', () => dialog.close()));

    dialog.querySelectorAll('.profile-settings-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            dialog.close();
            router.navigate('/profile');
        });
    });

    const reloadBtn = dialog.querySelector('.reload-btn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }
}

export function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>"']/g, (m) => {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#039;';
            default: return m;
        }
    });
}

export function showPinDialog(message = "This content is PG-Locked.") {
    return new Promise((resolve) => {
        const dialog = document.getElementById('pin-dialog');
        if (!dialog) {
            resolve(null);
            return;
        }

        const msgEl = document.getElementById('pin-dialog-message');
        if (msgEl) msgEl.textContent = message;

        const dots = dialog.querySelectorAll('.pin-dot');
        let currentPin = "";

        const updateDisplay = () => {
            dots.forEach((dot, idx) => {
                if (idx < currentPin.length) {
                    dot.classList.add('filled');
                } else {
                    dot.classList.remove('filled');
                    dot.classList.remove('error');
                }
            });
        };

        const handleKey = (val) => {
            if (currentPin.length < 4) {
                currentPin += val;
                updateDisplay();
                
                if (currentPin.length === 4) {
                    setTimeout(() => {
                        cleanup();
                        dialog.close();
                        resolve(currentPin);
                    }, 200);
                }
            }
        };

        const handleClear = () => {
            if (currentPin.length > 0) {
                currentPin = currentPin.slice(0, -1);
                updateDisplay();
            }
        };

        const handleCancel = () => {
            cleanup();
            dialog.close();
            resolve(null);
        };

        // Keypad buttons
        const keyButtons = dialog.querySelectorAll('.pin-key[data-value]');
        const onKeyClick = (e) => {
            handleKey(e.target.dataset.value);
        };
        keyButtons.forEach(btn => btn.addEventListener('click', onKeyClick));

        const clearBtn = dialog.querySelector('#pin-btn-clear');
        if (clearBtn) clearBtn.addEventListener('click', handleClear);

        const cancelBtn = dialog.querySelector('#pin-btn-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);

        // Keyboard support
        const onKeyDown = (e) => {
            if (e.key >= '0' && e.key <= '9') {
                handleKey(e.key);
            } else if (e.key === 'Backspace') {
                handleClear();
            } else if (e.key === 'Escape') {
                handleCancel();
            }
        };
        window.addEventListener('keydown', onKeyDown);

        const cleanup = () => {
            keyButtons.forEach(btn => btn.removeEventListener('click', onKeyClick));
            if (clearBtn) clearBtn.removeEventListener('click', handleClear);
            if (cancelBtn) cancelBtn.removeEventListener('click', handleCancel);
            window.removeEventListener('keydown', onKeyDown);
        };

        // Initialize state
        currentPin = "";
        updateDisplay();
        dialog.showModal();
    });
}
