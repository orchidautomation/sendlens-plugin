#!/usr/bin/env node

import http from "node:http";

const allowedHost = (process.env.SENDLENS_HTTP_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim())
  .find(Boolean);

if (!allowedHost) process.exit(1);

const bindHost = (process.env.SENDLENS_HTTP_HOST || "0.0.0.0").trim();
const probeHost = bindHost === "0.0.0.0"
  ? "127.0.0.1"
  : bindHost === "::" || bindHost === "[::]"
    ? "::1"
    : bindHost.replace(/^\[|\]$/g, "");

const request = http.get({
  hostname: probeHost,
  port: process.env.SENDLENS_HTTP_PORT || "3000",
  path: "/health",
  headers: { Host: allowedHost },
}, (response) => {
  response.resume();
  process.exit(response.statusCode != null && response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1);
});

request.on("error", () => process.exit(1));
