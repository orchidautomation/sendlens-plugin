import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

const codexMcpPath = path.join(rootDir, "dist", "codex", ".mcp.json");

if (!fs.existsSync(codexMcpPath)) {
  console.warn("[sendlens] Codex MCP bundle not found; skipping host patch.");
  process.exit(0);
}

const raw = fs.readFileSync(codexMcpPath, "utf8");
const payload = JSON.parse(raw);

const server = payload?.mcpServers?.sendlens;
if (!server || !Array.isArray(server.args)) {
  console.warn("[sendlens] Codex MCP bundle shape was unexpected; skipping host patch.");
  process.exit(0);
}

server.args = server.args.map((value) =>
  value === "${CLAUDE_PLUGIN_ROOT}/scripts/start-mcp.sh"
    ? "./scripts/start-mcp.sh"
    : value,
);

fs.writeFileSync(codexMcpPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log("[sendlens] Patched Codex MCP bundle to use a relative stdio entrypoint.");
