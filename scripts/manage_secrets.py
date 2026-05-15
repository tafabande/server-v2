import os
import secrets
import string
from pathlib import Path

def generate_secure_secret(length=64):
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*(-_=+)"
    return "".join(secrets.choice(alphabet) for _ in range(length))

def init_secrets(env_path=".env"):
    path = Path(env_path)
    existing_vars = {}
    
    if path.exists():
        with open(path, "r") as f:
            for line in f:
                if "=" in line and not line.startswith("#"):
                    key, val = line.strip().split("=", 1)
                    existing_vars[key] = val

    # Secrets that MUST be secure
    required_secrets = {
        "SECRET_KEY": generate_secure_secret(64),
        "ALGORITHM": "HS256",
        "ACCESS_TOKEN_EXPIRE_MINUTES": "10080", # 1 week
        "ADMIN_PIN": "".join(secrets.choice(string.digits) for _ in range(4)),
    }

    updated = False
    new_lines = []
    
    # Process existing or add new
    processed_keys = set()
    if path.exists():
        with open(path, "r") as f:
            for line in f:
                stripped = line.strip()
                if "=" in stripped and not stripped.startswith("#"):
                    key, val = stripped.split("=", 1)
                    processed_keys.add(key)
                    if key in required_secrets and (not val or val == "your-secret-key-here" or val == "REPLACE_ME"):
                        new_lines.append(f"{key}={required_secrets[key]}\n")
                        updated = True
                        print(f"✨ Generated secure value for {key}")
                    else:
                        new_lines.append(line)
                else:
                    new_lines.append(line)
    
    # Add missing keys
    for key, val in required_secrets.items():
        if key not in processed_keys:
            new_lines.append(f"{key}={val}\n")
            updated = True
            print(f"➕ Added missing secret: {key}")

    if updated:
        with open(path, "w") as f:
            f.writelines(new_lines)
        print(f"✅ Secrets localized and secured in {env_path}")
    else:
        print(f"ℹ️ All secrets in {env_path} appear to be initialized.")

if __name__ == "__main__":
    init_secrets()
