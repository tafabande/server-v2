import app from '../app.js';

/**
 * Login View
 */
export const LoginView = {
    html: `
        <div class="auth-full-page">
            <div class="auth-container">
                <div class="auth-brand">
                    <h1 class="brand-text">MediaHub</h1>
                    <p class="brand-tag">PRIVATE LAN VAULT</p>
                </div>
                
                <form id="login-form" class="auth-card-modern">
                    <h2>Session Access</h2>
                    <p class="section-note">Enter your credentials to enter the vault.</p>
                    
                    <div id="auth-error" class="error-text"></div>

                    <label class="input-stack">
                        <span>Username</span>
                        <input id="username-input" type="text" placeholder="Enter username" required autofocus />
                    </label>
                    <label class="input-stack">
                        <span>Password</span>
                        <input id="password-input" type="password" placeholder="Enter password" required />
                    </label>
                    
                    <button type="submit" class="primary-button full-width">Start Session</button>
                </form>
            </div>
        </div>
    `,
    init: async () => {
        const form = document.getElementById('login-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username-input').value;
            const password = document.getElementById('password-input').value;
            const errorEl = document.getElementById('auth-error');
            const submitBtn = form.querySelector('button');
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'Connecting...';
            errorEl.textContent = '';
            
            try {
                // Use the API client from the app instance
                const data = await app.api.request('/api/auth/token', {
                    method: 'POST',
                    body: new URLSearchParams({ username, password }),
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
                
                localStorage.setItem('mediahub_token', data.access_token);
                localStorage.setItem('mediahub_user', JSON.stringify(data.user));
                
                // Update app state
                app.token = data.access_token;
                app.user = data.user;
                app.api.setToken(data.access_token);
                app.initSocket();
                
                // Redirect to home
                app.router.navigate('/');
            } catch (err) {
                errorEl.textContent = err.message || 'Login failed';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Start Session';
            }
        });
    }
};
