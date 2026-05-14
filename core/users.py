from __future__ import annotations

from copy import deepcopy

from core.models import User
from core.schemas import UserRead


USER_PREFERENCE_DEFAULTS: dict[str, object] = {
    "display_name": "",
    "avatar_url": "",
    "bio": "",
    "language": "en",
    "theme": "retro-classic",
    "concurrent_device_limit": 2,
}


def merged_preferences(user: User) -> dict:
    preferences = deepcopy(USER_PREFERENCE_DEFAULTS)
    preferences.update(user.preferences or {})
    if not preferences.get("display_name"):
        preferences["display_name"] = user.username
    return preferences


def build_user_read(user: User) -> UserRead:
    preferences = merged_preferences(user)
    return UserRead(
        id=user.id,
        username=user.username,
        role=user.role,
        preferences=preferences,
        display_name=str(preferences.get("display_name") or user.username),
        avatar_url=str(preferences.get("avatar_url") or ""),
        bio=str(preferences.get("bio") or ""),
        language=str(preferences.get("language") or "en"),
        concurrent_device_limit=int(preferences.get("concurrent_device_limit") or 2),
    )


def apply_profile_updates(user: User, updates: dict) -> None:
    preferences = merged_preferences(user)
    for key, value in updates.items():
        if value is None:
            continue
        preferences[key] = value
    user.preferences = preferences


def concurrent_device_limit(user: User) -> int:
    preferences = merged_preferences(user)
    limit = preferences.get("concurrent_device_limit", 2)
    try:
        return max(1, int(limit))
    except (TypeError, ValueError):
        return 2
