import app from '../app.js';

/**
 * Login View
 */
export const LoginView = {
    html: `
        <div class="auth-full-page">
            <div class="auth-container">
                <div class="auth-brand">
                    <h1 class="brand-text">StreamDrop</h1>
                    <p class="brand-tag">Premium Media Hub</p>
                </div>
                
                <form id="login-form" class="glass-panel auth-card">
                    <h2>Session Access</h2>
                    <p class="hero-description">Enter your credentials to access your library.</p>
                    
                    <div id="auth-error" class="error-text"></div>

                    <div class="search-field" style="margin-bottom: 16px; max-width: 100%;">
                        <input id="username-input" type="text" placeholder="Username" required autofocus />
                    </div>
                    <div class="search-field" style="margin-bottom: 24px; max-width: 100%;">
                        <input id="password-input" type="password" placeholder="Password" required />
                    </div>
                    
                    <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center;">
                      <span class="nav-icon">login</span> Start Session
                    </button>
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
                
                // Align with app.js storage keys
                localStorage.setItem('streamdrop_token', data.access_token);
                localStorage.setItem('streamdrop_user', JSON.stringify(data.user));
                
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
