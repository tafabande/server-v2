export class SocketClient {
  constructor({ onMessage, onStateChange }) {
    this.onMessage = onMessage;
    this.onStateChange = onStateChange;
    this.socket = null;
    this.reconnectTimer = 0;
    this.shouldReconnect = true;
  }

  setState(state) {
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  connect() {
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) {
      return;
    }

    this.shouldReconnect = true;
    this.setState(this.reconnectTimer ? "reconnecting" : "connecting");

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    this.socket = new WebSocket(`${protocol}://${window.location.host}/api/system/ws`);

    this.socket.addEventListener("message", (event) => {
      try {
        this.onMessage(JSON.parse(event.data));
      } catch {
        this.onMessage({ type: "unknown" });
      }
    });

    this.socket.addEventListener("open", () => {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
      this.setState("connected");
      this.socket.send("hello");
    });

    this.socket.addEventListener("close", () => {
      if (!this.shouldReconnect) {
        this.setState("disconnected");
        return;
      }

      this.setState("reconnecting");
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
    });

    this.socket.addEventListener("error", () => {
      this.setState("reconnecting");
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setState("disconnected");
  }
}
