import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { PLUGIN_VERSION } from "./version";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3_000;
const DEFAULT_CONNECTION_LIMIT = 100;
const MAX_CONNECTION_LIMIT = 1_000;
const JSON_BODY_LIMIT = "100kb";
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const TOKEN68_PATTERN = /^[A-Za-z0-9\-._~+/]+=*$/;
const SECRET_ENV_KEY = "SENDLENS_HTTP_BEARER_TOKEN";
const CONNECTION_LIMIT_ENV_KEY = "SENDLENS_HTTP_MAX_SESSIONS";
const CREDENTIAL_HEADER = "Authorization";
const AUTH_SCHEME = "Bearer";
const CONNECTION_HEADER = "mcp-session-id";

export interface HttpTransportConfig {
  host: string;
  port: number;
  credentialDigest: Buffer;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxConnections: number;
}

interface ActiveConnection {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  connected: boolean;
}

export interface SendLensHttpController {
  url: URL;
  version: string;
  activeConnectionCount(): number;
  close(): Promise<void>;
}

interface StartHttpServerOptions {
  createServer: () => McpServer;
  env?: NodeJS.ProcessEnv;
  logger?: (message: string) => void;
}

export function resolveHttpTransportConfig(env: NodeJS.ProcessEnv = process.env): HttpTransportConfig {
  const host = env.SENDLENS_HTTP_HOST?.trim() || DEFAULT_HOST;
  if (/\s|\//.test(host)) {
    throw new Error("SENDLENS_HTTP_HOST must be a valid bind host.");
  }

  const secret = env[SECRET_ENV_KEY] || "";
  if (!secret) {
    throw new Error("A deployment bearer credential is required in HTTP mode.");
  }
  if (Buffer.byteLength(secret, "utf8") < 32 || !TOKEN68_PATTERN.test(secret)) {
    throw new Error("The HTTP bearer credential must be token-safe and at least 32 UTF-8 bytes.");
  }

  return {
    host,
    port: parseInteger(env.SENDLENS_HTTP_PORT, DEFAULT_PORT, 0, 65_535, "SENDLENS_HTTP_PORT"),
    credentialDigest: digest(secret),
    allowedHosts: parseAllowedHosts(env.SENDLENS_HTTP_ALLOWED_HOSTS, host),
    allowedOrigins: parseAllowedOrigins(env.SENDLENS_HTTP_ALLOWED_ORIGINS),
    maxConnections: parseInteger(
      env[CONNECTION_LIMIT_ENV_KEY],
      DEFAULT_CONNECTION_LIMIT,
      1,
      MAX_CONNECTION_LIMIT,
      CONNECTION_LIMIT_ENV_KEY,
    ),
  };
}

function parseInteger(
  rawValue: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  variableName: string,
) {
  const value = rawValue == null || rawValue === "" ? String(defaultValue) : rawValue;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${variableName} must be an integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${variableName} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function parseAllowedHosts(rawValue: string | undefined, bindHost: string) {
  const configured = parseList(rawValue);
  if (configured.length === 0) {
    if (isLoopbackHost(bindHost)) return [...LOOPBACK_HOSTS];
    throw new Error("SENDLENS_HTTP_ALLOWED_HOSTS is required for non-loopback HTTP binds.");
  }

  return unique(configured.map((entry) => {
    let parsed: URL;
    try {
      parsed = new URL(`http://${entry}`);
    } catch {
      throw new Error("SENDLENS_HTTP_ALLOWED_HOSTS must contain valid hostnames without ports.");
    }
    if (parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error("SENDLENS_HTTP_ALLOWED_HOSTS must contain valid hostnames without ports.");
    }
    return parsed.hostname.toLowerCase();
  }));
}

function parseAllowedOrigins(rawValue: string | undefined) {
  return unique(parseList(rawValue).map((entry) => {
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error("SENDLENS_HTTP_ALLOWED_ORIGINS must contain valid HTTP origins.");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.origin !== entry
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      throw new Error("SENDLENS_HTTP_ALLOWED_ORIGINS must contain exact HTTP origins without paths.");
    }
    return parsed.origin;
  }));
}

function parseList(rawValue: string | undefined) {
  if (!rawValue?.trim()) return [];
  const entries = rawValue.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !entry)) {
    throw new Error("HTTP allowlists cannot contain empty entries.");
  }
  return entries;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isLoopbackHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export async function startSendLensHttpServer(
  options: StartHttpServerOptions,
): Promise<SendLensHttpController> {
  const config = resolveHttpTransportConfig(options.env);
  const logger = options.logger ?? (() => undefined);
  const app = express();
  const manager = new ConnectionManager(options.createServer, config.maxConnections, logger);
  const expectedDigest = config.credentialDigest;
  const transportName = "http";

  app.disable("x-powered-by");
  app.use(hostHeaderValidation(config.allowedHosts));
  app.use(originPolicy(config.allowedOrigins));
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", version: PLUGIN_VERSION, transport: transportName });
  });
  app.options("/mcp", preflightHandler);
  app.use("/mcp", requestAccessPolicy(expectedDigest));
  app.use("/mcp", express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.post("/mcp", (request, response) => manager.handlePost(request, response));
  app.get("/mcp", (request, response) => manager.handleExisting(request, response));
  app.delete("/mcp", (request, response) => manager.handleExisting(request, response));
  app.all("/mcp", (_request, response) => sendError(response, 405, -32_000, "Method not allowed"));
  app.use(requestErrorHandler(logger));

  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const candidate = app.listen(config.port, config.host);
    candidate.once("listening", () => resolve(candidate));
    candidate.once("error", reject);
  });
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 10_000;
  httpServer.keepAliveTimeout = 5_000;
  httpServer.maxHeadersCount = 100;

  const address = httpServer.address() as AddressInfo;
  const urlHost = config.host.includes(":") ? `[${config.host.replace(/^\[|\]$/g, "")}]` : config.host;
  const url = new URL(`http://${urlHost}:${address.port}`);
  let closePromise: Promise<void> | undefined;

  logger("[sendlens] HTTP transport started");
  return {
    url,
    version: PLUGIN_VERSION,
    activeConnectionCount: () => manager.activeCount,
    close() {
      closePromise ??= closeHttpServer(httpServer, manager, logger);
      return closePromise;
    },
  };
}

function originPolicy(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.get("origin");
    if (!origin) {
      next();
      return;
    }
    if (!allowed.has(origin)) {
      sendError(response, 403, -32_000, "Origin not allowed");
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.vary("Origin");
    next();
  };
}

function preflightHandler(request: Request, response: Response) {
  if (!request.get("origin")) {
    sendError(response, 403, -32_000, "Origin required");
    return;
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    `${CREDENTIAL_HEADER}, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID`,
  );
  response.setHeader("Access-Control-Max-Age", "600");
  response.status(204).end();
}

function requestAccessPolicy(expectedDigest: Buffer) {
  return (request: Request, response: Response, next: NextFunction) => {
    const value = request.get(CREDENTIAL_HEADER) || "";
    const prefix = `${AUTH_SCHEME} `;
    const supplied = value.startsWith(prefix) ? value.slice(prefix.length) : "";
    const validFormat = value === `${prefix}${supplied}` && TOKEN68_PATTERN.test(supplied);
    const accepted = timingSafeEqual(expectedDigest, digest(supplied));
    if (!validFormat || !accepted) {
      response.setHeader("WWW-Authenticate", AUTH_SCHEME);
      sendError(response, 401, -32_001, "Unauthorized");
      return;
    }
    next();
  };
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

class ConnectionManager {
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly opening = new Set<ActiveConnection>();
  private readonly closePromises = new WeakMap<ActiveConnection, Promise<void>>();
  private closing = false;

  constructor(
    private readonly createServer: () => McpServer,
    private readonly maximum: number,
    private readonly logger: (message: string) => void,
  ) {}

  get activeCount() {
    return this.connections.size;
  }

  async handleExisting(request: Request, response: Response) {
    const id = request.get(CONNECTION_HEADER);
    if (!id) {
      sendError(response, 400, -32_000, "Connection identifier required");
      return;
    }
    const connection = this.connections.get(id);
    if (!connection) {
      sendError(response, 404, -32_001, "Connection not found");
      return;
    }
    await connection.transport.handleRequest(request, response, request.body);
  }

  async handlePost(request: Request, response: Response) {
    if (request.get(CONNECTION_HEADER)) {
      await this.handleExisting(request, response);
      return;
    }
    if (!isInitializeRequest(request.body)) {
      sendError(response, 400, -32_000, "Valid initialization request required");
      return;
    }
    if (this.closing || this.connections.size + this.opening.size >= this.maximum) {
      sendError(response, 503, -32_002, "Connection capacity reached");
      return;
    }

    const server = this.createServer();
    let connection: ActiveConnection;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: async (id) => {
        this.opening.delete(connection);
        if (this.closing) {
          await this.closeConnection(connection);
          return;
        }
        this.connections.set(id, connection);
      },
    });
    connection = { server, transport, connected: false };
    this.opening.add(connection);
    transport.onclose = () => {
      this.opening.delete(connection);
      const id = transport.sessionId;
      if (id && this.connections.get(id) === connection) {
        this.connections.delete(id);
      }
    };

    try {
      await server.connect(transport);
      connection.connected = true;
      if (this.closing) {
        sendError(response, 503, -32_002, "Server is shutting down");
        await this.closeConnection(connection);
        return;
      }
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      await this.closeConnection(connection);
      throw error;
    } finally {
      if (!transport.sessionId) {
        this.opening.delete(connection);
        await this.closeConnection(connection);
      }
    }
  }

  async closeAll() {
    this.closing = true;
    const current = [...this.connections.values(), ...this.opening].filter(({ connected }) => connected);
    await Promise.all(current.map((connection) => this.closeConnection(connection)));
    this.connections.clear();
    this.opening.clear();
  }

  private closeConnection(connection: ActiveConnection) {
    const existing = this.closePromises.get(connection);
    if (existing) return existing;
    const closing = connection.connected
      ? connection.server.close().catch(() => {
        this.logger("[sendlens] HTTP connection cleanup failed");
      })
      : Promise.resolve();
    this.closePromises.set(connection, closing);
    return closing;
  }
}

function requestErrorHandler(logger: (message: string) => void): ErrorRequestHandler {
  return (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const status = typeof error === "object" && error && "status" in error
      ? Number(error.status)
      : 500;
    if (status === 413) {
      sendError(response, 413, -32_003, "Request body too large");
      return;
    }
    if (status === 400 && error instanceof SyntaxError) {
      sendError(response, 400, -32_000, "Malformed JSON request");
      return;
    }
    logger("[sendlens] HTTP request failed");
    sendError(response, 500, -32_603, "Internal server error");
  };
}

function sendError(response: Response, status: number, code: number, message: string) {
  response.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

async function closeHttpServer(
  httpServer: Server,
  manager: ConnectionManager,
  logger: (message: string) => void,
) {
  const stopped = new Promise<void>((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
  });
  await manager.closeAll();
  httpServer.closeAllConnections();
  await stopped;
  logger("[sendlens] HTTP transport stopped");
}
