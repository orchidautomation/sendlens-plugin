import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function findPackageJson(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackageVersion(): string {
  const packageJsonPath = findPackageJson(__dirname);
  if (packageJsonPath) {
    try {
      const raw = readFileSync(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      // unreadable — fall through to fallback
    }
  }
  return "0.0.0-unknown";
}

export const PLUGIN_VERSION: string = readPackageVersion();
