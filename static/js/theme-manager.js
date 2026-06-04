/**
 * MediaHub — Centralized Theme Manager
 * Manages color schemes, global UI icons, and dynamic player theming.
 */
export class ThemeManager {
    constructor() {
        this.currentTheme = 'default';
        this.user = null;
        this.api = null;
    }

    init(user, api) {
        this.user = user;
        this.api = api;
        this.currentTheme = this.user?.preferences?.theme || 'amoled';
        this.applyTheme(this.currentTheme);
        this.bindEvents();
    }

    applyTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeIcon(theme);
    }

    toggleTheme() {
        const nextTheme = this.currentTheme === 'light' ? 'amoled' : 'light';
        this.applyTheme(nextTheme);

        if (this.user) {
            this.user.preferences = this.user.preferences || {};
            this.user.preferences.theme = nextTheme;
            localStorage.setItem('mediahub_user', JSON.stringify(this.user));
            if (this.api) {
                this.api.updateProfile({ preferences: this.user.preferences }).catch(() => { });
            }
        }
    }

    updateThemeIcon(theme) {
        const iconEl = document.getElementById('theme-toggle-icon');
        const labelEl = document.querySelector('#btn-theme-toggle .nav-label');
        if (!iconEl) return;

        if (theme === 'light') {
            iconEl.textContent = '🌙';
            if (labelEl) labelEl.textContent = 'AMOLED';
        } else {
            iconEl.textContent = '☀';
            if (labelEl) labelEl.textContent = 'Light Mode';
        }
    }

    bindEvents() {
        const toggleBtn = document.getElementById('btn-theme-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleTheme());
        }
    }

    /**
     * Dynamic VHS Player Theming
     * Uses frame analysis to inject dominant colors into CSS variables.
     */
    applyDynamicPlayerTheme(modal, { r, g, b, h, s, l }) {
        if (!modal) return;
        const accentHsl = `hsl(${h}, ${Math.min(100, s + 20)}%, ${Math.max(40, Math.min(70, l))}%)`;
        const accentGlow = `hsla(${h}, ${s}%, ${l}%, 0.4)`;
        const bgRgb = `${Math.round(r * 0.1)}, ${Math.round(g * 0.1)}, ${Math.round(b * 0.1)}`;

        modal.style.setProperty('--player-accent', accentHsl);
        modal.style.setProperty('--player-accent-glow', accentGlow);
        modal.style.setProperty('--player-bg', `rgb(${bgRgb})`);
        modal.style.setProperty('--player-bg-rgb', bgRgb);

        const playerInfo = modal.querySelector('.player-info');
        if (playerInfo) {
            playerInfo.style.background = `rgba(${bgRgb}, 0.8)`;
        }
    }

    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) h = s = 0;
        else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }
}

export const themeManager = new ThemeManager();