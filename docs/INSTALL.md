# Install SendLens

SendLens ships as native host bundles for:

- Claude Code
- Cursor
- Codex
- OpenCode

## Fastest Path

Paste one of these:

Claude Code

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh | bash
```

Cursor

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-cursor.sh | bash
```

Codex

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh | bash
```

OpenCode

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-opencode.sh | bash
```

All supported hosts

```bash
curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-all.sh | bash
```

## Bundle Downloads

If you want the raw bundles:

- [Claude Code bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-claude-code-latest.tar.gz)
- [Cursor bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-cursor-latest.tar.gz)
- [Codex bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-codex-latest.tar.gz)
- [OpenCode bundle](https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/sendlens-opencode-latest.tar.gz)

## Local Development Install

```bash
git clone https://github.com/orchidautomation/sendlens-plugin.git
cd sendlens-plugin
npm install
cp .env.example .env
```

Set at least:

```bash
SENDLENS_INSTANTLY_API_KEY=your_key
```

Then build and install:

```bash
npm run test:plugin
pluxx validate
pluxx build --target claude-code cursor codex opencode
pluxx install --target claude-code cursor codex opencode --trust
```

## After Install

Reload your host:

- Claude Code: `/reload-plugins`
- Cursor: reload the window
- Codex: refresh plugins or restart
- OpenCode: restart or reload

Expected startup behavior:

- every new session triggers a fresh background refresh
- the local cache updates in a few seconds
- `refresh_status` reports the current session-start refresh

If tools do not appear, the API key is missing, refresh is still running, or the cache is empty, see the [troubleshooting guide](./TROUBLESHOOTING.md).

## If You Previously Installed `sendlens-local`

If Claude Code still has the older `sendlens-local` plugin enabled, disable or uninstall it before testing the release build. Otherwise you can get hook errors from the old plugin even if the new `sendlens` release installed correctly.

## Env Loading

Supported order:

1. `.env`
2. `.env.local`
3. `.env.clients/<client>.env`
4. `.env.clients/<client>.local.env`

Optional client selection:

Use `SENDLENS_CLIENT` when you want to load a client-specific env overlay.

Optional overrides:

```bash
export SENDLENS_CLIENTS_DIR=.env.clients
export SENDLENS_DB_PATH=/absolute/path/to/workspace-cache.duckdb
export SENDLENS_STATE_DIR=/absolute/path/to/sendlens-state
```

## What Gets Stored Locally

- DuckDB cache: `~/.sendlens/workspace-cache.duckdb`
- refresh status: `~/.sendlens/refresh-status.json`
- session-start log: `~/.sendlens/session-start-refresh.log`

SendLens is local-first and read-only against Instantly.
