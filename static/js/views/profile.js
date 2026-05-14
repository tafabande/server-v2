import { api } from '../app.js';

/**
 * Profile View
 */
export const ProfileView = {
    html: `
        <div class="profile-page">
            <header class="view-header">
                <h2>User Sovereign</h2>
                <p class="section-note">Manage your identity and preferences.</p>
            </header>

            <div class="profile-grid">
                <section class="profile-card">
                    <div class="profile-header-main">
                        <div class="avatar-large">
                            <img id="profile-avatar" src="/static/placeholder.svg" alt="User Avatar" />
                        </div>
                        <div class="profile-id">
                            <h3 id="profile-username">Loading...</h3>
                            <span id="profile-role" class="meta-tag">--</span>
                        </div>
                    </div>

                    <form id="profile-form" class="profile-settings">
                        <label class="input-stack">
                            <span>Bio</span>
                            <textarea id="profile-bio" placeholder="Tell the family about yourself..."></textarea>
                        </label>
                        <label class="input-stack">
                            <span>Theme Preference</span>
                            <select id="profile-theme">
                                <option value="retro-classic">Retro Classic (Netflix Style)</option>
                                <option value="modern-glass">Modern Glass</option>
                                <option value="midnight-stealth">Midnight Stealth</option>
                            </select>
                        </label>
                        <button type="submit" class="primary-button">Update Profile</button>
                    </form>
                </section>

                <aside class="profile-stats">
                    <div class="stat-card">
                        <span class="metric-label">Member Since</span>
                        <strong id="profile-joined" class="metric-value">--</strong>
                    </div>
                    <div class="stat-card">
                        <span class="metric-label">Total Watchtime</span>
                        <strong class="metric-value">0h</strong>
                    </div>
                </aside>
            </div>
        </div>
    `,
    init: async () => {
        try {
            const user = await api.me();
            
            document.getElementById('profile-username').textContent = user.username;
            document.getElementById('profile-role').textContent = user.role.toUpperCase();
            document.getElementById('profile-avatar').src = user.avatar_url || '/static/placeholder.svg';
            document.getElementById('profile-bio').value = user.bio || '';
            document.getElementById('profile-joined').textContent = new Date(user.created_at).toLocaleDateString();
            
            if (user.preferences && user.preferences.theme) {
                document.getElementById('profile-theme').value = user.preferences.theme;
            }

            document.getElementById('profile-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                // Implementation for updating profile
                alert('Profile update functionality coming soon!');
            });
        } catch (e) {
            console.error('Failed to load profile', e);
            if (e.status !== 401) {
                document.querySelector('.profile-page').innerHTML = `<p class="error-text">Failed to load profile: ${e.message}</p>`;
            }
        }
    }
};
