/**
 * MediaHub — Admin View
 * System metrics, user management, transcoding, audit logs.
 */
import { api } from '../app.js';
import { toast, confirm, formatDateTime } from '../utils.js';

export class AdminView {
    constructor(container) { this.container = container; }

    async render() {
        this.container.innerHTML = `
            <div class="flex-between mb-md">
                <div>
                    <h1 class="page-title">Admin</h1>
                    <p class="page-subtitle">System management</p>
                </div>
                <button id="rescan-btn" class="btn btn-accent btn-sm">↻ Rescan Library</button>
            </div>

            <div class="tabs" id="admin-tabs">
                <button class="tab active" data-tab="metrics">System</button>
                <button class="tab" data-tab="users">Users</button>
                <button class="tab" data-tab="webhooks">Webhooks</button>
                <button class="tab" data-tab="requests">Requests</button>
                <button class="tab" data-tab="audit">Audit Log</button>
            </div>

            <div id="admin-content"></div>
        `;

        document.getElementById('rescan-btn').addEventListener('click', () => this._rescan());
        document.getElementById('admin-tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;
            document.querySelectorAll('#admin-tabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            this._loadTab(tab.dataset.tab);
        });

        await this._loadTab('metrics');
    }

    async _loadTab(tab) {
        const content = document.getElementById('admin-content');
        content.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

        switch (tab) {
            case 'metrics': return this._loadMetrics(content);
            case 'users': return this._loadUsers(content);
            case 'webhooks': return this._loadWebhooks(content);
            case 'requests': return this._loadRequests(content);
            case 'audit': return this._loadAudit(content);
        }
    }

    async _loadMetrics(target) {
        try {
            const metrics = (await api.getMetrics()) || {};
            target.innerHTML = `
                <div class="metrics-grid">
                    ${this._metricCard('CPU', `${metrics.cpu_percent.toFixed(1)}%`, metrics.cpu_percent)}
                    ${this._metricCard('Memory', `${metrics.memory_used_gb.toFixed(1)} / ${metrics.memory_total_gb.toFixed(1)} GB`, metrics.memory_percent)}
                    ${this._metricCard('Disk', `${metrics.disk_used_gb.toFixed(1)} / ${metrics.disk_total_gb.toFixed(1)} GB`, metrics.disk_percent)}
                    ${this._metricCard('FFmpeg', metrics.ffmpeg_available ? 'Available' : 'Missing', metrics.ffmpeg_available ? 0 : 100)}
                </div>
            `;
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    _metricCard(label, value, pct) {
        const color = pct > 80 ? 'error' : pct > 60 ? 'warning' : '';
        return `
            <div class="surface metric-card">
                <span class="label">${label}</span>
                <div class="metric-value">${value}</div>
                <div class="progress mt-sm"><div class="progress-fill ${color}" style="width:${Math.min(pct, 100)}%"></div></div>
            </div>
        `;
    }

    async _loadUsers(target) {
        try {
            const users = await api.getUsers();
            target.innerHTML = `
                <div class="surface mb-md">
                    <div class="section-title">Add User</div>
                    <form id="add-user-form" class="form-row" style="align-items:end">
                        <div class="form-group" style="margin:0"><label>Username</label><input id="au-name" class="input" required minlength="3"></div>
                        <div class="form-group" style="margin:0"><label>Password</label><input id="au-pass" class="input" type="password" required minlength="8"></div>
                        <div class="form-group" style="margin:0">
                            <label>Role</label>
                            <select id="au-role" class="select"><option>family</option><option>admin</option><option>guest</option></select>
                        </div>
                        <button type="submit" class="btn btn-accent">Add</button>
                    </form>
                </div>

                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table">
                        <thead><tr><th>Username</th><th>Role</th><th>Last Login</th><th>Created</th><th>Actions</th></tr></thead>
                        <tbody>${users.map(u => `
                            <tr>
                                <td><strong>${u.username}</strong></td>
                                <td><span class="badge ${u.role === 'admin' ? 'badge-accent' : u.role === 'guest' ? 'badge-muted' : 'badge-success'}">${u.role}</span></td>
                                <td class="text-muted">${formatDateTime(u.last_login)}</td>
                                <td class="text-muted">${formatDateTime(u.created_at)}</td>
                                <td>
                                    <div class="flex gap-sm">
                                        <button class="btn btn-ghost btn-sm reset-pw-btn" data-id="${u.id}" data-name="${u.username}">Reset PW</button>
                                        <button class="btn btn-ghost btn-sm btn-danger del-user-btn" data-id="${u.id}" data-name="${u.username}">Delete</button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>
            `;

            document.getElementById('add-user-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                try {
                    await api.createUser({
                        username: document.getElementById('au-name').value,
                        password: document.getElementById('au-pass').value,
                        role: document.getElementById('au-role').value,
                    });
                    toast('User created', 'success');
                    this._loadUsers(target);
                } catch (err) { toast(err.message, 'error'); }
            });

            target.querySelectorAll('.reset-pw-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pw = prompt(`New password for ${btn.dataset.name}:`);
                    if (!pw || pw.length < 8) { toast('Password must be 8+ characters', 'error'); return; }
                    try {
                        await api.resetUserPassword(parseInt(btn.dataset.id), pw);
                        toast('Password reset', 'success');
                    } catch (err) { toast(err.message, 'error'); }
                });
            });

            target.querySelectorAll('.del-user-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const yes = await confirm('Delete User', `Delete "${btn.dataset.name}"?`);
                    if (!yes) return;
                    try {
                        await api.deleteUser(parseInt(btn.dataset.id));
                        toast('User deleted', 'success');
                        this._loadUsers(target);
                    } catch (err) { toast(err.message, 'error'); }
                });
            });
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    async _loadWebhooks(target) {
        try {
            const hooks = await api.getWebhooks();
            target.innerHTML = `
                <div class="surface mb-md">
                    <div class="section-title">Register Webhook</div>
                    <form id="add-webhook-form" class="flex flex-column gap-sm">
                        <div class="form-group"><label>Target URL</label><input id="wh-url" class="input" placeholder="https://your-service.com/webhook" required></div>
                        <div class="flex gap-sm">
                            <div class="form-group flex-1"><label>Events (comma-separated, * for all)</label><input id="wh-events" class="input" value="*"></div>
                            <div class="form-group flex-1"><label>Secret Key (optional)</label><input id="wh-secret" class="input" type="password"></div>
                        </div>
                        <button type="submit" class="btn btn-accent" style="align-self: flex-start">Register Endpoint</button>
                    </form>
                </div>

                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table">
                        <thead><tr><th>URL</th><th>Events</th><th>Status</th><th>Failures</th><th>Last Triggered</th><th>Actions</th></tr></thead>
                        <tbody>${hooks.map(h => `
                            <tr>
                                <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis"><strong>${h.url}</strong></td>
                                <td><code>${h.events}</code></td>
                                <td><span class="badge ${h.is_active ? 'badge-success' : 'badge-danger'}">${h.is_active ? 'Active' : 'Disabled'}</span></td>
                                <td class="text-center">${h.failure_count}</td>
                                <td class="text-muted">${formatDateTime(h.last_triggered_at)}</td>
                                <td>
                                    <div class="flex gap-sm">
                                        <button class="btn btn-ghost btn-sm toggle-wh-btn" data-id="${h.id}" data-active="${h.is_active}">${h.is_active ? 'Disable' : 'Enable'}</button>
                                        <button class="btn btn-ghost btn-sm btn-danger del-wh-btn" data-id="${h.id}">Delete</button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>
            `;

            document.getElementById('add-webhook-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                try {
                    await api.createWebhook({
                        url: document.getElementById('wh-url').value,
                        events: document.getElementById('wh-events').value,
                        secret: document.getElementById('wh-secret').value || null
                    });
                    toast('Webhook registered', 'success');
                    this._loadWebhooks(target);
                } catch (err) { toast(err.message, 'error'); }
            });

            target.querySelectorAll('.toggle-wh-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        const newStatus = btn.dataset.active === 'false';
                        await api.updateWebhook(parseInt(btn.dataset.id), { is_active: newStatus });
                        toast(`Webhook ${newStatus ? 'enabled' : 'disabled'}`, 'success');
                        this._loadWebhooks(target);
                    } catch (err) { toast(err.message, 'error'); }
                });
            });

            target.querySelectorAll('.del-wh-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const yes = await confirm('Delete Webhook', 'Are you sure you want to delete this endpoint?');
                    if (!yes) return;
                    try {
                        await api.deleteWebhook(parseInt(btn.dataset.id));
                        toast('Webhook deleted', 'success');
                        this._loadWebhooks(target);
                    } catch (err) { toast(err.message, 'error'); }
                });
            });
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    async _loadRequests(target) {
        try {
            const requests = (await api.getRequests()) || [];
            if (!requests || requests.length === 0) {
                target.innerHTML = '<div class="empty-state"><p>No pending requests</p></div>';
                return;
            }

            target.innerHTML = `
                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table">
                        <thead><tr><th>User</th><th>Type</th><th>Target</th><th>Date</th><th>Actions</th></tr></thead>
                        <tbody>${requests.map(req => `
                            <tr>
                                <td><strong>${req.username}</strong></td>
                                <td><span class="badge badge-accent">${req.request_type.replace('_', ' ')}</span></td>
                                <td class="text-muted">${req.target_path || 'N/A'}</td>
                                <td class="text-muted">${formatDateTime(req.created_at)}</td>
                                <td>
                                    ${req.status === 'pending' ? `
                                        <div class="flex gap-sm">
                                            <button class="btn btn-ghost btn-sm approve-btn" data-id="${req.id}">Approve</button>
                                            <button class="btn btn-ghost btn-sm btn-danger deny-btn" data-id="${req.id}">Deny</button>
                                        </div>
                                    ` : `<span class="badge ${req.status === 'approved' ? 'badge-success' : 'badge-danger'}">${req.status}</span>`}
                                </td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>
            `;

            target.querySelectorAll('.approve-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const comment = prompt('Admin comment (optional):');
                    try {
                        await api.processRequest(parseInt(btn.dataset.id), 'approved', comment);
                        toast('Request approved', 'success');
                        this._loadRequests(target);
                    } catch (err) { toast(err.message, 'error'); }
                });
            });

            target.querySelectorAll('.deny-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const comment = prompt('Reason for denial:');
                    if (!comment) return;
                    try {
                        await api.processRequest(parseInt(btn.dataset.id), 'denied', comment);
                        toast('Request denied', 'success');
                        this._loadRequests(target);
                    } catch (err) { toast(err.message, 'error'); }
                });
            });
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    async _loadAudit(target) {
        try {
            const logs = await api.getAudit();
            if (!logs || logs.length === 0) {
                target.innerHTML = '<div class="empty-state"><p>No audit events</p></div>';
                return;
            }

            target.innerHTML = `
                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table">
                        <thead><tr><th>Action</th><th>Target</th><th>Time</th></tr></thead>
                        <tbody>${logs.map(log => `
                            <tr>
                                <td><span class="badge badge-muted">${log.action}</span></td>
                                <td class="text-muted">${log.target_path || '—'}</td>
                                <td class="text-muted">${formatDateTime(log.created_at)}</td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>
            `;
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    async _rescan() {
        try {
            const result = await api.rescan();
            toast(result.message, 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    destroy() {}
}
