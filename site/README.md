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
- `sendlens.orchidlabs.dev/install.sh` redirects to the latest GitHub Release installer when the domain is attached to this Vercel project

The waitlist form writes submissions to Vercel Blob.
