#!/usr/bin/env node
// ============================================================
// LochCAD Collaboration Server — Standalone WebSocket relay
// ============================================================
// Usage: node server/collab-server.js [port]
// Default port: 4444

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || '4444', 10);

// ---- Room Management ----
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      state: null,
      cleanupTimer: null,
    });
  }
  return rooms.get(roomId);
}

function broadcast(room, message, excludeUserId) {
  const data = JSON.stringify(message);
  for (const [uid, u] of room.users) {
    if (uid !== excludeUserId && u.ws.readyState === 1) {
      try { u.ws.send(data); } catch { /* ignore */ }
    }
  }
}

function handleConnection(ws) {
  let userId = null;
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'join': {
        userId = msg.user.id;
        currentRoom = getOrCreateRoom(msg.roomId);

        if (currentRoom.cleanupTimer) {
          clearTimeout(currentRoom.cleanupTimer);
          currentRoom.cleanupTimer = null;
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
        if (!currentRoom || !userId) return;
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
        if (!currentRoom) return;
        currentRoom.state = msg.state;
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && userId) {
      currentRoom.users.delete(userId);
      broadcast(currentRoom, { type: 'user-left', userId }, null);

      if (currentRoom.users.size === 0) {
        const roomId = currentRoom.id;
        currentRoom.cleanupTimer = setTimeout(() => {
          const r = rooms.get(roomId);
          if (r && r.users.size === 0) rooms.delete(roomId);
        }, 30 * 60 * 1000); // 30 min cleanup
      }
    }
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

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  // Accept all upgrade requests (path: /collab or /)
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws);
  });
});

server.listen(PORT, () => {
  console.log(`[LochCAD Collab] Server running on port ${PORT}`);
  console.log(`[LochCAD Collab] WebSocket endpoint: ws://localhost:${PORT}/collab`);
});
