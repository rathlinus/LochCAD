import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// ---- Embedded Collaboration WebSocket Server (dev only) ----
function collabDevServer(): Plugin {
  return {
    name: 'lochcad-collab-dev',
    configureServer(server: ViteDevServer) {
      import('ws').then(({ WebSocketServer }) => {
        const wss = new WebSocketServer({ noServer: true });

        // Room state
        interface RoomUser { ws: any; user: any; awareness: any }
        interface Room { users: Map<string, RoomUser>; state: string | null; cleanupTimer: any }
        const rooms = new Map<string, Room>();

        function getOrCreateRoom(id: string): Room {
          if (!rooms.has(id)) rooms.set(id, { users: new Map(), state: null, cleanupTimer: null });
          return rooms.get(id)!;
        }
        function broadcast(room: Room, msg: any, exclude: string | null) {
          const data = JSON.stringify(msg);
          for (const [uid, u] of room.users) {
            if (uid !== exclude && u.ws.readyState === 1) {
              try { u.ws.send(data); } catch { /* */ }
            }
          }
        }

        server.httpServer?.on('upgrade', (req: any, socket: any, head: any) => {
          if (req.url === '/collab') {
            wss.handleUpgrade(req, socket, head, (ws: any) => {
              let userId: string | null = null;
              let room: Room | null = null;

              ws.on('message', (raw: any) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                if (msg.type === 'join') {
                  userId = msg.user.id;
                  room = getOrCreateRoom(msg.roomId);
                  if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
                  room.users.set(userId!, { ws, user: msg.user, awareness: {} });
                  const users: any[] = [];
                  for (const [uid, u] of room.users) { if (uid !== userId) users.push(u.user); }
                  ws.send(JSON.stringify({ type: 'joined', roomId: msg.roomId, userId, users }));
                  if (room.state) ws.send(JSON.stringify({ type: 'state-full', state: room.state }));
                  broadcast(room, { type: 'user-joined', user: msg.user }, userId!);
                  for (const [uid, u] of room.users) {
                    if (uid !== userId && u.awareness && Object.keys(u.awareness).length) {
                      ws.send(JSON.stringify({ type: 'awareness', userId: uid, state: u.awareness }));
                    }
                  }
                } else if (msg.type === 'ops' && room && userId) {
                  broadcast(room, { type: 'ops', ops: msg.ops, userId }, userId);
                } else if (msg.type === 'awareness' && room && userId) {
                  const u = room.users.get(userId);
                  if (u) u.awareness = msg.state;
                  broadcast(room, { type: 'awareness', userId, state: msg.state }, userId);
                } else if (msg.type === 'state-full' && room) {
                  room.state = msg.state;
                }
              });

              ws.on('close', () => {
                if (room && userId) {
                  room.users.delete(userId);
                  broadcast(room, { type: 'user-left', userId }, null);
                  if (room.users.size === 0) {
                    const rid = [...rooms.entries()].find(([, r]) => r === room)?.[0];
                    if (rid) {
                      room.cleanupTimer = setTimeout(() => {
                        if (rooms.get(rid)?.users.size === 0) rooms.delete(rid);
                      }, 30 * 60 * 1000);
                    }
                  }
                }
              });
              ws.on('error', () => {});
            });
          }
        });

        console.log('[LochCAD Collab] Dev WebSocket server active on /collab');
      }).catch(() => {
        console.warn('[LochCAD Collab] ws module not found — collaboration disabled in dev mode');
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), collabDevServer()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3800,
    allowedHosts: ['lochcad.de', 'www.lochcad.de'],
  },
});
