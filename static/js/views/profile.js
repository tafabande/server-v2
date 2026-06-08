/**
 * MediaHub — Profile View
 */
import appInstance, { api } from '../app.js';
import { toast, formatDate, persistNsfwPreference } from '../utils.js';

export class ProfileView {
    constructor(container) { this.container = container; }

    async render() {
        let user;
        try {
            user = await api.me();
        } catch {
            this.container.innerHTML = '<div class="empty-state"><p>Could not load profile.</p></div>';
            return;
        }

        let requests = [];
        try {
            const res = await api.getRequests();
            requests = Array.isArray(res) ? res : (res?.items || []);
        } catch (e) {
            console.error("Could not fetch requests", e);
        }

        const latestAdultReq = requests
            .filter(r => r.request_type === 'adult_elevation')
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

        let adultReqSection = '';
        if (!user.is_adult) {
            if (latestAdultReq) {
                if (latestAdultReq.status === 'pending') {
                    adultReqSection = `
                        <div class="status-banner status-banner--warning">
                            <strong style="color: var(--warning);">18+ request pending</strong>
                            <div class="text-muted text-xs">Submitted ${formatDate(latestAdultReq.created_at)}</div>
                        </div>
                    `;
                } else if (latestAdultReq.status === 'denied') {
                    adultReqSection = `
                        <div class="status-banner status-banner--danger">
                            <strong style="color: var(--error);">18+ request denied</strong>
                            <div class="text-muted text-xs mb-sm">${formatDate(latestAdultReq.created_at)} — ${latestAdultReq.admin_comment || 'No reason provided.'}</div>
                            <button type="button" id="req-adult-btn" class="btn btn-sm btn-accent">Re-request 18+</button>
                        </div>
                    `;
                } else {
                    adultReqSection = `<button type="button" id="req-adult-btn" class="btn btn-ghost btn-sm mt-md">Request 18+ access</button>`;
                }
            } else {
                adultReqSection = `<button type="button" id="req-adult-btn" class="btn btn-ghost btn-sm mt-md">Request 18+ access</button>`;
            }
        }

        const initial = (user.username || '?')[0].toUpperCase();
        const canToggleSfw = user.role === 'admin' || user.role === 'super-admin' || user.is_adult === true;
        const sfwOn = user.preferences?.nsfw !== true;

        this.container.innerHTML = `
            <h1 class="page-title">Profile</h1>
            <p class="page-subtitle">Account & preferences</p>

            <div class="profile-grid">
                <div>
                    <div class="surface-bleed mb-md">
                        <div class="profile-header">
                            <div class="avatar">${user.avatar_url ? `<img src="${user.avatar_url}" alt="">` : initial}</div>
                            <div>
                                <h2 style="font-size:1.1rem; font-weight:700; margin:0">${user.username}</h2>
                                <div class="profile-badges">
                                    <span class="badge badge-accent">${user.role}</span>
                                    ${user.is_adult ? '<span class="badge badge-danger">18+</span>' : '<span class="badge badge-muted">Minor</span>'}
                                </div>
                            </div>
                        </div>
                        <div class="profile-meta">
                            <span>Joined ${formatDate(user.created_at)}</span>
                            <span>Last login ${formatDate(user.last_login)}</span>
                        </div>

                        <form id="profile-form">
                            <div class="form-group">
                                <label>Bio</label>
                                <textarea id="prof-bio" class="textarea" placeholder="A short bio...">${user.bio || ''}</textarea>
                            </div>
                            <button type="submit" class="btn btn-accent btn-sm">Save</button>
                            ${adultReqSection}
                        </form>
                    </div>

                    <div class="surface-bleed">
                        <div class="section-title">Password</div>
                        <form id="password-form">
                            <div class="form-group">
                                <label>Current</label>
                                <input id="pw-current" class="input" type="password" required>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>New</label>
                                    <input id="pw-new" class="input" type="password" required minlength="8">
                                </div>
                                <div class="form-group">
                                    <label>Confirm</label>
                                    <input id="pw-confirm" class="input" type="password" required minlength="8">
                                </div>
                            </div>
                            <p id="pw-error" class="text-error" hidden></p>
                            <button type="submit" class="btn btn-sm">Update password</button>
                        </form>
                    </div>

                    <div class="surface-bleed" style="margin-top: 16px;">
                        <div class="section-title">Folder PIN</div>
                        <p class="text-muted text-xs mb-sm">Unlock PIN-protected folders without the admin PIN.</p>
                        <form id="pin-form">
                            <div class="form-group">
                                <label>${user.has_pin ? 'Update PIN' : 'Set PIN'}</label>
                                <input id="pin-value" class="input" type="password" placeholder="4–12 digits" minlength="4" maxlength="12" pattern="[0-9]*" inputmode="numeric" required>
                            </div>
                            <div class="flex gap-sm items-center">
                                <button type="submit" class="btn btn-accent btn-sm">${user.has_pin ? 'Update' : 'Save'}</button>
                                ${user.has_pin ? `<button type="button" id="clear-pin-btn" class="btn btn-ghost btn-sm" style="color: var(--error);">Remove</button>` : ''}
                            </div>
                        </form>
                    </div>
                </div>

                <div>
                    <div class="surface-bleed mb-md">
                        <div class="section-title">Preferences</div>
                        <div class="pref-row">
                            <div>
                                <span class="pref-label">Theme</span>
                            </div>
                            <select id="pref-theme" class="select" style="width: auto; min-width: 100px;">
                                <option value="default" ${(user.preferences?.theme || 'default') === 'default' ? 'selected' : ''}>Dark</option>
                                <option value="light" ${user.preferences?.theme === 'light' ? 'selected' : ''}>Light</option>
                            </select>
                        </div>
                        ${canToggleSfw ? `
                        <div class="pref-row">
                            <div>
                                <span class="pref-label">SFW mode</span>
                                <span class="pref-hint text-muted text-xs">Hide 18+ content</span>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="pref-sfw" ${sfwOn ? 'checked' : ''}>
                                <span class="toggle-track"></span>
                            </label>
                        </div>
                        ` : ''}
                    </div>

                    <div class="surface-bleed mb-md">
                        <div class="section-title">Requests</div>
                        ${requests.length === 0 ? `
                            <p class="text-muted text-sm">No requests yet.</p>
                        ` : `
                            <div class="flex flex-column" style="max-height: 220px; overflow-y: auto;">
                                ${requests.map(r => {
            let statusBadge = '';
            if (r.status === 'approved') statusBadge = '<span class="badge badge-success">Approved</span>';
            else if (r.status === 'denied') statusBadge = '<span class="badge badge-error">Denied</span>';
            else statusBadge = '<span class="badge badge-warning">Pending</span>';

            const title = r.request_type === 'adult_elevation'
                ? '18+ access'
                : `Folder: ${r.target_path ? r.target_path.split('/').pop() : 'unknown'}`;

            return `
                                    <div class="request-card">
                                        <div class="flex-between mb-xs">
                                            <strong class="text-sm">${title}</strong>
                                            ${statusBadge}
                                        </div>
                                        <div class="text-muted text-xs">${formatDate(r.created_at)}</div>
                                        ${r.admin_comment ? `<div class="text-muted text-xs" style="margin-top:4px; font-style:italic;">${r.admin_comment}</div>` : ''}
                                    </div>
                                `;
        }).join('')}
                            </div>
                        `}
                    </div>

                    <div class="surface-bleed">
                        <div class="section-title">Account</div>
                        <p class="text-muted text-sm" style="margin-bottom:12px">
                            ID ${user.id} · ${user.role}
                        </p>
                        <button id="logout-profile" class="btn btn-danger btn-sm" style="width:100%">Logout</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('profile-form').addEventListener('submit', (e) => this._updateProfile(e));
        document.getElementById('password-form').addEventListener('submit', (e) => this._changePassword(e));

        document.getElementById('pin-form')?.addEventListener('submit', (e) => this._updatePin(e));
        document.getElementById('clear-pin-btn')?.addEventListener('click', () => this._clearPin());

        document.getElementById('logout-profile').addEventListener('click', () => {
            localStorage.removeItem('mediahub_token');
            localStorage.removeItem('mediahub_user');
            window.location.href = '/login';
        });

        document.getElementById('pref-theme')?.addEventListener('change', async (e) => {
            const selectedTheme = e.target.value;
            try {
                await api.updateProfile({ theme: selectedTheme });
                const stored = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
                stored.preferences = stored.preferences || {};
                stored.preferences.theme = selectedTheme;
                localStorage.setItem('mediahub_user', JSON.stringify(stored));
                document.documentElement.setAttribute('data-theme', selectedTheme);
                toast('Theme updated', 'success');
            } catch (err) {
                toast(err.message || 'Failed to update theme', 'error');
            }
        });

        document.getElementById('pref-sfw')?.addEventListener('change', async (e) => {
            const sfwOn = e.target.checked;
            const nextNsfw = !sfwOn;
            try {
                const updatedUser = await persistNsfwPreference(nextNsfw);
                const app = appInstance;
                if (app) {
                    app.store.set({ r18Enabled: nextNsfw, user: updatedUser });
                    app.updateUI();
                }
                toast(sfwOn ? 'SFW mode on' : 'SFW mode off', 'success');
            } catch (err) {
                e.target.checked = !sfwOn;
                toast(err.message || 'Failed to update preference', 'error');
            }
        });

        document.getElementById('req-adult-btn')?.addEventListener('click', async () => {
            const { confirm } = await import('../utils.js');
            const yes = await confirm('Request 18+ Access', 'Request elevation to 18+ status?');
            if (!yes) return;
            try {
                await api.submitRequest('adult_elevation');
                toast('Request submitted', 'success');
                this.render();
            } catch (err) {
                toast(err.message, 'error');
            }
        });
    }

    async _updateProfile(e) {
        e.preventDefault();
        try {
            await api.updateProfile({ bio: document.getElementById('prof-bio').value });
            toast('Profile updated', 'success');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async _changePassword(e) {
        e.preventDefault();
        const pwErr = document.getElementById('pw-error');
        pwErr.hidden = true;

        const current = document.getElementById('pw-current').value;
        const newPw = document.getElementById('pw-new').value;
        const confirmPw = document.getElementById('pw-confirm').value;

        if (newPw !== confirmPw) {
            pwErr.textContent = 'Passwords do not match.';
            pwErr.hidden = false;
            return;
        }

        try {
            await api.changePassword(current, newPw);
            toast('Password changed', 'success');
            document.getElementById('password-form').reset();
        } catch (err) {
            pwErr.textContent = err.message;
            pwErr.hidden = false;
        }
    }

    async _updatePin(e) {
        e.preventDefault();
        const pinInput = document.getElementById('pin-value');
        const pin = pinInput.value.trim();

        if (!/^\d{4,12}$/.test(pin)) {
            toast('PIN must be 4 to 12 digits.', 'error');
            return;
        }

        try {
            await api.updateProfile({ pin });
            toast('PIN updated.', 'success');
            pinInput.value = '';
            this.render();
        } catch (err) {
            toast(err.message || 'Failed to update PIN', 'error');
        }
    }

    async _clearPin() {
        const { confirm } = await import('../utils.js');
        const yes = await confirm('Remove PIN', 'Remove your custom unlock PIN?');
        if (!yes) return;

        try {
            await api.updateProfile({ pin: "" });
            toast('PIN removed.', 'success');
            this.render();
        } catch (err) {
            toast(err.message || 'Failed to clear PIN', 'error');
        }
    }

    destroy() { }
}
