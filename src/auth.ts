// src/auth.ts — OAuth provider for multi-tenant Gemini API key flow
import { randomUUID, randomBytes } from "crypto";
import { Response } from "express";
import {
  OAuthRegisteredClientsStore,
} from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// --- Clients Store (dynamic registration) ---

export class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(full.client_id, full);
    return full;
  }
}

// --- Internal types ---

interface PendingCode {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  geminiApiKey: string;
}

interface StoredToken {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  geminiApiKey: string;
}

// --- OAuth Provider ---

const TOKEN_TTL_SECONDS = 3600; // 1 hour

export class GeminiKeyOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: InMemoryClientsStore;

  // auth code -> pending code data
  private codes = new Map<string, PendingCode>();

  // access token -> stored token data
  private tokens = new Map<string, StoredToken>();

  constructor(clientsStore?: InMemoryClientsStore) {
    this.clientsStore = clientsStore ?? new InMemoryClientsStore();
  }

  /**
   * Look up the Gemini API key associated with a verified access token.
   */
  getGeminiApiKey(accessToken: string): string | undefined {
    const stored = this.tokens.get(accessToken);
    if (!stored) return undefined;
    if (Date.now() / 1000 > stored.expiresAt) {
      this.tokens.delete(accessToken);
      return undefined;
    }
    return stored.geminiApiKey;
  }

  // --- OAuthServerProvider implementation ---

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Serve an HTML form where the user enters their Gemini API key.
    // The form POSTs to /oauth/authorize/submit with the data we need.
    const html = buildAuthorizePage(client, params);
    res.type("html").send(html);
  }

  /**
   * Called from the custom /oauth/authorize/submit POST handler.
   * Generates an auth code, stores the Gemini key, and redirects to the client.
   */
  completeAuthorization(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    geminiApiKey: string,
    res: Response,
  ): void {
    const code = randomBytes(32).toString("hex");
    this.codes.set(code, { client, params, geminiApiKey });

    // Build redirect URL with code (and state if provided)
    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state) {
      redirectUrl.searchParams.set("state", params.state);
    }

    res.redirect(redirectUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const pending = this.codes.get(authorizationCode);
    if (!pending) throw new Error("Unknown authorization code");
    return pending.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const pending = this.codes.get(authorizationCode);
    if (!pending) throw new Error("Unknown authorization code");
    this.codes.delete(authorizationCode);

    const accessToken = randomBytes(48).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

    this.tokens.set(accessToken, {
      clientId: pending.client.client_id,
      scopes: pending.params.scopes ?? [],
      expiresAt,
      geminiApiKey: pending.geminiApiKey,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: TOKEN_TTL_SECONDS,
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error("Refresh tokens not supported");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = this.tokens.get(token);
    if (!stored) throw new Error("Invalid access token");

    if (Date.now() / 1000 > stored.expiresAt) {
      this.tokens.delete(token);
      throw new Error("Access token expired");
    }

    return {
      token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: stored.expiresAt,
    };
  }
}

// --- HTML form for the authorize page ---

function buildAuthorizePage(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): string {
  const clientName = client.client_name || client.client_id;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize - text2image MCP</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 2rem;
      max-width: 420px;
      width: 100%;
    }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; color: #fff; }
    .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .client-name { color: #60a5fa; font-weight: 600; }
    label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 0.4rem; }
    input[type="password"] {
      width: 100%;
      padding: 0.7rem 0.8rem;
      background: #111;
      border: 1px solid #444;
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus { border-color: #60a5fa; }
    .help { font-size: 0.75rem; color: #666; margin-top: 0.4rem; }
    .help a { color: #60a5fa; text-decoration: none; }
    .help a:hover { text-decoration: underline; }
    button {
      width: 100%;
      margin-top: 1.5rem;
      padding: 0.75rem;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #1d4ed8; }
    .field { margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>text2image MCP</h1>
    <p class="subtitle">
      <span class="client-name">${escapeHtml(clientName)}</span> wants to connect.
      Enter your Gemini API key to authorize.
    </p>
    <form method="POST" action="/oauth/authorize/submit">
      <input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
      ${params.state ? `<input type="hidden" name="state" value="${escapeHtml(params.state)}">` : ""}
      ${params.scopes ? `<input type="hidden" name="scopes" value="${escapeHtml(params.scopes.join(" "))}">` : ""}
      <div class="field">
        <label for="gemini_api_key">Gemini API Key</label>
        <input type="password" id="gemini_api_key" name="gemini_api_key"
               placeholder="AIza..." required autocomplete="off">
        <p class="help">
          Get a free key at
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>
        </p>
      </div>
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
