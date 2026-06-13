from fastapi import WebSocket

from core.logging import get_logger

logger = get_logger("core.events")

class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._active_sessions: dict[WebSocket, dict] = {}

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)
        self._active_sessions.pop(websocket, None)

    def set_session_data(self, websocket: WebSocket, data: dict) -> None:
        if websocket in self._connections:
            self._active_sessions[websocket] = data

    def get_active_sessions(self) -> list[dict]:
        return list(self._active_sessions.values())

    async def broadcast(self, payload: dict) -> None:
        stale: list[WebSocket] = []
        for websocket in self._connections:
            try:
                await websocket.send_json(payload)
            except RuntimeError as e:
                session = self._active_sessions.get(websocket)
                user_info = f"user {session.get('user_id')}" if session and 'user_id' in session else "unknown user"
                logger.warning("Connection lost for %s: %s", user_info, e)
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(websocket)

socket_manager = ConnectionManager()

async def broadcast_library_updated(count: int | None = None) -> None:
    payload = {"type": "library-updated"}
    if count is not None:
        payload["count"] = count
    await socket_manager.broadcast(payload)

async def broadcast_settings_updated() -> None:
    await socket_manager.broadcast({"type": "settings-updated"})
