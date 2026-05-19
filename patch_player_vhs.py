import re

with open('static/css/player.css', 'r') as f:
    css = f.read()

# Hide VHS/Scanlines components to minimalist the player
css = re.sub(r'(\.player-scanlines\s*\{[^\}]*?)\}', r'\1 display: none; }', css)

# Make transport controls cleaner
css = re.sub(r'(\.transport-track\s*\{[^\}]*?)\}', r'\1 border: none; height: 6px; background: rgba(255,255,255,0.2); }', css)
css = re.sub(r'(\.transport-fill\s*\{[^\}]*?)\}', r'\1 box-shadow: none; border-right: none; }', css)

with open('static/css/player.css', 'w') as f:
    f.write(css)
