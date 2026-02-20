.PHONY: all setup stats cli build

all: setup build

setup:
	cd ./internal/plugins/stats/dashboard && pnpm install

stats:
	cd ./internal/plugins/stats/dashboard && pnpm run build

cli:
	go mod tidy
	go build -o prod ./cmd/prod

build: stats cli
