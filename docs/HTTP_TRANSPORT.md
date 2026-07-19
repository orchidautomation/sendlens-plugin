# Streamable HTTP Transport

SendLens uses stdio by default for local AI hosts. Streamable HTTP is an opt-in deployment mode for a generic remote MCP client. It exposes the same read-only tools and the same single configured workspace; it does not add multi-tenancy, user accounts, OAuth, or provider mutation paths.

## Security prerequisites

- Put any publicly reachable deployment behind HTTPS. SendLens serves plain HTTP and expects a trusted reverse proxy or platform edge to terminate TLS.
- Generate a unique high-entropy deployment credential, store it in the deployment secret manager, and rotate it when access changes. Never commit or log it.
- Allow only the public hostname that the application actually receives in the HTTP Host header. SendLens does not trust forwarded-host headers.
- Leave browser origins empty unless a specific browser client needs access. Generic MCP clients normally send no Origin header.
- Treat one process as one workspace. Anyone with the transport credential can use every exposed SendLens tool against that configured workspace.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SENDLENS_TRANSPORT` | `stdio` | Set to `http` to enable Streamable HTTP. Other values fail startup. |
| `SENDLENS_HTTP_HOST` | `127.0.0.1` | Bind host. A wildcard or non-loopback bind requires an explicit allowed-host list. |
| `SENDLENS_HTTP_PORT` | `3000` | Bind port from 0 through 65535. Port 0 is useful for tests. |
| `SENDLENS_HTTP_BEARER_TOKEN` | none | Required in HTTP mode. Use a token-safe value containing at least 32 UTF-8 bytes. |
| `SENDLENS_HTTP_ALLOWED_HOSTS` | localhost values on a loopback bind | Comma-separated hostnames without ports. Required for wildcard and non-loopback binds. |
| `SENDLENS_HTTP_ALLOWED_ORIGINS` | empty | Comma-separated exact `http://` or `https://` origins with no path, query, or fragment. |
| `SENDLENS_HTTP_MAX_SESSIONS` | `100` | In-process connection cap from 1 through 1000. |

Provider and workspace variables work exactly as they do in stdio mode. In particular, `SENDLENS_CLIENT`, provider credentials, cache paths, demo mode, and read-only tool behavior are process-wide rather than selected per HTTP request.

For a TLS-terminating proxy that forwards `sendlens.example.com` as the Host header:

```bash
export SENDLENS_TRANSPORT=http
export SENDLENS_HTTP_HOST=0.0.0.0
export SENDLENS_HTTP_PORT=3000
export SENDLENS_HTTP_BEARER_TOKEN="replace-with-output-from-openssl-rand-hex-32"
export SENDLENS_HTTP_ALLOWED_HOSTS=sendlens.example.com
npm run start:plugin-mcp
```

Generate a suitable credential with `openssl rand -hex 32`; transfer its output directly to the deployment secret manager rather than a tracked env file. Configure the client endpoint as `https://sendlens.example.com/mcp` and send the credential using the standard HTTP bearer authorization scheme.

If a browser MCP client at `https://app.example.com` needs access, add:

```bash
export SENDLENS_HTTP_ALLOWED_ORIGINS=https://app.example.com
```

Origin matching is exact. A request with no Origin is accepted for non-browser clients; any present Origin is rejected unless it is listed. Allowed origins receive narrow CORS methods and headers. Wildcard CORS is never enabled.

## Endpoints and lifecycle

- `POST /mcp` initializes a connection or sends an MCP request.
- `GET /mcp` opens the Streamable HTTP event stream for an initialized connection.
- `DELETE /mcp` closes an initialized connection.
- `GET /health` returns only `status`, plugin `version`, and `transport`. It does not test provider connectivity or reveal workspace, credential, cache, or connection state.

Every MCP `POST`, `GET`, and `DELETE` requires the deployment credential. Browser `OPTIONS` preflight is the only exception and is still rejected unless its Host and Origin are allowed. Host and Origin policy run before access checks, and access checks run before the bounded 100 KiB JSON parser. Missing, malformed, and incorrect credentials receive the same response. Request bodies, credentials, connection identifiers, query strings, provider data, and workspace paths are not written to HTTP lifecycle logs.

Connection state lives in one process and is lost on restart. A multi-replica deployment needs sticky routing for the lifetime of a connection; SendLens does not provide distributed connection state. Graceful shutdown stops accepting requests and closes active MCP transports.

## Deployment check

Before exposing a deployment to real workspace data:

1. Confirm HTTPS termination and the exact Host header delivered to SendLens.
2. Confirm missing and incorrect credentials return 401, and disallowed Host/Origin requests are rejected.
3. Connect the official MCP Inspector or another standards-compatible client to the `/mcp` endpoint.
4. Initialize, list tools, invoke `setup_doctor`, and terminate the connection.
5. Inspect application logs and confirm no request credential, request body, connection identifier, provider credential, workspace path, or customer data appears.

The automated repository proof covers the same protocol flow on loopback with the official TypeScript SDK client. A real TLS/proxy check remains an operator staging gate because this repository does not ship vendor-specific deployment configuration.
