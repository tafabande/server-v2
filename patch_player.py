import re

with open('static/css/player.css', 'r') as f:
    css = f.read()

# Make player minimalist
css = re.sub(r'--player-accent:\s*#00ff66;', '--player-accent: #6366f1;', css)
css = re.sub(r'--player-accent-glow:\s*rgba\(0,\s*255,\s*102,\s*0\.15\);', '--player-accent-glow: rgba(99, 102, 241, 0.15);', css)
css = re.sub(r'--glass-bg:\s*rgba\(0,\s*0,\s*0,\s*0\.8\);', '--glass-bg: rgba(0, 0, 0, 0.6);', css)
css = re.sub(r'backdrop-filter:\s*blur\(.*?\);', 'backdrop-filter: blur(16px);', css)

with open('static/css/player.css', 'w') as f:
    f.write(css)
