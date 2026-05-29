package hostheader

import (
	"flag"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
	"github.com/QuadTriangle/prod.bd/cli/internal/types"
)

type plugin struct {
	host *string
}

func New() hooks.Plugin {
	return &plugin{}
}

func (p *plugin) Name() string { return "host-header" }

func (p *plugin) RegisterFlags(fs *flag.FlagSet) {
	p.host = fs.String("host-header", "", "Override Host header sent to upstream (default: original request host)")
}

func (p *plugin) Enabled() bool { return p.host != nil && *p.host != "" }

func (p *plugin) WorkerConfig() map[string]any                { return nil }
func (p *plugin) ConnectionHooks() []hooks.ConnectionHook     { return nil }
func (p *plugin) WSHooks() []hooks.WSHook                     { return nil }
func (p *plugin) ProxyHooks() []hooks.ProxyHook               { return nil }
func (p *plugin) ExtraPorts() []int                           { return nil }
func (p *plugin) RequestHooks() []hooks.RequestHook {
	return []hooks.RequestHook{&hostHook{host: *p.host}}
}

type hostHook struct {
	hooks.NoOpRequestHook
	host string
}

func (h *hostHook) BeforeProxy(req types.TunnelRequest) types.TunnelRequest {
	if req.Headers == nil {
		req.Headers = make(map[string][]string)
	}
	req.Headers["Host"] = []string{h.host}
	return req
}
