import re

with open('static/index.html', 'r') as f:
    html = f.read()

# Fix mobile topbar to be visible again
html = html.replace('<header class="topbar-mobile hide-mobile">', '<header class="topbar-mobile">')

with open('static/index.html', 'w') as f:
    f.write(html)
