import re

with open('routers/users.py', 'r') as f:
    code = f.read()

code = code.replace("user.role = payload.role", "user.role = payload.role\n    if payload.is_adult is not None:\n        user.is_adult = payload.is_adult\n")

with open('routers/users.py', 'w') as f:
    f.write(code)
