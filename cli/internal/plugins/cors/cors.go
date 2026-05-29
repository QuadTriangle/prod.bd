package cors

import (
	"flag"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
)

type plugin struct {
	origins *string
}

func New() hooks.Plugin {
	return &plugin{}
}

func (p *plugin) Name() string { return "cors" }

func (p *plugin) RegisterFlags(fs *flag.FlagSet) {
	p.origins = fs.String("cors", "", "Allowed CORS origins (comma-separated, or \"*\" for all)")
}

func (p *plugin) Enabled() bool { return p.origins != nil && *p.origins != "" }

func (p *plugin) WorkerConfig() map[string]any {
	return map[string]any{"cors": *p.origins}
}

func (p *plugin) RequestHooks() []hooks.RequestHook       { return nil }
func (p *plugin) ConnectionHooks() []hooks.ConnectionHook { return nil }
func (p *plugin) WSHooks() []hooks.WSHook                 { return nil }
func (p *plugin) ProxyHooks() []hooks.ProxyHook           { return nil }
func (p *plugin) ExtraPorts() []int                       { return nil }
