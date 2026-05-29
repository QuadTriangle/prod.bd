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
powershell -c "irm https://prod.bd/install.ps1 | iex"


# Or download from releases
# https://github.com/quadtriangle/prod.bd/releases
```

### Docker

```bash
# Linux (uses host networking, localhost works directly)
docker run --rm -it -e NET_HOST="true" --net=host ghcr.io/quadtriangle/prod.bd:latest 3000 8080

# Windows / macOS (Docker Desktop routes to host)
docker run --rm -it ghcr.io/quadtriangle/prod.bd:latest 3000 8080
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

## License

MIT - see [LICENSE](LICENSE)
