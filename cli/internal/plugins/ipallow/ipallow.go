package ipallow

import (
	"flag"
	"strings"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
)

type plugin struct {
	allowIPs *string
}

func New() hooks.Plugin {
	return &plugin{}
}

func (p *plugin) Name() string { return "ipallow" }

func (p *plugin) RegisterFlags(fs *flag.FlagSet) {
	p.allowIPs = fs.String("allow-ip", "", "Comma-separated list of allowed IPs or CIDRs (e.g. 1.2.3.4,10.0.0.0/8)")
}

func (p *plugin) Enabled() bool { return p.allowIPs != nil && *p.allowIPs != "" }

func (p *plugin) WorkerConfig() map[string]any {
	parts := strings.Split(*p.allowIPs, ",")
	ips := make([]string, 0, len(parts))
	for _, s := range parts {
		s = strings.TrimSpace(s)
		if s != "" {
			ips = append(ips, s)
		}
	}
	return map[string]any{"allowIps": ips}
}

func (p *plugin) RequestHooks() []hooks.RequestHook       { return nil }
func (p *plugin) ConnectionHooks() []hooks.ConnectionHook { return nil }
