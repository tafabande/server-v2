import re

with open('static/css/styles.css', 'r') as f:
    css = f.read()

# Update colors for a minimal, non-synthwave aesthetic (clean black/white with indigo accent)
css = re.sub(r'--bg:\s*#0a0a0d;', '--bg:           #09090b;', css)
css = re.sub(r'--bg-surface:\s*#121217;', '--bg-surface:   #18181b;', css)
css = re.sub(r'--bg-hover:\s*#1a1a23;', '--bg-hover:     #27272a;', css)
css = re.sub(r'--bg-input:\s*#0e0e12;', '--bg-input:     #09090b;', css)
css = re.sub(r'--border:\s*#383845;', '--border:       #27272a;', css)
css = re.sub(r'--border-focus:\s*#00ff66;', '--border-focus: #6366f1;', css)

css = re.sub(r'--text:\s*#e0eee0;', '--text:         #fafafa;', css)
css = re.sub(r'--text-muted:\s*#789078;', '--text-muted:   #a1a1aa;', css)
css = re.sub(r'--text-dim:\s*#506850;', '--text-dim:     #52525b;', css)

css = re.sub(r'--accent:\s*#00ff66;', '--accent:       #6366f1;', css)
css = re.sub(r'--accent-hover:\s*#33ff88;', '--accent-hover: #818cf8;', css)
css = re.sub(r'--accent-dim:\s*rgba\(0,\s*255,\s*102,\s*0\.1\);', '--accent-dim:   rgba(99, 102, 241, 0.1);', css)

css = re.sub(r'--success:\s*#00ff66;', '--success:      #10b981;', css)
css = re.sub(r'--warning:\s*#ffb000;', '--warning:      #f59e0b;', css)
css = re.sub(r'--error:\s*#ff3366;', '--error:        #ef4444;', css)

css = re.sub(r'--radius:\s*0px;', '--radius:       8px;', css)

css = re.sub(r'--font:\s*ui-monospace.*?;', '--font:         system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;', css)

with open('static/css/styles.css', 'w') as f:
    f.write(css)
