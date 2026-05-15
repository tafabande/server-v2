/**
 * MediaHub — Shared Utilities
 */

export function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'all 0.2s ease';
        setTimeout(() => el.remove(), 250);
    }, 3000);
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
    if (media.thumbnail_path) return media.thumbnail_path;
    return '/static/placeholder.svg';
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
