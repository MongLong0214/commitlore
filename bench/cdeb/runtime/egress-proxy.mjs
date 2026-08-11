#!/usr/bin/env node
/**
 * CDEB-03 provider-only egress proxy (PRD §7.4). Plain ESM, no dependencies —
 * it is copied into the pinned runtime image and runs under that image's
 * node, so its version is pinned by the image digest.
 *
 * The agent container sits on an internal network with no external route; the
 * only way out is this proxy, and this proxy only answers CONNECT, only to
 * the frozen provider hosts, only on the frozen port. Everything else gets a
 * 403 and a one-line JSON audit record. Bytes of an allowed connection are
 * piped untouched — no TLS interception, no inspection, no rewriting.
 *
 * Configuration is environment-only, set by the pinned runtime:
 *   CDEB_ALLOWED_HOSTS  comma-separated host allowlist
 *   CDEB_ALLOWED_PORT   single allowed port (default 443)
 *   CDEB_LISTEN_PORT    proxy listen port (default 3128)
 *
 * The decision core (`parseConnectTarget`, `decideEgress`) is exported pure
 * so the allowlist logic is testable without a socket; the listener starts
 * only when this file is the entry point.
 */

import net from "node:net";
import { fileURLToPath } from "node:url";

/** Splits a CONNECT target into host and port; malformed means refused. */
export const parseConnectTarget = (target) => {
  if (typeof target !== "string" || target === "") return null;
  const colon = target.lastIndexOf(":");
  if (colon === -1) return { host: target.toLowerCase(), port: 443 };
  const host = target.slice(0, colon).toLowerCase();
  const port = Number(target.slice(colon + 1));
  if (host === "" || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
};

/**
 * The allowlist decision. `allowed-method` is the only method; `allowed-host`
 * is the only criterion. Returns the audit decision string.
 */
export const decideEgress = (method, target, allowedHosts, allowedPort) => {
  if (method !== "CONNECT") return "refused-method";
  const parsed = parseConnectTarget(target);
  if (parsed === null) return "refused-target";
  if (!allowedHosts.has(parsed.host) || parsed.port !== allowedPort) return "refused-target";
  return "allowed";
};

const audit = (decision, target) => {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), decision, target })}\n`,
  );
};

const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const allowedHosts = new Set(
    (process.env.CDEB_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== ""),
  );
  const allowedPort = Number(process.env.CDEB_ALLOWED_PORT ?? "443");
  const listenPort = Number(process.env.CDEB_LISTEN_PORT ?? "3128");

  if (allowedHosts.size === 0) {
    // An empty allowlist is not "allow nothing silently" — it is a
    // misconfiguration, and failing to start is the loudest available refusal.
    process.stderr.write("cdeb-egress: CDEB_ALLOWED_HOSTS is empty; refusing to start\n");
    process.exit(1);
  }

  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    const onError = () => client.destroy();
    client.on("error", onError);

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffer.length > 16 * 1024) client.destroy();
        return;
      }
      client.removeListener("data", onData);
      const header = buffer.subarray(0, end).toString("utf8");
      const rest = buffer.subarray(end + 4);
      buffer = Buffer.alloc(0);

      const [requestLine] = header.split("\r\n");
      const parts = (requestLine ?? "").split(" ");
      const target = parts.length >= 2 ? (parts[1] ?? "") : "";
      const decision = decideEgress(parts[0] ?? "", target, allowedHosts, allowedPort);

      if (decision !== "allowed") {
        audit(decision, requestLine ?? "");
        const status = decision === "refused-method" ? "405 Method Not Allowed" : "403 Forbidden";
        client.write(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\n\r\n`);
        client.destroy();
        return;
      }

      audit("allowed", target);
      const parsed = parseConnectTarget(target);
      const upstream = net.connect(parsed.port, parsed.host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (rest.length > 0) upstream.write(rest);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => {
        audit("upstream-error", target);
        client.destroy();
      });
    };
    client.on("data", onData);
  });

  server.listen(listenPort, "0.0.0.0", () => {
    audit("listening", `0.0.0.0:${String(listenPort)}`);
  });
}
