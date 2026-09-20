/**
 * g-relay — minimal streaming HTTP relay for Cloudflare Workers.
 *
 * Forwards requests to allowlisted Google hosts through Cloudflare's edge
 * network. Request and response bodies stream straight through (no
 * buffering), so Server-Sent Events and long uploads work end to end.
 *
 *   GET  /health                → liveness probe (no auth)
 *   ANY  /proxy?url=<encoded>   → relay to the target
 *   ANY  /proxy/<encoded>       → path mode (equivalent)
 *   ANY  + X-Target-URL header  → header mode (equivalent)
 *
 * Optional shared secret: set PROXY_KEY (wrangler secret put PROXY_KEY or
 * the dashboard Variables tab). Requests must then carry ?key=SECRET or
 * X-Proxy-Key: SECRET.
 */

// Targets are restricted to *.google.com. Extra exact hostnames can be
// granted via the EXTRA_HOSTS env var (comma-separated).
const ALLOWED_SUFFIX = ".google.com";

function hostAllowed(hostname, env) {
  const h = hostname.toLowerCase();
  if (h === "google.com" || h.endsWith(ALLOWED_SUFFIX)) return true;
  const extra = ((env && env.EXTRA_HOSTS) || "").toLowerCase();
  for (const name of extra.split(",")) {
    if (name.trim() === h) return true;
  }
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, streaming: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const proxyKey = (env && env.PROXY_KEY) || "";
    if (proxyKey) {
      const provided = url.searchParams.get("key") || request.headers.get("X-Proxy-Key") || "";
      if (provided !== proxyKey) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // Target: X-Target-URL header, then /proxy/<encoded> path, then ?url=.
    let targetUrl = request.headers.get("X-Target-URL");
    if (!targetUrl) {
      // Only treat as path-encoded when something follows /proxy/ — with
      // query mode (?url=<target>) the pathname is a bare /proxy and must
      // not become the target.
      const encoded = url.pathname.startsWith("/proxy/")
        ? url.pathname.slice("/proxy/".length)
        : "";
      if (encoded) {
        // Some URL encoders emit "+" for spaces — normalize before
        // decoding, or a "+" in the target silently becomes a space.
        targetUrl = decodeURIComponent(encoded.replace(/\+/g, "%20"));
      }
    }
    if (!targetUrl) {
      targetUrl = url.searchParams.get("url");
    }
    if (!targetUrl) {
      return new Response(
        "Missing target URL. Use X-Target-URL header, /proxy/<url> path, or ?url= parameter.",
        { status: 400 }
      );
    }

    let targetParsed;
    try {
      targetParsed = new URL(targetUrl);
    } catch {
      return new Response("Invalid target URL", { status: 400 });
    }
    if (targetParsed.protocol !== "https:" && targetParsed.protocol !== "http:") {
      return new Response("Only http(s) targets are supported", { status: 400 });
    }

    if (!hostAllowed(targetParsed.hostname, env)) {
      return new Response(`Host ${targetParsed.hostname} not allowed`, { status: 403 });
    }

    // Copy request headers, dropping hop-by-hop and client-identity
    // headers — the target sees the Worker's egress, not the caller.
    const forwardHeaders = new Headers();
    for (const [key, value] of request.headers) {
      const lk = key.toLowerCase();
      if (lk === "x-target-url" || lk === "x-proxy-key" ||
          lk === "cf-connecting-ip" || lk === "cf-ipcountry" ||
          lk === "cf-ray" || lk === "cf-visitor" ||
          lk === "x-forwarded-for" || lk === "x-real-ip" ||
          lk === "host" || lk === "connection" || lk === "proxy-connection") {
        continue;
      }
      forwardHeaders.set(key, value);
    }
    forwardHeaders.set("Host", targetParsed.hostname);

    const fetchOptions = {
      method: request.method,
      headers: forwardHeaders,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      fetchOptions.body = request.body;
    }

    try {
      const resp = await fetch(targetUrl, fetchOptions);

      const respHeaders = new Headers();
      for (const [key, value] of resp.headers) {
        const lk = key.toLowerCase();
        if (lk === "transfer-encoding" || lk === "connection") {
          continue;
        }
        respHeaders.set(key, value);
      }

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
