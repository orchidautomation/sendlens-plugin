import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('docs-site');
const configPath = path.join(root, 'docs.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const errors = [];

function flattenPages(nav) {
  const pages = [];
  for (const group of nav.groups ?? []) for (const page of group.pages ?? []) pages.push(page);
  return pages;
}

for (const page of flattenPages(config.navigation ?? {})) {
  const file = path.join(root, `${page}.mdx`);
  if (!fs.existsSync(file)) errors.push(`Missing navigation page: ${page}.mdx`);
}

const pages = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.mdx')) pages.push(full);
  }
}
walk(root);

const pageSet = new Set(pages.map((p) => '/' + path.relative(root, p).replace(/\.mdx$/, '').replace(/\\/g, '/')));
const publicUnsafe = [/docs\/orchid/i, /\.agent-artifacts/i, /github\.com\/orchidautomation\/sendlens-plugin/i, /Linear/];
const secretValue = /(?:^|[^a-z])sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_]*API_KEY\s*=\s*['\"]?[A-Za-z0-9_-]{16,}|[?&](?:api_?key|token|access_token)=['\"]?[A-Za-z0-9._~-]{12,}/i;

for (const file of pages) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith('---\n')) errors.push(`${rel}: missing frontmatter`);
  for (const pattern of publicUnsafe) if (pattern.test(text)) errors.push(`${rel}: public-safety pattern matched ${pattern}`);
  if (secretValue.test(text)) errors.push(`${rel}: possible secret value`);
  const internalLinks = [];
  for (const match of text.matchAll(/(?<!!)\[[^\]]+\]\((\/[^)\s#]+)(#[^)\s]+)?\)/g)) {
    internalLinks.push({ target: match[1], raw: match[0] });
  }
  for (const match of text.matchAll(/\bhref\s*=\s*["'](\/[^"'\s#]+)(#[^"'\s]+)?["']/g)) {
    internalLinks.push({ target: match[1], raw: match[0] });
  }
  for (const { target: rawTarget, raw } of internalLinks) {
    const target = rawTarget.replace(/\/$/, '') || '/index';
    if (target.startsWith('/images/') || target.startsWith('/assets/') || target === '/favicon.svg') continue;
    if (!pageSet.has(target) && target !== '/') errors.push(`${rel}: broken internal link ${raw}`);
  }
}

for (const redirect of config.redirects ?? []) {
  const dest = redirect.destination.replace(/\/$/, '') || '/index';
  if (!pageSet.has(dest) && dest !== '/') errors.push(`Redirect ${redirect.source} points to missing ${redirect.destination}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`docs-site check passed (${pages.length} pages)`);
