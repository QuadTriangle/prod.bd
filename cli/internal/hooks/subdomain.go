package hooks

import (
	"flag"
	"strconv"
	"strings"
)

type subdomainPlugin struct {
	subdomain *string
}

func NewSubdomain() Plugin {
	return &subdomainPlugin{}
}

func (p *subdomainPlugin) Name() string { return "subdomain" }

func (p *subdomainPlugin) RegisterFlags(fs *flag.FlagSet) {
	p.subdomain = fs.String("subdomain", "", "Custom subdomain mapping (e.g. myapp or api:3000,web:5173)")
}

func (p *subdomainPlugin) Enabled() bool { return p.subdomain != nil && *p.subdomain != "" }

func (p *subdomainPlugin) WorkerConfig() map[string]any {
	// Parse "name:port,name:port" or just "name" (applies to all ports)
	mapping := map[string]int{}
	global := ""

	for _, part := range strings.Split(*p.subdomain, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if idx := strings.LastIndex(part, ":"); idx > 0 {
			name := part[:idx]
			port, err := strconv.Atoi(part[idx+1:])
			if err == nil {
				mapping[name] = port
				continue
			}
		}
		// No port specified — global subdomain for single-port usage
		global = part
	}

	if len(mapping) > 0 {
		// Convert to port->name map for the worker
		portMap := map[string]string{}
		for name, port := range mapping {
			portMap[strconv.Itoa(port)] = name
		}
		return map[string]any{"subdomains": portMap}
	}

	return map[string]any{"subdomain": global}
}

func (p *subdomainPlugin) RequestHooks() []RequestHook       { return nil }
func (p *subdomainPlugin) ConnectionHooks() []ConnectionHook { return nil }
func (p *subdomainPlugin) WSHooks() []WSHook                 { return nil }
func (p *subdomainPlugin) ProxyHooks() []ProxyHook           { return nil }
func (p *subdomainPlugin) ExtraPorts() []int                 { return nil }
