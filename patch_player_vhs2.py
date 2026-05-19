import re

with open('static/css/player.css', 'r') as f:
    css = f.read()

# Hide VHS info sidebar
css = re.sub(r'(\.player-info\s*\{)', r'\1 display: none !important; ', css)
# Hide VHS settings drawer items if they exist with specific styles, or just remove box shadows
css = re.sub(r'box-shadow:\s*0\s*0\s*10px\s*var\(--player-accent-glow\);', 'box-shadow: none;', css)
css = re.sub(r'box-shadow:\s*inset[^;]*;', 'box-shadow: none;', css)
css = re.sub(r'box-shadow:\s*0\s*[^;]*;', 'box-shadow: none;', css)

with open('static/css/player.css', 'w') as f:
    f.write(css)
