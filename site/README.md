# SendLens Site

This is the public landing page for SendLens.

It is intentionally kept inside the `sendlens-plugin` repo so the full
open-source surface lives in one place:

- `plugin/` for the host-native MCP/plugin runtime
- `site/` for the marketing site, waitlist, and install funnel

## Local Development

From the repo root:

```bash
npm run site:install
npm run site:dev
```

Or directly:

```bash
cd site
npm install
npm run dev
```

## Production

The live site is deployed on Vercel and currently serves:

- `sendlens.app`
- `app.sendlens.app`
- `sendlens.app/install.sh` redirects to the latest GitHub Release installer

The waitlist form writes submissions to Vercel Blob.

## Waitlist Privacy Boundary

The waitlist endpoint stores the fields submitted in the form plus a minimized
request context used only for abuse investigation. It does not store raw IP
addresses or raw user agents. Instead, it stores a short one-way hash derived
from a coarse network scope and browser family, plus the browser family label.

Waitlist request context should be deleted within 90 days unless it is needed
for an active security or abuse investigation. The waitlist storage token must
remain server-only as `BLOB_READ_WRITE_TOKEN`; do not expose it through a
`NEXT_PUBLIC_` variable or client bundle.
