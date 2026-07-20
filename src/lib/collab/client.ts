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

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30_000;
const MAX_QUEUED_MESSAGES = 500;

export class CollabClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_DELAY;
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
    // Fresh session — never replay messages queued for a previous room
    this._queued = [];
    this.reconnectDelay = RECONNECT_BASE_DELAY;
    this._openSocket();
  }

  /** Disconnect from the current room. */
  disconnect() {
    this._intentionalClose = true;
    this._roomId = null;
    this._user = null;
    this._connected = false;
    this._queued = [];
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this._detachSocket(this.ws);
      try { this.ws.close(); } catch { /* ignore */ }
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

  /** Detach all handlers so a discarded socket's events can't fire reconnects
   *  or flip connection flags after a newer socket has taken over. */
  private _detachSocket(ws: WebSocket) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }

  private _openSocket() {
    if (this.ws) {
      this._detachSocket(this.ws);
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/collab`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this._connected = true;
      this.reconnectDelay = RECONNECT_BASE_DELAY;
      // Join the room
      if (this._roomId && this._user) {
        this._send({ type: 'join', roomId: this._roomId, user: this._user });
      }
      // Flush queued messages
      const queued = this._queued;
      this._queued = [];
      for (const msg of queued) {
        socket.send(msg);
      }
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch {
        // ignore invalid messages
      }
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this._connected = false;
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onclose will fire after this
    };
  }

  private _send(msg: ClientMessage) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Awareness is ephemeral (re-sent every 50ms) — pointless to queue
      if (msg.type === 'awareness') return;
      if (this._queued.length >= MAX_QUEUED_MESSAGES) this._queued.shift();
      this._queued.push(data);
    }
  }

  private _scheduleReconnect() {
    if (this._intentionalClose) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay + Math.random() * 500;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this._roomId && this._user) {
        this._openSocket();
      }
    }, delay);
  }
}

/** Singleton client instance. */
export const collabClient = new CollabClient();
