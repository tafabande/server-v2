import re

with open('static/css/styles.css', 'r') as f:
    css = f.read()

# Add a class to hide elements on mobile
hide_mobile = """
@media (max-width: 767px) {
  .hide-mobile { display: none !important; }
}
"""

if '.hide-mobile' not in css:
    css += hide_mobile

with open('static/css/styles.css', 'w') as f:
    f.write(css)
