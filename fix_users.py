import re

with open('core/schemas.py', 'r') as f:
    content = f.read()

# Add is_adult to UserUpdateRequest
content = content.replace("role: str | None = Field(default=None, max_length=20)", "role: str | None = Field(default=None, max_length=20)\n    is_adult: bool | None = None")

with open('core/schemas.py', 'w') as f:
    f.write(content)
