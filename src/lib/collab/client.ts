// ============================================================
// Collaboration Client — WebSocket connection management
// ============================================================

import type {
  CollabUser,
  AwarenessState,
  Operation,
  ClientMessage,
  ServerMessage,
} from './protocol';

type MessageHandler = (msg: ServerMessage) => void;

export class CollabClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _roomId: string | null = null;
  private _user: CollabUser | null = null;
  private _queued: string[] = [];
  private _intentionalClose = false;

  get connected() { return this._connected; }
  get roomId() { return this._roomId; }

  /** Register a message handler. Returns unsubscribe function. */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /** Connect to a collaboration room. */
  connect(roomId: string, user: CollabUser) {
    this._roomId = roomId;
    this._user = user;
    this._intentionalClose = false;
    this._openSocket();
  }

  /** Disconnect from the current room. */
  disconnect() {
    this._intentionalClose = true;
    this._roomId = null;
    this._user = null;
    this._connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send entity operations (state changes). */
  sendOps(ops: Operation[]) {
    if (ops.length === 0) return;
    this._send({ type: 'ops', ops });
  }

  /** Send awareness (cursor/tool/view). Throttled by caller. */
  sendAwareness(state: AwarenessState) {
    this._send({ type: 'awareness', state });
  }

  /** Send full project state (for initial room population). */
  sendFullState(state: string) {
    this._send({ type: 'state-full', state });
  }

  // ---- Internal ----

  private _openSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/collab`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      // Join the room
      if (this._roomId && this._user) {
        this._send({ type: 'join', roomId: this._roomId, user: this._user });
      }
      // Flush queued messages
      for (const msg of this._queued) {
        this.ws!.send(msg);
      }
      this._queued = [];
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch {
        // ignore invalid messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  private _send(msg: ClientMessage) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this._queued.push(data);
    }
  }

  private _scheduleReconnect() {
    if (this._intentionalClose) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this._roomId && this._user) {
        this._openSocket();
      }
    }, 2000);
  }
}

/** Singleton client instance. */
export const collabClient = new CollabClient();
