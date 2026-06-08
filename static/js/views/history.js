/**
 * MediaHub — History View
 */
import { api, player } from '../app.js';
import { formatDuration, formatDateTime, toast, confirm } from '../utils.js';

export class HistoryView {
    constructor(container) { this.container = container; }

    async render() {
        this.container.innerHTML = `
            <div class="flex-between mb-md">
                <div>
                    <h1 class="page-title">Watch History</h1>
                    <p class="page-subtitle">Your recent activity</p>
                </div>
                <button id="clear-history" class="btn btn-danger btn-sm">Clear All</button>
            </div>
            <div id="history-list">
                <div class="loading-state"><div class="spinner"></div> Loading...</div>
            </div>
        `;

        document.getElementById('clear-history').addEventListener('click', () => this._clearAll());
        await this._loadHistory();
    }

    async _loadHistory() {
        try {
            const res = await api.getHistory();
            const items = Array.isArray(res) ? res : (res?.items || []);
            const target = document.getElementById('history-list');

            if (!items || items.length === 0) {
                target.innerHTML = '<div class="empty-state"><p>No watch history yet</p></div>';
                return;
            }

            target.innerHTML = `
                <div class="surface" style="padding:0; overflow:hidden;">
                    <table class="table">
                        <thead><tr><th>Title</th><th>Progress</th><th>Last Watched</th><th>Status</th></tr></thead>
                        <tbody>${items.map(item => {
                const pct = item.media.duration_seconds ?
                    Math.round((item.last_position_seconds / item.media.duration_seconds) * 100) : 0;
                const thumbSrc = item.media.id ? `/api/media/${item.media.id}/thumbnail` : '/static/placeholder.svg';
                return `
                                <tr class="history-row" data-media='${JSON.stringify(item.media).replace(/'/g, "&#39;")}' style="cursor:pointer">
                                    <td>
                                        <div style="display:flex;align-items:center;gap:12px">
                                            <img src="${thumbSrc}" class="history-thumb" onerror="this.src='/static/placeholder.svg'">
                                            <strong>${item.media.title}</strong>
                                        </div>
                                    </td>
                                    <td>
                                        <div class="flex gap-sm" style="align-items:center">
                                            <div class="progress" style="width:80px">
                                                <div class="progress-fill ${item.completed ? 'success' : ''}" style="width:${pct}%"></div>
                                            </div>
                                            <span class="text-muted text-sm">${pct}%</span>
                                        </div>
                                    </td>
                                    <td class="text-muted">${formatDateTime(item.updated_at)}</td>
                                    <td>${item.completed ?
                        '<span class="badge badge-success">Done</span>' :
                        `<span class="badge badge-accent">${formatDuration(item.last_position_seconds)}</span>`
                    }</td>
                                </tr>
                            `;
            }).join('')}</tbody>
                    </table>
                </div>
            `;

            const historyItems = items.map(item => item.media);
            target.querySelectorAll('.history-row').forEach((row, index) => {
                row.addEventListener('click', () => {
                    try { player.play(historyItems, index); }
                    catch { toast('Could not play', 'error'); }
                });
            });
        } catch (err) {
            document.getElementById('history-list').innerHTML =
                `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    async _clearAll() {
        const yes = await confirm('Clear History', 'Delete all watch history? This cannot be undone.');
        if (!yes) return;
        try {
            await api.clearHistory();
            toast('History cleared', 'success');
            await this._loadHistory();
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    destroy() { }
}
