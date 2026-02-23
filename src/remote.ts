#!/usr/bin/env node
// src/remote.ts
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { NanoBananaMCP } from "./server.js";
import { GeminiKeyOAuthProvider } from "./auth.js";

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

// --- OAuth setup ---

const SERVER_API_KEY = process.env.GEMINI_API_KEY?.trim() || null;
const PUBLIC_URL = process.env.PUBLIC_URL?.trim() || null;

// OAuth is enabled when PUBLIC_URL is set (HTTPS URL of the deployment)
const oauthEnabled = PUBLIC_URL !== null;
const oauthProvider = oauthEnabled ? new GeminiKeyOAuthProvider() : null;

// --- Express app ---

const app = express();
app.use(cors());

// Mount OAuth router BEFORE body parsing (it has its own parsers)
if (oauthEnabled && oauthProvider) {
  const issuerUrl = new URL(PUBLIC_URL!);

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      serviceDocumentationUrl: new URL("https://github.com/kishorkukreja/Nano-Banana-MCP"),
    }),
  );

  // Custom form submission endpoint for the authorize page
  app.post("/oauth/authorize/submit", express.urlencoded({ extended: false }), (req, res) => {
    const { client_id, redirect_uri, code_challenge, state, scopes, gemini_api_key } = req.body;

    if (!client_id || !redirect_uri || !code_challenge || !gemini_api_key) {
      res.status(400).send("Missing required fields.");
      return;
    }

    const client = oauthProvider.clientsStore.getClient(client_id);
    if (!client) {
      res.status(400).send("Unknown client.");
      return;
    }

    const params = {
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      state: state || undefined,
      scopes: scopes ? (scopes as string).split(" ") : undefined,
    };

    oauthProvider.completeAuthorization(client, params, gemini_api_key, res);
  });
}

app.use(express.json());

// --- Health endpoint (no auth) ---

app.get("/health", (_req, res) => {
  res.json({ status: "ok", sessions: sessions.size, oauth: oauthEnabled });
});

// --- API key resolution ---

function resolveApiKey(req: express.Request): string | null {
  // 1. Server-side env var — self-hosted single-tenant
  if (SERVER_API_KEY) return SERVER_API_KEY;

  // 2. OAuth: look up Gemini key from verified access token
  if (oauthProvider && req.auth) {
    const key = oauthProvider.getGeminiApiKey(req.auth.token);
    if (key) return key;
  }

  // 3. Direct Bearer token fallback (non-OAuth, e.g. curl testing)
  if (!oauthEnabled) {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      return auth.slice(7).trim() || null;
    }
  }

  return null;
}

// --- Bearer auth middleware (conditional) ---

const bearerAuth = oauthEnabled && oauthProvider
  ? requireBearerAuth({ verifier: oauthProvider })
  : undefined;

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // If OAuth is enabled, require Bearer auth on MCP endpoints
  if (bearerAuth) {
    bearerAuth(req, res, next);
    return;
  }
  // Otherwise, skip (resolveApiKey handles direct Bearer / env var)
  next();
}

// --- MCP helpers ---

function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(
      (msg) => typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).method === "initialize",
    );
  }
  return typeof body === "object" && body !== null && (body as Record<string, unknown>).method === "initialize";
}

// --- MCP endpoint ---

app.post("/mcp", authMiddleware, async (req, res) => {
  const apiKey = resolveApiKey(req);
  if (!apiKey) {
    res.status(401).json({
      error: "Missing API key. Authorize via OAuth or set GEMINI_API_KEY env var on server.",
    });
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

app.get("/mcp", authMiddleware, async (req, res) => {
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

app.delete("/mcp", authMiddleware, async (req, res) => {
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
  if (oauthEnabled) {
    console.log(`OAuth enabled (issuer: ${PUBLIC_URL})`);
  } else if (SERVER_API_KEY) {
    console.log("Using server-side GEMINI_API_KEY (no OAuth)");
  } else {
    console.log("No GEMINI_API_KEY or PUBLIC_URL set — clients must send Bearer token directly");
  }
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
