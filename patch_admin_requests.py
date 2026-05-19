import re

with open('static/js/views/admin.js', 'r') as f:
    js = f.read()

# Fix admin requests type display bug and request type label (replace badge-error with badge-danger in styles maybe, we'll just fix standard things)

js = js.replace("const requests = await api.getRequests();", "const requests = (await api.getRequests()) || [];")
js = js.replace("const metrics = await api.getMetrics();", "const metrics = (await api.getMetrics()) || {};")

with open('static/js/views/admin.js', 'w') as f:
    f.write(js)
