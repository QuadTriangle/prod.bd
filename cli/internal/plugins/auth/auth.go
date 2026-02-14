package auth

import (
	"flag"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
)

type plugin struct {
	auth *string
}

func New() hooks.Plugin {
	return &plugin{}
}

func (p *plugin) Name() string { return "auth" }

func (p *plugin) RegisterFlags(fs *flag.FlagSet) {
	p.auth = fs.String("auth", "", "Basic auth credentials (user:pass). Stored as plaintext.")
}

func (p *plugin) Enabled() bool { return p.auth != nil && *p.auth != "" }

func (p *plugin) WorkerConfig() map[string]any {
	return map[string]any{"auth": *p.auth}
}

func (p *plugin) RequestHooks() []hooks.RequestHook       { return nil }
func (p *plugin) ConnectionHooks() []hooks.ConnectionHook { return nil }
