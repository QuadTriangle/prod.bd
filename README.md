# prod.bd

Secure HTTP tunnels to localhost. Expose your local development servers to the internet with a single command.

## Features

- 🚀 **Instant tunnels** - Get a public URL in seconds
- 🔒 **Secure** - End-to-end encrypted WebSocket connections
- 🎯 **Deterministic URLs** - Same subdomain for the same client+port
- ⚡ **Fast** - Built on Cloudflare Workers and Durable Objects
- 🆓 **Open Source** - MIT licensed

## Quick Start

### Install CLI

```bash
# macOS/Linux
curl -sSL https://prod.bd/install.sh | sh

# windows
irm https://prod.bd/install.ps1 | iex


# Or download from releases
# https://github.com/quadtriangle/prod.bd/releases
```

### Expose Local Ports

```bash
# Expose a single port
prod 3000

# Expose multiple ports
prod 3000 8080 5173
```

You'll get URLs like:
```
http://localhost:3000  ->  https://abc.prod.bd
http://localhost:8080  ->  https://xyz.prod.bd
```

## Development

```bash
# Install dependencies
pnpm install

# Start worker (local dev)
cd worker && pnpm dev

# Start web (landing page)
cd web && pnpm dev

# Build CLI
cd cli && go build -o prod ./cmd/prod
```

# Feature Roadmap

## Tunnel POC

- [x] Basic tunnel - expose a local HTTP server to a public URL through a worker
- [x] Websocket support - forward WebSocket connections through the tunnel to enable real-time features (e.g., React live reload, chat)

## Infrastructure

- [x] Plugin system — implement features without adding complexity to the core tunnel

## Reliability & DX

- [x] Request logging/inspector — live feed of requests (method, path, status, latency)
- [ ] Custom subdomains — `prod --subdomain myapp 3000` to pick your own subdomain
- [ ] Basic auth protection — `prod --auth user:pass 3000` to add HTTP basic auth at the worker level

## Performance & Resilience

- [ ] Connection health TUI — per-tunnel status, uptime, and request count using bubbletea
- [ ] Request queuing/buffering — buffer requests at the worker during brief CLI disconnects instead of 502
- [ ] Compression — gzip/deflate support for tunnel WebSocket messages

## Security

- [ ] Tunnel access tokens — token-based auth (`X-Tunnel-Token` header) to restrict tunnel access
- [ ] Rate limiting — per-subdomain rate limiting at the worker to prevent abuse
- [ ] IP allowlisting — `prod --allow-ip 1.2.3.4 3000` to restrict access by IP

## Collaboration & Sharing

- [ ] QR code generation — print a QR code in the terminal for the tunnel URL (mobile testing)
- [ ] Tunnel sharing with expiry — `prod --ttl 1h 3000` to auto-expire tunnels
- [ ] Team/org support — shared client IDs for consistent subdomains across machines

## Observability

- [ ] Webhook replay — store last N requests, replay from CLI (`prod replay <request-id>`)
- [x] Traffic stats — bytes transferred, request count, avg latency per tunnel session


## License

MIT - see [LICENSE](LICENSE)
