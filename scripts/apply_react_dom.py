import os
from pathlib import Path

def convert_index_html():
    html_content = """<!DOCTYPE html>
<html lang="en" data-theme="amoled">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>MediaHub</title>
    <link rel="stylesheet" href="/static/css/styles.css">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <script type="module" src="/static/js/app.js" defer></script>
    <!-- Include HLS.js for the player -->
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
    <style>
        /* Structural CSS to bridge React layout with MediaHub Vanilla JS logic */
        body { margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; overflow: hidden; }
        
        /* Modern Bottom Bar Player overrides for native dialog */
        dialog#player-modal {
            position: fixed; top: auto; bottom: 0; left: 0; right: 0; width: 100%; max-width: 100%;
            margin: 0; padding: 0; border: none; background: transparent; 
            transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            transform: translateY(120%); z-index: 50; display: block;
        }
        dialog#player-modal.active { transform: translateY(0); }
        dialog#player-modal::backdrop { display: none; background: transparent; pointer-events: none; }
        
        .hide-when-player-active { transition: margin-bottom 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        body.player-active .hide-when-player-active { margin-bottom: 80px; }
        
        /* PiP Video Viewport attached to the bottom bar */
        .video-viewport {
            position: absolute; bottom: calc(100% + 16px); right: 24px;
            width: 384px; aspect-ratio: 16/9; background: #000;
            border-radius: 12px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            border: 1px solid var(--border-subtle, #262626); cursor: pointer;
            transition: transform 0.2s ease;
        }
        .video-viewport:hover { transform: scale(1.02); }
        video::-webkit-media-controls { display: none !important; }
        video::-moz-media-controls { display: none !important; }
    </style>
</head>
<body class="transition-colors duration-300 bg-white dark:bg-black text-neutral-900 dark:text-white">
    
    <!-- Boot Loader -->
    <div id="boot-loader" class="fixed inset-0 bg-white dark:bg-[#0a0a0a] z-[9999] flex items-center justify-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-900 dark:border-white"></div>
    </div>

    <div class="min-h-screen flex flex-col md:flex-row overflow-hidden selection:bg-neutral-300 dark:selection:bg-neutral-700">
        
        <!-- Sidebar -->
        <aside id="sidebar" class="sidebar w-full md:w-64 bg-neutral-50 dark:bg-[#0a0a0a] border-r border-neutral-200 dark:border-neutral-900 p-6 flex flex-col justify-between shrink-0 z-10 transition-transform duration-300">
            <div>
                <div class="flex items-center justify-between mb-8">
                    <h1 class="text-xl font-black tracking-tight dark:text-white">Media Hub</h1>
                    <button id="btn-theme-toggle" class="px-3 py-1.5 rounded-md text-xs font-bold bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors">
                        <span id="theme-toggle-icon">🌙</span> <span class="nav-label">AMOLED</span>
                    </button>
                </div>

                <nav class="space-y-1">
                    <a href="/" class="nav-link w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-900" data-link>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span class="nav-label">Watch</span>
                    </a>
                    <a href="/library" class="nav-link w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-900" data-link>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                        <span class="nav-label">Library</span>
                    </a>
                    <a href="/explorer" class="nav-link admin-only w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-900" data-link>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        <span class="nav-label">Uploads</span>
                    </a>
                    <a href="/admin" class="nav-link admin-only w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-900" data-link>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" /></svg>
                        <span class="nav-label">Insights</span>
                    </a>
                </nav>
            </div>

            <div class="flex items-center space-x-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111]">
                <div class="w-9 h-9 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-black flex items-center justify-center font-bold text-sm">MH</div>
                <div class="truncate flex-1">
                    <h4 id="topbar-user" class="text-xs font-bold truncate dark:text-white">User</h4>
                    <p class="text-[10px] text-neutral-500">System Verified</p>
                </div>
                <button id="logout-btn" class="p-2 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-md transition-colors" title="Sign Out">
                    <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
            </div>
        </aside>

        <!-- Main Content Area -->
        <main class="flex-1 flex flex-col h-screen relative overflow-hidden bg-neutral-50 dark:bg-[#050505]">
            <div class="flex-1 overflow-y-auto p-6 md:p-8 pb-32 hide-when-player-active relative">
                
                <!-- Persistent Header -->
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 space-y-4 md:space-y-0">
                    <h2 id="page-title" class="text-2xl font-black tracking-tight capitalize dark:text-white">Watch</h2>
                    <div class="relative w-full md:w-80">
                        <input type="text" id="global-search-input" placeholder="Search metadata, titles, tags..." class="w-full bg-white dark:bg-[#111] border border-neutral-200 dark:border-neutral-800 text-sm font-medium rounded-lg px-4 py-2.5 focus:border-neutral-400 dark:focus:border-neutral-500 focus:outline-none transition-colors dark:text-white placeholder-neutral-400 shadow-sm" />
                    </div>
                </div>

                <!-- Dynamic Router Views Inject Here -->
                <div id="view-target"></div>
            </div>

            <!-- Bottom Player Bar (Replacing VHS Modal) -->
            <dialog id="player-modal" class="player-modal">
                
                <!-- Picture-in-Picture Viewport -->
                <div class="video-viewport" id="video-viewport" title="Click to Fullscreen">
                    <video id="player-video" playsinline class="w-full h-full object-contain"></video>
                </div>
                
                <canvas id="analyzer-canvas" class="hidden"></canvas>

                <div class="border-t border-neutral-200 dark:border-neutral-900 bg-white dark:bg-[#0a0a0a] p-4 flex flex-col md:flex-row items-center justify-between gap-4 relative">
                    <!-- Progress Bar -->
                    <div class="absolute top-0 left-0 right-0 h-1 bg-neutral-200 dark:bg-neutral-800 cursor-pointer" id="transport-track">
                        <div id="transport-buffer" class="absolute top-0 left-0 h-full bg-neutral-300 dark:bg-neutral-700 transition-all duration-300"></div>
                        <div id="transport-fill" class="absolute top-0 left-0 h-full bg-neutral-900 dark:bg-white transition-all duration-[50ms]"></div>
                    </div>

                    <!-- Left: Info -->
                    <div class="flex items-center space-x-4 w-full md:w-1/3">
                        <div class="truncate pl-2">
                            <h4 id="tape-title-display" class="text-sm font-bold truncate dark:text-white">Loading Media...</h4>
                            <p id="tape-format" class="text-[11px] text-neutral-500 truncate uppercase">HLS Stream</p>
                        </div>
                    </div>

                    <!-- Center: Controls -->
                    <div class="flex flex-col items-center w-full md:w-1/3 space-y-2">
                        <div class="flex items-center space-x-6">
                            <button id="btn-prev" class="text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">
                                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6L18 6v12z"/></svg>
                            </button>
                            <button id="btn-play" class="w-10 h-10 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-black flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all">
                                <svg class="w-4 h-4 fill-current ml-0.5 play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                <svg class="w-4 h-4 fill-current pause-icon hidden" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                            </button>
                            <button id="btn-next" class="text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">
                                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zm9-12h2v12h-2z"/></svg>
                            </button>
                        </div>
                        <div class="w-full flex justify-center items-center space-x-3 text-[10px] font-medium text-neutral-500">
                            <span id="transport-current">00:00</span>
                            <span>/</span>
                            <span id="transport-total">00:00</span>
                        </div>
                    </div>

                    <!-- Right: Actions/Volume -->
                    <div class="flex items-center justify-end space-x-4 w-full md:w-1/3">
                        <button id="btn-fullscreen" class="text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors" title="Fullscreen Video">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
                        </button>
                        <div class="flex items-center space-x-2 hidden lg:flex">
                            <button id="volume-icon" class="text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                            </button>
                            <input type="range" id="volume-slider" min="0" max="1" step="0.05" value="0.8" class="w-16 h-1 bg-neutral-200 dark:bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-neutral-900 dark:accent-white" />
                        </div>
                        <button id="btn-back" class="ml-4 text-xs font-bold px-3 py-1.5 rounded bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors" title="Close Player">Close</button>
                    </div>
                </div>
            </dialog>
        </main>
    </div>

    <div id="toast-container" class="fixed bottom-24 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"></div>
</body>
</html>"""

    target_path = Path("static/index.html")
    target_path.write_text(html_content, encoding="utf-8")
    print(f"[SUCCESS] Migrated DOM structure in {target_path}")

if __name__ == "__main__":
    convert_index_html()