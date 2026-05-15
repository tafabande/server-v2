# StreamDrop — Comprehensive Design & Charter

## PART I: THE ESSENTIALS (Quick Reference)

### 1. The Essence
**StreamDrop** is a high-energy, premium media hub designed for immersive LAN streaming. It leverages **Glassmorphism** and dynamic depth to create a cinematic "always-on" experience.

### 2. Core Features
- **Luminescent UI**: Glassmorphic cards with dynamic gradients and neon accents.
- **Smart Discovery**: Auto-indexing with high-fidelity thumbnail generation.
- **Universal Streaming**: FFmpeg-driven HLS transcoding for seamless playback.
- **Fluid Navigation**: Pill-shaped interactive elements and mesh-gradient backgrounds.
- **LAN-First**: Fully operational offline with locally served assets.

### 3. Tech Stack
- **Backend**: FastAPI, SQLAlchemy (Async).
- **Frontend**: Vanilla JS, Pure CSS (Glassmorphism / Material Rounded).
- **Media**: FFmpeg (Transcoding).
- **DB/Cache**: SQLite + Redis.

---

## PART II: DESIGN SYSTEM (Luminescent Glass)

### 4. Brand & Style
This design system is built for a premium media environment. The personality is electric and lively, moving away from static layouts toward a dynamic, fluid interface. It balances "dark room" comfort with vibrant, neon-inflected energy.

### 5. Colors
- **Foundation**: True Dark (#0D0D1A)
- **Primary Energy**: Luminescent Purple (#B388FF)
- **Accents**: Neon Mint (#69F0AE) and Electric Cyan (#40C4FF)
- **Background**: Shifting mesh gradients of deep indigos and dark violets.

### 6. Typography
- **Headlines**: **Outfit** (Geometric, modern, premium).
- **Body/Utility**: **Inter** (Highly legible, clean).
- **Style**: Tight letter-spacing for headlines; open for labels.

### 7. Elevation & Depth (Glassmorphism)
- **Backdrop Blur**: 12px for navigation, 20px for modals.
- **Translucency**: Semi-transparent fills (rgba(26, 26, 46, 0.75)).
- **Reflective Borders**: 1px top/left borders to catch virtual light.
- **Floating Shadows**: Large, diffused primary-tinted glows.

### 8. Shapes
- **Containers**: 12px (0.75rem) corner radius for cards and panels.
- **Interactive**: Pill-shaped (fully rounded) for buttons and search bars.

---

## PART III: TECHNICAL ARCHITECTURE

### 9. Key Directory Map
- `/core`: Backend logic and database.
- `/routers`: API endpoints.
- `/static`: Frontend assets (StreamDrop UI).
- `/thumbs`: Generated media thumbnails.
- `/workers`: Cleanup and background tasks.

### 10. Implementation Roadmap
1. **Branding**: Update all instances of "MediaHub" to "StreamDrop".
2. **Styling**: Replace Retro-VHS CSS with Luminescent Glass CSS.
3. **Components**: Refine cards and buttons to match the new shape language.
4. **Final Polish**: Implement the animated mesh gradient background.
