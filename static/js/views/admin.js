/**
 * MediaHub — Overhauled Admin Dashboard
 * System metrics, log streams, system fixes, users, webhooks, requests, media management.
 */
import { api } from '../app.js';
import { toast, confirm, formatDateTime } from '../utils.js';

export class AdminView {
    constructor(container) { 
        this.container = container; 
        this._mediaList = [];
    }

    async render() {
        this.container.innerHTML = `
            <div class="flex-between mb-md">
                <div>
                    <h1 class="page-title">Admin Console</h1>
                    <p class="page-subtitle">Master command deck for your LAN media network</p>
                </div>
                <div class="flex gap-sm">
                    <button id="rescan-btn" class="btn btn-accent btn-sm">↻ Scan Library</button>
                </div>
            </div>

            <div class="tabs" id="admin-tabs">
                <button class="tab active" data-tab="metrics">System & Fixes</button>
                <button class="tab" data-tab="users">Users</button>
                <button class="tab" data-tab="media">Media & Site</button>
                <button class="tab" data-tab="webhooks">Webhooks</button>
                <button class="tab" data-tab="requests">Requests</button>
                <button class="tab" data-tab="audit">Audit Log</button>
            </div>

            <div id="admin-content" class="fade-in"></div>
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
        content.innerHTML = `
            <div class="skeleton-grid" style="margin-top:20px;">
                ${Array(3).fill().map(() => `
                    <div class="skeleton-card">
                        <div class="skeleton-poster shimmer-bg" style="aspect-ratio:3/1; height:80px;"></div>
                        <div class="skeleton-title shimmer-bg"></div>
                        <div class="skeleton-meta shimmer-bg"></div>
                    </div>
                `).join('')}
            </div>
        `;

        switch (tab) {
            case 'metrics': return this._loadMetrics(content);
            case 'users': return this._loadUsers(content);
            case 'media': return this._loadMediaManagement(content);
            case 'webhooks': return this._loadWebhooks(content);
            case 'requests': return this._loadRequests(content);
            case 'audit': return this._loadAudit(content);
        }
    }

    async _loadMetrics(target) {
        try {
            const metrics = await api.getMetrics();
            let errors = [];
            try {
                errors = await api.getRecentErrors();
            } catch (e) {
                errors = ["Failed to retrieve server logs."];
            }

            target.innerHTML = `
                <div class="metrics-grid">
                    ${this._metricCard('CPU Status', `${metrics.cpu_percent.toFixed(1)}%`, metrics.cpu_percent)}
                    ${this._metricCard('Memory Allocation', `${metrics.memory_used_gb.toFixed(1)} / ${metrics.memory_total_gb.toFixed(1)} GB`, metrics.memory_percent)}
                    ${this._metricCard('Disk Allocation', `${metrics.disk_used_gb.toFixed(1)} / ${metrics.disk_total_gb.toFixed(1)} GB`, metrics.disk_percent)}
                </div>

                <div class="grid grid-2 gap-md mt-lg">
                    <!-- System Maintenance Tools -->
                    <div class="surface">
                        <div class="section-title">System Maintenance & Repairs</div>
                        <p class="text-muted text-xs mb-md">Execute small fixes and server maintenance protocols:</p>
                        <div class="flex flex-column gap-sm">
                            <button id="btn-fix-db" class="btn btn-ghost w-100 flex-between">
                                <span>🛠️ Optimize Database File (Vacuum)</span>
                                <span class="badge badge-accent">VACUUM</span>
                            </button>
                            <button id="btn-fix-hls" class="btn btn-ghost w-100 flex-between">
                                <span>🗑️ Purge Temp HLS Segments Cache</span>
                                <span class="badge badge-warning">TEMP HLS</span>
                            </button>
                            <button id="btn-fix-thumbs" class="btn btn-ghost w-100 flex-between">
                                <span>🖼️ Purge Thumbnail Generation Cache</span>
                                <span class="badge badge-muted">THUMBS</span>
                            </button>
                            <button id="btn-shutdown" class="btn btn-ghost btn-danger w-100 flex-between">
                                <span>🛑 Graceful Shutdown Server</span>
                                <span class="badge badge-danger">SHUTDOWN</span>
                            </button>
                        </div>
                    </div>

                    <!-- Platform & Diagnostic specs -->
                    <div class="surface">
                        <div class="section-title">Diagnostic Specifications</div>
                        <div class="table-wrap">
                            <table class="table" style="font-size: 0.8rem;">
                                <tbody>
                                    <tr><td><strong>Platform OS</strong></td><td class="text-muted">${metrics.platform || 'unknown'}</td></tr>
                                    <tr><td><strong>Server Local Time</strong></td><td class="text-muted">${formatDateTime(metrics.server_time)}</td></tr>
                                    <tr><td><strong>Time Synchronization</strong></td><td class="text-muted">${metrics.time_sync || 'unknown'}</td></tr>
                                    <tr><td><strong>mDNS Zeroconf</strong></td><td class="text-muted">${metrics.mdns_active ? '✅ Active' : '❌ Offline'}</td></tr>
                                    <tr><td><strong>ECC Error Correcting RAM</strong></td><td class="text-muted">${metrics.ecc_ram || 'unknown'}</td></tr>
                                    <tr><td><strong>FFmpeg Decoding</strong></td><td class="text-muted">${metrics.ffmpeg_available ? '✅ Available' : '❌ Missing'}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- Recent Server Errors console -->
                <div class="surface mt-lg">
                    <div class="section-title flex-between">
                        <span>Recent Server Error logs</span>
                        <button id="refresh-logs-btn" class="btn btn-sm btn-ghost">↻ Refresh Logs</button>
                    </div>
                    <pre id="logs-terminal" style="background:#0a0a0d; color:#ef4444; border:1px solid var(--border); padding:16px; border-radius:var(--radius); overflow-y:auto; max-height:220px; font-family:var(--font-mono); font-size:0.75rem; line-height:1.4; white-space:pre-wrap;"></pre>
                </div>
            `;

            // Logs text population
            const term = document.getElementById('logs-terminal');
            if (term) {
                term.textContent = errors.length > 0 ? errors.join('\n') : "No recent errors logged in mediahub.log.";
            }

            // Bind Maintenance Actions
            document.getElementById('refresh-logs-btn')?.addEventListener('click', async () => {
                const refreshed = await api.getRecentErrors();
                if (term) term.textContent = refreshed.join('\n');
                toast('Logs re-cached', 'success');
            });

            document.getElementById('btn-fix-db')?.addEventListener('click', async (e) => {
                e.currentTarget.disabled = true;
                try {
                    const res = await api.optimizeDatabase();
                    toast(res.message, 'success');
                } catch (e) { toast(e.message, 'error'); }
                e.currentTarget.disabled = false;
            });

            document.getElementById('btn-fix-hls')?.addEventListener('click', async (e) => {
                e.currentTarget.disabled = true;
                try {
                    const res = await api.clearHLSCache();
                    toast(res.message, 'success');
                } catch (e) { toast(e.message, 'error'); }
                e.currentTarget.disabled = false;
            });

            document.getElementById('btn-fix-thumbs')?.addEventListener('click', async (e) => {
                e.currentTarget.disabled = true;
                try {
                    const res = await api.clearThumbsCache();
                    toast(res.message, 'success');
                } catch (e) { toast(e.message, 'error'); }
                e.currentTarget.disabled = false;
            });

            document.getElementById('btn-shutdown')?.addEventListener('click', async () => {
                const yes = await confirm('Shutdown Server', 'Are you sure you want to stop the FastAPI server? You will lose access until restarted manually.');
                if (!yes) return;
                try {
                    await api.request('/api/system/shutdown', { method: 'POST' });
                    toast('Shutdown sequence initiated', 'warning');
                } catch (e) { toast(e.message, 'error'); }
            });

        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    _metricCard(label, value, pct) {
        const color = pct > 80 ? 'error' : pct > 60 ? 'warning' : 'success';
        return `
            <div class="surface metric-card">
                <span class="label">${label}</span>
                <div class="metric-value" style="font-size:1.4rem; font-weight:700; margin:4px 0;">${value}</div>
                <div class="progress mt-sm" style="height:4px;"><div class="progress-fill ${color}" style="width:${Math.min(pct, 100)}%"></div></div>
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
                        <div class="form-group" style="margin:0"><label>Username</label><input id="au-name" class="input" required minlength="3" autocomplete="off"></div>
                        <div class="form-group" style="margin:0"><label>Password</label><input id="au-pass" class="input" type="password" required minlength="8"></div>
                        <div class="form-group" style="margin:0">
                            <label>Role</label>
                            <select id="au-role" class="select"><option value="family">family</option><option value="admin">admin</option><option value="guest">guest</option></select>
                        </div>
                        <button type="submit" class="btn btn-accent">Add User</button>
                    </form>
                </div>

                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table">
                        <thead><tr><th>Username</th><th>Role / Elevation</th><th>Last Active</th><th>Joined</th><th>Actions</th></tr></thead>
                        <tbody>${users.map(u => `
                            <tr>
                                <td><strong>${u.username}</strong></td>
                                <td>
                                    <select class="select change-role-select" data-id="${u.id}" style="width:auto; padding:4px 8px; font-size:0.8rem;">
                                        <option value="family" ${u.role === 'family' ? 'selected' : ''}>family</option>
                                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                                        <option value="guest" ${u.role === 'guest' ? 'selected' : ''}>guest</option>
                                    </select>
                                </td>
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

            // Bind User Role Change Listeners
            target.querySelectorAll('.change-role-select').forEach(sel => {
                sel.addEventListener('change', async (e) => {
                    const userId = parseInt(sel.dataset.id);
                    const newRole = e.target.value;
                    try {
                        await api.updateUser(userId, { role: newRole });
                        toast(`Role updated to "${newRole}"`, 'success');
                    } catch (err) { toast(err.message, 'error'); }
                });
            });

            document.getElementById('add-user-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                try {
                    await api.createUser({
                        username: document.getElementById('au-name').value,
                        password: document.getElementById('au-pass').value,
                        role: document.getElementById('au-role').value,
                    });
                    toast('User created successfully', 'success');
                    this._loadUsers(target);
                } catch (err) { toast(err.message, 'error'); }
            });

            target.querySelectorAll('.reset-pw-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pw = prompt(`New password for ${btn.dataset.name}:`);
                    if (!pw || pw.length < 8) { toast('Password must be 8+ characters', 'error'); return; }
                    try {
                        await api.resetUserPassword(parseInt(btn.dataset.id), pw);
                        toast('Password reset completed', 'success');
                    } catch (err) { toast(err.message, 'error'); }
                });
            });

            target.querySelectorAll('.del-user-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const yes = await confirm('Delete User', `Permanently delete user "${btn.dataset.name}"?`);
                    if (!yes) return;
                    try {
                        await api.deleteUser(parseInt(btn.dataset.id));
                        toast('User account deleted', 'success');
                        this._loadUsers(target);
                    } catch (err) { toast(err.message, 'error'); }
                });
            });
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    async _loadMediaManagement(target) {
        try {
            const groups = await api.getLibrary();
            this._mediaList = groups.flatMap(g => g.items.map(m => ({ ...m, _category: g.label })));

            target.innerHTML = `
                <div class="surface mb-md flex-between" style="padding: 12px 20px;">
                    <div style="font-weight:700; color:var(--text);">Site Media: <span class="badge badge-accent">${this._mediaList.length} items</span></div>
                    <div class="search-bar" style="margin:0; width:220px;">
                        <input id="media-mgmt-search" class="input" type="text" placeholder="Search title or path...">
                    </div>
                </div>

                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table" id="media-mgmt-table">
                        <thead><tr><th>Preview</th><th>Title</th><th>Format Path</th><th>Security / Lock</th><th>Adult Content</th></tr></thead>
                        <tbody id="media-mgmt-tbody"></tbody>
                    </table>
                </div>
            `;

            const searchInput = document.getElementById('media-mgmt-search');
            searchInput.addEventListener('input', () => this._filterMediaList());

            this._renderMediaRows(this._mediaList);
        } catch (err) {
            target.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
        }
    }

    _renderMediaRows(items) {
        const tbody = document.getElementById('media-mgmt-tbody');
        if (!tbody) return;

        tbody.innerHTML = items.map(m => `
            <tr data-id="${m.id}">
                <td style="width:48px"><img src="/api/media/${m.id}/backdrop" style="width:36px; height:24px; object-fit:cover; border-radius:2px;" onerror="this.src='/static/placeholder.svg'"></td>
                <td><strong>${m.title}</strong></td>
                <td class="text-muted text-xs" style="max-width:320px; overflow:hidden; text-overflow:ellipsis;" title="${m.relative_path}">${m.relative_path}</td>
                <td>
                    <button class="btn btn-sm btn-ghost toggle-lock-btn ${m.requires_pin ? 'text-warning' : ''}" data-id="${m.id}">
                        ${m.requires_pin ? '🔒 Locked' : '🔓 Public'}
                    </button>
                </td>
                <td>
                    <button class="btn btn-sm btn-ghost toggle-adult-btn ${m.adult_only ? 'text-error' : ''}" data-id="${m.id}">
                        ${m.adult_only ? '🔞 R18+ Content' : '⚪ Safe (All)'}
                    </button>
                </td>
            </tr>
        `).join('');

        // Bind locks and adult triggers
        tbody.querySelectorAll('.toggle-lock-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const mediaId = parseInt(btn.dataset.id);
                try {
                    const res = await api.request(`/api/admin/pin/${mediaId}`, { method: 'POST' });
                    toast(res.message, 'success');
                    const m = this._mediaList.find(item => item.id === mediaId);
                    if (m) {
                        m.requires_pin = !m.requires_pin;
                        btn.classList.toggle('text-warning', m.requires_pin);
                        btn.innerHTML = m.requires_pin ? '🔒 Locked' : '🔓 Public';
                    }
                } catch (e) { toast(e.message, 'error'); }
            });
        });

        tbody.querySelectorAll('.toggle-adult-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const mediaId = parseInt(btn.dataset.id);
                const m = this._mediaList.find(item => item.id === mediaId);
                if (!m) return;
                const newAdult = !m.adult_only;
                try {
                    const res = await api.request('/api/admin/adult-flag', {
                        method: 'POST',
                        json: { media_ids: [mediaId], adult_only: newAdult }
                    });
                    toast(res.message, 'success');
                    m.adult_only = newAdult;
                    btn.classList.toggle('text-error', newAdult);
                    btn.innerHTML = newAdult ? '🔞 R18+ Content' : '⚪ Safe (All)';
                } catch (e) { toast(e.message, 'error'); }
            });
        });
    }

    _filterMediaList() {
        const q = document.getElementById('media-mgmt-search').value.toLowerCase().trim();
        if (!q) {
            this._renderMediaRows(this._mediaList);
            return;
        }

        const filtered = this._mediaList.filter(m => 
            m.title.toLowerCase().includes(q) || 
            m.relative_path.toLowerCase().includes(q)
        );
        this._renderMediaRows(filtered);
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
                    toast('Webhook registered successfully', 'success');
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
            const requests = await api.getRequests();
            if (!requests || requests.length === 0) {
                target.innerHTML = '<div class="empty-state"><p>No pending access requests</p></div>';
                return;
            }

            target.innerHTML = `
                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table">
                        <thead><tr><th>User</th><th>Request Scope</th><th>Target Path</th><th>Requested</th><th>Actions</th></tr></thead>
                        <tbody>${requests.map(req => `
                            <tr>
                                <td><strong>${req.username}</strong></td>
                                <td><span class="badge badge-accent">${req.request_type.replace('_', ' ')}</span></td>
                                <td class="text-muted text-xs" style="max-width:280px; overflow:hidden; text-overflow:ellipsis;">${req.target_path || 'All Site Access'}</td>
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
                        toast('Request approved successfully', 'success');
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
                        toast('Request denied successfully', 'success');
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
            if (!logs.items || logs.items.length === 0) {
                target.innerHTML = '<div class="empty-state"><p>No system audit logs found.</p></div>';
                return;
            }

            target.innerHTML = `
                <div class="surface" style="padding:0; overflow-x:auto">
                    <table class="table">
                        <thead><tr><th>Action Protocol</th><th>Target Path</th><th>Action Time</th></tr></thead>
                        <tbody>${logs.items.map(log => `
                            <tr>
                                <td><span class="badge badge-muted">${log.action}</span></td>
                                <td class="text-muted text-xs">${log.target_path || '—'}</td>
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
