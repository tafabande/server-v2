import { api } from '../app.js';

/**
 * Admin View
 */
export const AdminView = {
    html: `
        <div class="admin-dashboard">
            <header class="view-header">
                <h2>Administrative Oversight</h2>
                <p class="section-note">Real-time system health and governance.</p>
            </header>

            <div class="metrics-grid">
                <article class="metric-card">
                    <span class="metric-label">CPU Usage</span>
                    <strong id="cpu-value" class="metric-value">--%</strong>
                    <div class="progress-bar"><div id="cpu-bar" class="progress-fill" style="width: 0%"></div></div>
                </article>
                <article class="metric-card">
                    <span class="metric-label">RAM Usage</span>
                    <strong id="ram-value" class="metric-value">--%</strong>
                    <div class="progress-bar"><div id="ram-bar" class="progress-fill" style="width: 0%"></div></div>
                </article>
                <article class="metric-card">
                    <span class="metric-label">Storage</span>
                    <strong id="disk-value" class="metric-value">--%</strong>
                    <div class="progress-bar"><div id="disk-bar" class="progress-fill" style="width: 0%"></div></div>
                </article>
            </div>

            <section class="admin-sections">
                <div class="admin-card">
                    <h3>Active Sessions ("Now Playing")</h3>
                    <div id="active-sessions-list" class="session-list">
                        <p class="empty-note">No active streams detected on the LAN.</p>
                    </div>
                </div>

                <div class="admin-card">
                    <h3>Transcoding Pipeline Logs</h3>
                    <div id="transcode-logs" class="log-viewer">
                        <code id="log-content">Waiting for transcoding events...</code>
                    </div>
                </div>

                <div class="admin-card">
                    <h3>User Management</h3>
                    <div id="user-management-table" class="user-table">
                         <p class="section-note">Loading users...</p>
                    </div>
                    <button class="primary-button small-button">Add New User</button>
                </div>
            </section>
        </div>
    `,
    init: async () => {
        const updateMetrics = async () => {
            try {
                const data = await api.request('/api/system/metrics');
                
                document.getElementById('cpu-value').textContent = `${data.cpu}%`;
                document.getElementById('cpu-bar').style.width = `${data.cpu}%`;
                
                const ramPercent = data.memory.percent;
                document.getElementById('ram-value').textContent = `${ramPercent}%`;
                document.getElementById('ram-bar').style.width = `${ramPercent}%`;
                
                const diskPercent = data.disk.percent;
                document.getElementById('disk-value').textContent = `${diskPercent}%`;
                document.getElementById('disk-bar').style.width = `${diskPercent}%`;
            } catch (e) {
                console.error('Failed to fetch metrics', e);
            }
        };

        const updateSessions = async () => {
            try {
                const sessions = await api.request('/api/system/sessions');
                const list = document.getElementById('active-sessions-list');
                if (sessions.length === 0) {
                    list.innerHTML = '<p class="empty-note">No active streams detected.</p>';
                    return;
                }
                list.innerHTML = sessions.map(s => `
                    <div class="session-item">
                        <strong>${s.username}</strong> is watching <em>${s.title}</em>
                        <span class="session-meta">${s.stream_mode} / ${Math.floor(s.position_seconds)}s</span>
                    </div>
                `).join('');
            } catch (e) {
                console.error('Failed to fetch sessions', e);
            }
        };

        updateMetrics();
        updateSessions();
        const metricsInterval = setInterval(updateMetrics, 5000);
        const sessionsInterval = setInterval(updateSessions, 5000);
        
        const socketHandler = (e) => {
            const msg = e.detail;
            if (msg.type === 'transcoding-log') {
                const logEl = document.getElementById('log-content');
                if (logEl) {
                    const line = document.createElement('div');
                    line.className = 'log-line';
                    line.textContent = `[Media ${msg.media_id}] ${msg.line}`;
                    logEl.appendChild(line);
                    logEl.scrollTop = logEl.scrollHeight;
                }
            }
        };

        window.addEventListener('mediahub-socket-message', socketHandler);

        // Store interval IDs on the view for cleanup if needed (though router doesn't explicitly cleanup yet)
        window._adminIntervals = [metricsInterval, sessionsInterval];
    }
};
