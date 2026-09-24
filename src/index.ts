import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { nanoid } from "nanoid";
import * as Y from "yjs";
import { WebSocket } from "ws";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT ?? 8787);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const releasesDir = path.resolve(process.env.RELEASES_DIR ?? path.join(rootDir, "releases"));
const protocolVersion = 1;
const minimumClientVersion = process.env.MINIMUM_CLIENT_VERSION ?? "0.1.0";
const minimumProtocolVersion = Number(process.env.MINIMUM_PROTOCOL_VERSION ?? 1);
const maxMessageBytes = 256 * 1024;

type Role = "editor" | "viewer";
type Room = {
  id: string;
  title?: string;
  editorToken: string;
  viewerToken: string;
  doc: Y.Doc;
  sockets: Map<WebSocket, Role>;
  createdAt: string;
  lastActivityAt: string;
};

const rooms = new Map<string, Room>();
const sessionSchema = z.object({ title: z.string().trim().max(120).optional() });
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

function jsonMessage(value: unknown): string {
  return JSON.stringify(value);
}
function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}
function fromBase64(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || value.length > maxMessageBytes * 2) return undefined;
  try { return new Uint8Array(Buffer.from(value, "base64")); } catch { return undefined; }
}
function roomFor(id: string): Room | undefined { return rooms.get(id); }
function send(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(jsonMessage(value));
}
function broadcast(room: Room, value: unknown, except?: WebSocket): void {
  const message = jsonMessage(value);
  for (const socket of room.sockets.keys()) {
    if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(websocket);
await app.register(fastifyStatic, { root: path.join(rootDir, "web"), prefix: "/" });
await app.register(fastifyStatic, { root: releasesDir, prefix: "/downloads/", decorateReply: false, wildcard: true });

app.get("/health", async () => ({ ok: true, service: "text-on-screen-server", protocolVersion }));
app.get("/api/v1/version", async () => ({
  protocolVersion,
  minimumProtocolVersion,
  minimumClientVersion,
  serverVersion: process.env.SERVER_VERSION ?? "0.1.0"
}));

app.get("/api/v1/releases/latest", async (_request, reply) => {
  const latestPath = path.join(releasesDir, "latest.json");
  if (!existsSync(latestPath)) return reply.code(404).send({ error: "release_not_found" });
  try {
    const release = JSON.parse(readFileSync(latestPath, "utf8")) as Record<string, unknown>;
    return { ...release, protocolVersion, minimumClientVersion };
  } catch {
    return reply.code(503).send({ error: "release_metadata_invalid" });
  }
});

app.post("/api/v1/sessions", async (request, reply) => {
  const parsed = sessionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
  const id = nanoid(10);
  const room: Room = {
    id,
    title: parsed.data.title,
    editorToken: nanoid(32),
    viewerToken: nanoid(32),
    doc: new Y.Doc(),
    sockets: new Map(),
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString()
  };
  room.doc.getText("text");
  room.doc.getMap("settings");
  rooms.set(id, room);
  return reply.code(201).send({
    sessionId: id,
    editorToken: room.editorToken,
    viewerToken: room.viewerToken,
    editorUrl: `${publicBaseUrl}/editor/?session=${encodeURIComponent(id)}&token=${encodeURIComponent(room.editorToken)}`,
    viewerUrl: `${publicBaseUrl.replace(/^http/, "ws")}/api/v1/sessions/${id}?token=${encodeURIComponent(room.viewerToken)}`,
    protocolVersion
  });
});

app.route({
  method: "GET",
  url: "/api/v1/sessions/:id",
  handler: async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const room = roomFor(id);
    if (!room) return reply.code(404).send({ error: "session_not_found" });
    return { sessionId: room.id, title: room.title, createdAt: room.createdAt, protocolVersion };
  },
  wsHandler: (socket: WebSocket, request: any) => {
    const id = request.params.id as string;
    const token = String(request.query?.token ?? "");
    const clientProtocol = Number(request.query?.protocolVersion ?? protocolVersion);
    const room = roomFor(id);
    if (!room) { socket.close(1008, "session_not_found"); return; }
    const role: Role | undefined = token === room.editorToken ? "editor" : token === room.viewerToken ? "viewer" : undefined;
    if (!role) { socket.close(1008, "invalid_token"); return; }
    if (!Number.isFinite(clientProtocol) || clientProtocol < minimumProtocolVersion) { socket.close(1008, "protocol_update_required"); return; }
    room.sockets.set(socket, role);
    room.lastActivityAt = new Date().toISOString();
    send(socket, { type: "hello", protocolVersion, minimumProtocolVersion, minimumClientVersion, sessionId: room.id, role });
    send(socket, { type: "sync", update: toBase64(Y.encodeStateAsUpdate(room.doc)) });

    socket.on("message", (raw: Buffer) => {
      if (raw.byteLength > maxMessageBytes) { send(socket, { type: "error", code: "message_too_large" }); return; }
      let message: any;
      try { message = JSON.parse(raw.toString("utf8")); } catch { send(socket, { type: "error", code: "invalid_json" }); return; }
      if (message?.type === "sync") {
        if (role !== "editor") { send(socket, { type: "error", code: "read_only" }); return; }
        const update = fromBase64(message.update);
        if (!update) { send(socket, { type: "error", code: "invalid_update" }); return; }
        try {
          Y.applyUpdate(room.doc, update);
          room.lastActivityAt = new Date().toISOString();
          broadcast(room, { type: "sync", update: toBase64(update) }, socket);
        } catch { send(socket, { type: "error", code: "update_rejected" }); }
        return;
      }
      if (message?.type === "awareness") {
        broadcast(room, { type: "awareness", state: message.state }, socket);
        return;
      }
      send(socket, { type: "error", code: "unknown_message" });
    });
    socket.on("close", () => room.sockets.delete(socket));
  }
});
const listenHost = process.env.HOST ?? "0.0.0.0";
await app.listen({ port, host: listenHost });
app.log.info(`text-on-screen server listening on ${listenHost}:${port}`);

