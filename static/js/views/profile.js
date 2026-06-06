/**
 * MediaHub — Profile View
 */
import app, { api } from '../app.js';
import { toast, formatDate } from '../utils.js';

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
                        <div class="mt-md p-sm surface rounded flex-between border border-warning" style="background: rgba(245, 158, 11, 0.05); font-size: 0.85rem; width: 100%;">
                            <div class="flex gap-sm items-center">
                                <span style="font-size: 1.25rem;">⏳</span>
                                <div>
                                    <strong style="color: var(--color-warning);">18+ Request Pending</strong>
                                    <div class="text-muted text-xs">Submitted on ${formatDate(latestAdultReq.created_at)}</div>
                                </div>
                            </div>
                            <button type="button" id="req-adult-btn" class="btn btn-sm btn-ghost" disabled style="opacity: 0.6;">Pending</button>
                        </div>
                    `;
                } else if (latestAdultReq.status === 'denied') {
                    adultReqSection = `
                        <div class="mt-md p-sm surface rounded border border-danger" style="background: rgba(239, 68, 68, 0.05); font-size: 0.85rem; width: 100%;">
                            <div class="flex flex-column gap-xs">
                                <div class="flex-between">
                                    <strong style="color: var(--color-error); display: flex; items-center gap-xs"><span>❌</span> 18+ Request Denied</strong>
                                    <span class="text-muted text-xs">${formatDate(latestAdultReq.created_at)}</span>
                                </div>
                                <div class="text-muted text-xs mb-sm">Reason: "${latestAdultReq.admin_comment || 'No reason provided.'}"</div>
                                <button type="button" id="req-adult-btn" class="btn btn-sm btn-accent" style="align-self: flex-start;">🔞 Re-request 18+</button>
                            </div>
                        </div>
                    `;
                } else {
                    adultReqSection = `<button type="button" id="req-adult-btn" class="btn btn-ghost btn-sm mt-md">🔞 Request 18+</button>`;
                }
            } else {
                adultReqSection = `<button type="button" id="req-adult-btn" class="btn btn-ghost btn-sm mt-md">🔞 Request 18+</button>`;
            }
        }

        const initial = (user.username || '?')[0].toUpperCase();

        this.container.innerHTML = `
            <h1 class="page-title">Profile</h1>
            <p class="page-subtitle">Manage your account</p>
 
            <div class="profile-grid">
                <div>
                    <!-- Profile Info -->
                    <div class="surface mb-md">
                        <div class="profile-header">
                            <div class="avatar">${user.avatar_url ? `<img src="${user.avatar_url}" alt="">` : initial}</div>
                            <div>
                                <h2 style="font-size:1.15rem; font-weight:700">${user.username}</h2>
                                <span class="badge badge-accent">${user.role}</span>
                                ${user.is_adult ? '<span class="badge badge-danger">18+</span>' : '<span class="badge badge-muted">Minor</span>'}
                            </div>
                        </div>
                        <div class="flex gap-md text-sm text-muted mb-md">
                            <span>Joined ${formatDate(user.created_at)}</span>
                            <span>Last login ${formatDate(user.last_login)}</span>
                        </div>
 
                        <form id="profile-form">
                            <div class="form-group">
                                <label>Bio</label>
                                <textarea id="prof-bio" class="textarea" placeholder="A short bio...">${user.bio || ''}</textarea>
                            </div>
                            <div class="flex gap-sm">
                                <button type="submit" class="btn btn-accent btn-sm">Update Profile</button>
                            </div>
                            ${adultReqSection}
                        </form>
                    </div>
 
                    <!-- Change Password -->
                    <div class="surface">
                        <div class="section-title">Change Password</div>
                        <form id="password-form">
                            <div class="form-group">
                                <label>Current Password</label>
                                <input id="pw-current" class="input" type="password" required>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>New Password</label>
                                    <input id="pw-new" class="input" type="password" required minlength="8">
                                </div>
                                <div class="form-group">
                                    <label>Confirm</label>
                                    <input id="pw-confirm" class="input" type="password" required minlength="8">
                                </div>
                            </div>
                            <p id="pw-error" class="text-error" hidden></p>
                            <button type="submit" class="btn btn-sm">Change Password</button>
                        </form>
                    </div>

                    <!-- Folder PIN Lock Config -->
                    <div class="surface" style="margin-top: 24px; border-left: 3px solid var(--color-accent); background: rgba(99, 102, 241, 0.02);">
                        <div class="section-title" style="display: flex; align-items: center; gap: 8px;">
                            <span>🔐</span> Folder PIN Security
                        </div>
                        <p class="text-muted text-xs mb-sm">
                            Configure your custom unlock PIN (4-12 digits). This PIN allows you to unlock PIN-protected folders and media files directly without requiring the master admin PIN.
                        </p>
                        <form id="pin-form">
                            <div class="form-group">
                                <label>${user.has_pin ? 'Update Custom PIN' : 'Setup Custom PIN'}</label>
                                <input id="pin-value" class="input" type="password" placeholder="Enter 4-12 digits PIN" minlength="4" maxlength="12" pattern="[0-9]*" inputmode="numeric" required>
                            </div>
                            <div class="flex gap-sm items-center" style="display: flex; gap: 8px; align-items: center;">
                                <button type="submit" class="btn btn-accent btn-sm">${user.has_pin ? 'Update PIN' : 'Save PIN'}</button>
                                ${user.has_pin ? `
                                    <button type="button" id="clear-pin-btn" class="btn btn-ghost btn-sm" style="color: var(--color-error); border: 1px solid rgba(239, 68, 68, 0.2);">Remove PIN</button>
                                ` : ''}
                            </div>
                        </form>
                    </div>
                </div>
 
                <!-- Sidebar -->
                <div>
                    <div class="surface mb-md">
                        <div class="section-title">Preferences</div>
                        <div class="form-group">
                            <label>Theme</label>
                            <select id="pref-theme" class="select">
                                <option value="default" ${(user.preferences?.theme || 'default') === 'default' ? 'selected' : ''}>Dark</option>
                                <option value="light" ${user.preferences?.theme === 'light' ? 'selected' : ''}>Light</option>
                            </select>
                        </div>
                        ${(user.role === 'admin' || user.role === 'super-admin' || user.is_adult === true) ? `
                        <div class="form-group mt-md" style="margin-top: 16px;">
                            <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" id="pref-nsfw" ${user.preferences?.nsfw === true ? 'checked' : ''}>
                                <span>Enable NSFW (18+) Content</span>
                            </label>
                        </div>
                        ` : ''}
                    </div>

                    <div class="surface mb-md">
                        <div class="section-title">Access Requests</div>
                        ${requests.length === 0 ? `
                            <p class="text-muted text-sm" style="margin: 8px 0;">No requests submitted yet.</p>
                        ` : `
                            <div class="flex flex-column gap-sm" style="max-height: 250px; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 8px;">
                                ${requests.map(r => {
            let statusBadge = '';
            if (r.status === 'approved') statusBadge = '<span class="badge badge-success">Approved</span>';
            else if (r.status === 'denied') statusBadge = '<span class="badge badge-error">Denied</span>';
            else statusBadge = '<span class="badge badge-warning">Pending</span>';

            let title = '';
            if (r.request_type === 'adult_elevation') {
                title = '🔞 18+ Access';
            } else {
                const folderName = r.target_path ? r.target_path.split('/').pop() : 'Folder';
                title = `📁 Access: ${folderName}`;
            }

            return `
                                        <div class="surface rounded text-xs" style="border: 1px solid var(--border); padding: 8px; background: rgba(255,255,255,0.01);">
                                            <div class="flex-between mb-xs" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                                <strong>${title}</strong>
                                                ${statusBadge}
                                            </div>
                                            <div class="text-muted" style="font-size: 0.75rem; color: var(--text-dim);">${formatDate(r.created_at)}</div>
                                            ${r.admin_comment ? `
                                                <div class="text-muted" style="border-left: 2px solid var(--border); padding-left: 6px; margin-top: 4px; font-style: italic; font-size: 0.75rem;">
                                                    "${r.admin_comment}"
                                                </div>
                                            ` : ''}
                                        </div>
                                    `;
        }).join('')}
                            </div>
                        `}
                    </div>
 
                    <div class="surface">
                        <div class="section-title">Account</div>
                        <p class="text-muted text-sm" style="margin-bottom:12px">
                            ID: ${user.id}<br>
                            Role: ${user.role}
                        </p>
                        <button id="logout-profile" class="btn btn-danger btn-sm" style="width:100%">Logout</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('profile-form').addEventListener('submit', (e) => this._updateProfile(e));
        document.getElementById('password-form').addEventListener('submit', (e) => this._changePassword(e));

        const pinForm = document.getElementById('pin-form');
        if (pinForm) {
            pinForm.addEventListener('submit', (e) => this._updatePin(e));
        }

        const clearPinBtn = document.getElementById('clear-pin-btn');
        if (clearPinBtn) {
            clearPinBtn.addEventListener('click', () => this._clearPin());
        }

        document.getElementById('logout-profile').addEventListener('click', () => {
            localStorage.removeItem('mediahub_token');
            localStorage.removeItem('mediahub_user');
            window.location.href = '/login';
        });

        const themeSelect = document.getElementById('pref-theme');
        if (themeSelect) {
            themeSelect.addEventListener('change', async () => {
                const selectedTheme = themeSelect.value;
                try {
                    await api.updateProfile({ theme: selectedTheme });

                    // Update user in local storage
                    const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
                    user.preferences = user.preferences || {};
                    user.preferences.theme = selectedTheme;
                    localStorage.setItem('mediahub_user', JSON.stringify(user));

                    // Apply theme immediately
                    document.documentElement.setAttribute('data-theme', selectedTheme);
                    toast('Theme updated', 'success');
                } catch (err) {
                    toast(err.message || 'Failed to update theme', 'error');
                }
            });
        }

        const nsfwCheckbox = document.getElementById('pref-nsfw');
        if (nsfwCheckbox) {
            nsfwCheckbox.addEventListener('change', async () => {
                const isNsfw = nsfwCheckbox.checked;
                try {
                    const user = JSON.parse(localStorage.getItem('mediahub_user') || '{}');
                    user.preferences = user.preferences || {};
                    user.preferences.nsfw = isNsfw;

                    await api.updateProfile({ preferences: user.preferences });
                    localStorage.setItem('mediahub_user', JSON.stringify(user));

                    // Keep session storage and app state in sync
                    sessionStorage.setItem('r18_enabled', isNsfw ? 'true' : 'false');
                    app.store.set({ r18Enabled: isNsfw, user });
                    app.updateUI();

                    toast(isNsfw ? 'NSFW Content Enabled' : 'NSFW Content Disabled', 'success');
                } catch (err) {
                    toast(err.message || 'Failed to update preferences', 'error');
                    nsfwCheckbox.checked = !isNsfw;
                }
            });
        }

        document.getElementById('req-adult-btn')?.addEventListener('click', async () => {
            const { confirm } = await import('../utils.js');
            const yes = await confirm('Request 18+ Access', 'Do you want to request your account be elevated to 18+ status?');
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
            await api.updateProfile({
                bio: document.getElementById('prof-bio').value,
            });
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
        const confirm = document.getElementById('pw-confirm').value;

        if (newPw !== confirm) {
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

        if (!pin) {
            toast('Please enter a valid numeric PIN.', 'error');
            return;
        }

        if (!/^\d{4,12}$/.test(pin)) {
            toast('PIN must be 4 to 12 digits numeric.', 'error');
            return;
        }

        try {
            await api.updateProfile({ pin });
            toast('Custom security PIN updated successfully.', 'success');
            pinInput.value = '';
            this.render();
        } catch (err) {
            toast(err.message || 'Failed to update PIN', 'error');
        }
    }

    async _clearPin() {
        const { confirm } = await import('../utils.js');
        const yes = await confirm('Remove PIN Lock', 'Are you sure you want to delete your custom unlock PIN? You will need the master admin PIN to access locked paths.');
        if (!yes) return;

        try {
            await api.updateProfile({ pin: "" });
            toast('Custom PIN removed.', 'success');
            this.render();
        } catch (err) {
            toast(err.message || 'Failed to clear PIN', 'error');
        }
    }

    destroy() { }
}
