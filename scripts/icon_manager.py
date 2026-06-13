import os
import shutil
import xml.etree.ElementTree as ET

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_SOURCE = os.path.join(BASE_DIR, 'material-design-icons-master', 'material-design-icons-master', 'android')
ICON_DEST = os.path.join(BASE_DIR, 'static', 'icons')

# Discover all categories in source
if os.path.exists(ICON_SOURCE):
    CATEGORIES = [d for d in os.listdir(ICON_SOURCE) if os.path.isdir(os.path.join(ICON_SOURCE, d))]
else:
    CATEGORIES = []

def convert_xml_to_svg(xml_content):
    """Simple conversion of Android VectorDrawable XML to SVG."""
    try:
        # Parse XML
        root = ET.fromstring(xml_content)
        
        # Get dimensions
        width = root.get('{http://schemas.android.com/apk/res/android}viewportWidth', '24')
        height = root.get('{http://schemas.android.com/apk/res/android}viewportHeight', '24')
        
        # Create SVG string
        svg_header = f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 {width} {height}" fill="currentColor">'
        svg_footer = '</svg>'
        
        paths = []
        # Find all path elements (including those in groups)
        for path_node in root.iter('path'):
            d = path_node.get('{http://schemas.android.com/apk/res/android}pathData')
            if d:
                # We use fill="currentColor" to allow CSS styling
                paths.append(f'<path d="{d}" />')
                
        return f"{svg_header}\n  {''.join(paths)}\n{svg_footer}"
    except Exception as e:
        print(f"Error converting XML: {e}")
        return None

def fetch_icon(icon_name, style='materialicons'):
    """
    Search for an icon in the source folder and copy it to static/icons as SVG.
    Example: fetch_icon('home')
    """
    found_path = None
    
    # Search across categories
    for cat in CATEGORIES:
        # The structure is often: android/<category>/<icon_name>/<style>/black/res/drawable/<name>_24.xml
        icon_dir = os.path.join(ICON_SOURCE, cat, icon_name)
        if not os.path.exists(icon_dir):
            continue
            
        style_dir = os.path.join(icon_dir, style)
        if not os.path.exists(style_dir):
            # Try fallback styles
            styles = os.listdir(icon_dir)
            if styles:
                style_dir = os.path.join(icon_dir, styles[0])
            else:
                continue
        
        drawable_dir = os.path.join(style_dir, 'black', 'res', 'drawable')
        if os.path.exists(drawable_dir):
            files = os.listdir(drawable_dir)
            # Match 24dp or 24.xml
            xml_file = next((f for f in files if ('24' in f and f.endswith('.xml'))), None)
            if not xml_file and files:
                xml_file = files[0]
                
            if xml_file:
                found_path = os.path.join(drawable_dir, xml_file)
                break
    
    if not found_path:
        print(f"Icon '{icon_name}' not found in any category.")
        return False

    # Read XML
    with open(found_path, 'r', encoding='utf-8') as f:
        xml_content = f.read()
    
    # Convert to SVG
    svg_content = convert_xml_to_svg(xml_content)
    if not svg_content:
        return False
        
    # Save to destination
    if not os.path.exists(ICON_DEST):
        os.makedirs(ICON_DEST)
        
    dest_path = os.path.join(ICON_DEST, f"{icon_name}.svg")
    with open(dest_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)
        
    print(f"Successfully fetched and converted '{icon_name}' to {dest_path}")
    return True

if __name__ == "__main__":
    # Essential icons for MediaHub
    # Format: (icon_name, alias_or_alternative)
    essential_icons = [
        ('home', None),
        ('video_library', 'library_books'),
        ('folder', 'directory'),
        ('search', None),
        ('settings', None),
        ('favorite', 'heart'),
        ('person', 'account_circle'),
        ('lock', None),
        ('delete', None),
        ('edit', 'create'),
        ('close', 'clear'),
        ('file_upload', 'upload'),
        ('file_download', 'download'),
        ('play_arrow', 'play'),
        ('pause', None),
        ('skip_next', None),
        ('skip_previous', None),
        ('volume_up', None),
        ('fullscreen', 'aspect_ratio'),
        ('more_vert', None),
        ('more_horiz', None),
        ('info', None),
        ('check_circle', None),
        ('error', 'warning'),
        ('history', None),
        ('star', None),
        ('visibility', 'eye'),
        ('visibility_off', 'eye_off'),
        ('share', None),
        ('qr_code', None),
        ('devices', None),
        ('speed', None)
    ]
    
    print(f"Fetching {len(essential_icons)} essential icons...")
    for icon_name, alt_name in essential_icons:
        success = fetch_icon(icon_name)
        if not success and alt_name:
            print(f"Trying alternative for '{icon_name}': '{alt_name}'")
            fetch_icon(alt_name)
            # If alt succeeded, maybe rename it to the original name?
            alt_path = os.path.join(ICON_DEST, f"{alt_name}.svg")
            if os.path.exists(alt_path):
                shutil.copy(alt_path, os.path.join(ICON_DEST, f"{icon_name}.svg"))

