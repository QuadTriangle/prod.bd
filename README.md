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
prodbd 3000

# Expose multiple ports
prodbd 3000 8080 5173
```

You'll get URLs like:
```
http://localhost:3000  ->  https://abc12345.prod.bd
http://localhost:8080  ->  https://def67890.prod.bd
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
cd cli && go build -o prodbd ./cmd/prodbd
```

## License

MIT - see [LICENSE](LICENSE)
