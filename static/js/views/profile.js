/**
 * MediaHub — Profile View
 */
import { api } from '../app.js';
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
                            <button type="submit" class="btn btn-accent btn-sm">Update Profile</button>
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
        document.getElementById('logout-profile').addEventListener('click', () => {
            localStorage.removeItem('mediahub_token');
            localStorage.removeItem('mediahub_user');
            window.location.href = '/login';
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

    destroy() {}
}
