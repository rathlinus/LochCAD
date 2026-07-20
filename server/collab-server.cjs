#!/usr/bin/env node
// ============================================================
// LochCAD Collaboration Server — Standalone WebSocket relay
// ============================================================
// Usage: node server/collab-server.js [port]
// Default port: 4444, bound to 127.0.0.1 (set HOST env to override)

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || '4444', 10);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_ROOMS = 1000;
const MAX_ID_LENGTH = 128;
const MAX_PAYLOAD = 10 * 1024 * 1024; // 10 MiB per message (caps state-full blobs)
const HEARTBEAT_INTERVAL = 30 * 1000;
const ROOM_CLEANUP_DELAY = 30 * 60 * 1000; // 30 min

// ---- Room Management ----
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    if (rooms.size >= MAX_ROOMS) return null;
    rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      state: null,
      cleanupTimer: null,
    });
  }
  return rooms.get(roomId);
}

function armCleanup(room) {
  if (room.users.size > 0 || room.cleanupTimer) return;
  room.cleanupTimer = setTimeout(() => {
    const r = rooms.get(room.id);
    if (r && r.users.size === 0) rooms.delete(room.id);
  }, ROOM_CLEANUP_DELAY);
}

function broadcast(room, message, excludeUserId) {
  const data = JSON.stringify(message);
  for (const [uid, u] of room.users) {
    if (uid !== excludeUserId && u.ws.readyState === 1) {
      try { u.ws.send(data); } catch { /* ignore */ }
    }
  }
}

function isValidId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

function handleConnection(ws) {
  let userId = null;
  let currentRoom = null;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Remove this connection from its room. Only the connection that owns the
  // room entry may evict it — a stale socket closing after a reconnect must
  // not kick out the fresh connection registered under the same userId.
  function leaveCurrentRoom() {
    if (!currentRoom || !userId) return;
    const entry = currentRoom.users.get(userId);
    if (entry && entry.ws === ws) {
      currentRoom.users.delete(userId);
      broadcast(currentRoom, { type: 'user-left', userId }, null);
      armCleanup(currentRoom);
    }
    currentRoom = null;
    userId = null;
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'join': {
        if (!isValidId(msg.roomId) || !msg.user || !isValidId(msg.user.id)) {
          try { ws.send(JSON.stringify({ type: 'error', message: 'Invalid join request' })); } catch { /* ignore */ }
          return;
        }

        // Joining a new room implicitly leaves the previous one
        leaveCurrentRoom();

        const room = getOrCreateRoom(msg.roomId);
        if (!room) {
          try { ws.send(JSON.stringify({ type: 'error', message: 'Server is full' })); } catch { /* ignore */ }
          return;
        }

        userId = msg.user.id;
        currentRoom = room;

        if (currentRoom.cleanupTimer) {
          clearTimeout(currentRoom.cleanupTimer);
          currentRoom.cleanupTimer = null;
        }

        // Same user reconnecting (or a second tab): drop the old socket so
        // its eventual close event can't corrupt the fresh registration.
        const existing = currentRoom.users.get(userId);
        if (existing && existing.ws !== ws) {
          try { existing.ws.terminate(); } catch { /* ignore */ }
        }

        currentRoom.users.set(userId, {
          ws,
          user: msg.user,
          awareness: {},
        });

        // Send existing users list
        const users = [];
        for (const [uid, u] of currentRoom.users) {
          if (uid !== userId) users.push(u.user);
        }

        ws.send(JSON.stringify({
          type: 'joined',
          roomId: msg.roomId,
          userId,
          users,
          hasState: currentRoom.state != null,
        }));

        // Send existing room state to new joiner
        if (currentRoom.state) {
          ws.send(JSON.stringify({
            type: 'state-full',
            state: currentRoom.state,
          }));
        }

        // Notify others
        broadcast(currentRoom, { type: 'user-joined', user: msg.user }, userId);

        // Send existing awareness states
        for (const [uid, u] of currentRoom.users) {
          if (uid !== userId && u.awareness && Object.keys(u.awareness).length > 0) {
            ws.send(JSON.stringify({
              type: 'awareness',
              userId: uid,
              state: u.awareness,
            }));
          }
        }
        break;
      }

      case 'ops': {
        if (!currentRoom || !userId || !Array.isArray(msg.ops)) return;
        broadcast(currentRoom, {
          type: 'ops',
          ops: msg.ops,
          userId,
        }, userId);
        break;
      }

      case 'awareness': {
        if (!currentRoom || !userId) return;
        const u = currentRoom.users.get(userId);
        if (u) u.awareness = msg.state;
        broadcast(currentRoom, {
          type: 'awareness',
          userId,
          state: msg.state,
        }, userId);
        break;
      }

      case 'state-full': {
        if (!currentRoom || !userId || typeof msg.state !== 'string') return;
        const hadState = currentRoom.state != null;
        currentRoom.state = msg.state;
        // First state a room receives is forwarded to members who joined
        // before it existed, so everyone starts from the same document.
        if (!hadState) {
          broadcast(currentRoom, { type: 'state-full', state: msg.state }, userId);
        }
        break;
      }
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try {
      handleMessage(msg);
    } catch (err) {
      // A malformed message must never take the process down
      console.error('[LochCAD Collab] Error handling message:', err);
    }
  });

  ws.on('close', () => {
    leaveCurrentRoom();
  });

  ws.on('error', () => {});
}

// ---- HTTP + WebSocket Server ----
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const roomCount = rooms.size;
  let userCount = 0;
  for (const r of rooms.values()) userCount += r.users.size;
  res.end(JSON.stringify({ service: 'LochCAD Collab Server', rooms: roomCount, users: userCount }));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

// Terminate half-open connections so ghost users don't linger in rooms
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, HEARTBEAT_INTERVAL);
wss.on('close', () => clearInterval(heartbeat));

server.on('upgrade', (req, socket, head) => {
  // Accept all upgrade requests (path: /collab or /)
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[LochCAD Collab] Server running on ${HOST}:${PORT}`);
  console.log(`[LochCAD Collab] WebSocket endpoint: ws://${HOST}:${PORT}/collab`);
});
