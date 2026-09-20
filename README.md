# g-relay

Minimal streaming HTTP relay for [Cloudflare Workers](https://workers.cloudflare.com/).

Forwards requests to Google hosts through Cloudflare's edge network — each
deployed instance gets its own stable egress. Request and response bodies
stream straight through (no buffering), so Server-Sent Events and long-lived
connections work end to end.

A Railway-native twin with the same contract lives at
[g-relay-railway](https://github.com/Sexlovr/g-relay-railway) — running both
gives you relays across different egress pools.

## Deploy

Requires a free Cloudflare account (no credit card, no build step):

```bash
git clone https://github.com/<you>/g-relay.git
cd g-relay
npx wrangler login
npx wrangler deploy
```

## Shared secret (recommended)

Without a secret, anyone who finds your URL can use your relay (within the
host restrictions below):

```bash
npx wrangler secret put PROXY_KEY
```

Requests must then carry `?key=SECRET` or `X-Proxy-Key: SECRET`.

## Routes

| Route | Description |
|-------|-------------|
| `GET /health` | Liveness probe → `{"ok":true,"streaming":true}` |
| `ANY /proxy?url=<encoded-target>` | Relay to the target |
| `ANY /proxy/<encoded-target>` | Path mode (equivalent) |
| `X-Target-URL: <target>` header | Header mode (equivalent) |

## Allowed targets

Only `*.google.com` (and bare `google.com`). Anything else gets
`403 Host not allowed`.

Add extra exact hostnames via the `EXTRA_HOSTS` variable (comma-separated),
either in `wrangler.toml` or the dashboard Variables tab:

```toml
[vars]
EXTRA_HOSTS = "api.example.com,stats.example.com"
```
