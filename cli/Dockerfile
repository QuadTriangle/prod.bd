# Stage 1: Build the Go application
FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -ldflags '-extldflags "-static"' -o prod ./cmd/prod

# Stage 2: Minimal runtime image
FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder /app/prod /prod

# Signal the CLI to use host.docker.internal instead of localhost
ENV NET_HOST=false

ENTRYPOINT ["/prod"]
