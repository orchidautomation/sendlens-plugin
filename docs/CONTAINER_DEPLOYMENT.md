# Single-Tenant Container Deployment

SendLens ships a portable container contract for one authenticated Streamable HTTP MCP service. One container process owns one configured workspace and one persistent DuckDB cache. It does not add multi-tenancy, account routing, billing, provider mutations, or a managed cloud control plane.

## Runtime Boundary

- The image starts `SENDLENS_TRANSPORT=http` and serves the existing read-only MCP tools over `/mcp`.
- Persistent state lives under one mounted directory, `/data` by default.
- Secrets are injected at runtime through environment variables. They are not build arguments and are not stored in the image.
- The container runs as the non-root `sendlens` user with UID/GID `10001`.
- `/health` returns only `status`, plugin `version`, and `transport`.

## Persistent Storage Layout

| Path | Purpose |
| --- | --- |
| `/data/workspace-cache.duckdb` | DuckDB workspace cache |
| `/data/workspace-cache.duckdb.wal` | DuckDB WAL when present |
| `/data/state/refresh-status.json` | Refresh lifecycle state |
| `/data/clients/` | Optional client env overlays when `SENDLENS_CLIENT` is used |
| `/data/context/` | Default context root for container env loading |

Override the mount root with `SENDLENS_DATA_DIR`, but keep it absolute and writable by UID/GID `10001`. Override individual paths only when the platform requires it:

```bash
SENDLENS_DB_PATH=/data/workspace-cache.duckdb
SENDLENS_STATE_DIR=/data/state
SENDLENS_CLIENTS_DIR=/data/clients
SENDLENS_CONTEXT_ROOT=/data/context
```

Do not run horizontal replicas against the same DuckDB volume. Use one container per workspace and one writable volume per container.

## Required Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `SENDLENS_HTTP_BEARER_TOKEN` | yes | High-entropy deployment credential for MCP requests. Use at least 32 token-safe bytes. |
| `SENDLENS_HTTP_ALLOWED_HOSTS` | yes | Comma-separated exact hostnames the platform forwards in the HTTP `Host` header, without ports. |
| `SENDLENS_INSTANTLY_API_KEY` or `SENDLENS_SMARTLEAD_API_KEY` | first real refresh | Provider credential. The image also starts with an existing mounted cache or `SENDLENS_DEMO_MODE=1`. |
| `SENDLENS_PROVIDER` | when selecting provider mode | `instantly`, `smartlead`, or `all`; default inference follows the standard SendLens runtime. |
| `SENDLENS_CLIENT` | when using a named client overlay | Selects one workspace overlay from `SENDLENS_CLIENTS_DIR`. |

Optional HTTP settings are inherited from the Streamable HTTP contract:

```bash
SENDLENS_HTTP_HOST=0.0.0.0
SENDLENS_HTTP_PORT=3000
SENDLENS_HTTP_ALLOWED_ORIGINS=
SENDLENS_HTTP_MAX_SESSIONS=100
```

Set `SENDLENS_HTTP_ALLOWED_ORIGINS` only for a browser MCP client that needs CORS. Generic MCP clients normally omit `Origin`.

## Build And Run Locally

Build the image from a clean checkout:

```bash
docker build -t sendlens:local .
```

Run a synthetic proof container with a temporary local volume:

```bash
mkdir -p .sendlens-container-data

docker run --rm \
  -p 127.0.0.1:3000:3000 \
  -v "$PWD/.sendlens-container-data:/data" \
  -e SENDLENS_DEMO_MODE=1 \
  -e SENDLENS_HTTP_BEARER_TOKEN="$(openssl rand -hex 32)" \
  -e SENDLENS_HTTP_ALLOWED_HOSTS=localhost,127.0.0.1 \
  sendlens:local
```

For a real deployment, store provider credentials and the bearer token in the platform secret manager:

```bash
docker run --rm \
  -p 3000:3000 \
  -v sendlens-data:/data \
  -e SENDLENS_HTTP_BEARER_TOKEN="$SENDLENS_HTTP_BEARER_TOKEN" \
  -e SENDLENS_HTTP_ALLOWED_HOSTS=sendlens.example.com \
  -e SENDLENS_INSTANTLY_API_KEY="$SENDLENS_INSTANTLY_API_KEY" \
  sendlens:local
```

Configure the MCP client endpoint as `https://sendlens.example.com/mcp` after TLS termination at your platform edge or reverse proxy.

## Startup Failures

The container exits before starting the HTTP service when:

- `/data` is not writable by the container user.
- `SENDLENS_HTTP_BEARER_TOKEN` is missing.
- `SENDLENS_HTTP_ALLOWED_HOSTS` is missing.
- No provider key, no existing DuckDB cache, and no `SENDLENS_DEMO_MODE=1` proof mode are available.

These checks are intentionally privacy-safe. They do not print credentials, request bodies, provider payloads, workspace data, or local cache contents.

## Persistence, Backup, And Upgrade

DuckDB cache-owner metadata is stored in the database and includes a SHA-256 provider-key fingerprint. A different provider credential cannot silently read a prior cache; SendLens returns the existing cache-readiness failure and requires a refresh with the current key.

For backups, stop the container or ensure no refresh is running, then copy the full persistent directory including the DuckDB file, any WAL, and `state/`. Restoring means mounting the copied directory at `/data` for the same workspace configuration.

For upgrades, stop the existing container and start the new image against the same `/data` volume. SendLens schema migrations run through the existing local DuckDB migration path. Keep one writer attached to the volume during the upgrade.

## Validation

The repository smoke test builds the image, starts it with synthetic data, checks `/health`, performs an authenticated MCP `setup_doctor` call, confirms files are created under `/data`, restarts the container against the same volume, and stops it with Docker's normal `SIGTERM` flow:

```bash
npm run test:container
```

The test uses synthetic/demo data only.
