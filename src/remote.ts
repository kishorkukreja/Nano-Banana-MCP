#!/usr/bin/env node
// src/remote.ts
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { NanoBananaMCP } from "./server.js";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface Session {
  transport: StreamableHTTPServerTransport;
  mcp: NanoBananaMCP;
  lastActivity: number;
}

const sessions = new Map<string, Session>();

// --- Cleanup stale sessions ---

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      session.transport.close();
      sessions.delete(id);
    }
  }
}, 60_000);

// --- Express app ---

const app = express();
app.use(cors());
app.use(express.json());

// --- Health endpoint ---

app.get("/health", (_req, res) => {
  res.json({ status: "ok", sessions: sessions.size });
});

// --- MCP endpoint ---

// API key resolution: env var takes priority, then Bearer token from client
const SERVER_API_KEY = process.env.GEMINI_API_KEY?.trim() || null;

function resolveApiKey(req: express.Request): string | null {
  // Server-side env var — used for hosted deployments (Railway, etc.)
  if (SERVER_API_KEY) return SERVER_API_KEY;

  // Client-provided Bearer token — used for multi-tenant setups
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(
      (msg) => typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).method === "initialize",
    );
  }
  return typeof body === "object" && body !== null && (body as Record<string, unknown>).method === "initialize";
}

app.post("/mcp", async (req, res) => {
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key. Set GEMINI_API_KEY env var on server, or send Authorization: Bearer <key>." });
    return;
  }

  // Check for existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found. Send an initialize request to start a new session." });
      return;
    }
    session.lastActivity = Date.now();
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // No session ID — must be an initialize request
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({ error: "Missing mcp-session-id header. Send an initialize request first." });
    return;
  }

  // Create new session
  const mcp = new NanoBananaMCP({ apiKey, isRemote: true });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sessions.set(newSessionId, { transport, mcp, lastActivity: Date.now() });
    },
    onsessionclosed: (closedSessionId) => {
      sessions.delete(closedSessionId);
    },
  });

  await mcp.connectTransport(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "Missing mcp-session-id header." });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  session.lastActivity = Date.now();
  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "Missing mcp-session-id header." });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  await session.transport.handleRequest(req, res);
  sessions.delete(sessionId);
});

// --- Start server ---

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = app.listen(PORT, () => {
  console.log(`text2image-mcp remote server listening on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});

// --- Graceful shutdown ---

function shutdown() {
  console.log("\nShutting down...");
  clearInterval(cleanupInterval);
  for (const [id, session] of sessions) {
    session.transport.close();
    sessions.delete(id);
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
