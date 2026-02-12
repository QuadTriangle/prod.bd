package hooks

import (
	"flag"
	"prodbd/internal/types"
)

// --- Hook interfaces (unchanged) ---

// RequestHook intercepts HTTP requests/responses flowing through the tunnel.
type RequestHook interface {
	BeforeProxy(req types.TunnelRequest) types.TunnelRequest
	AfterProxy(req types.TunnelRequest, resp types.TunnelResponse) types.TunnelResponse
}

// ConnectionHook observes tunnel lifecycle events.
type ConnectionHook interface {
	OnConnect(subdomain string, port int)
	OnDisconnect(subdomain string, err error)
	OnRequest(subdomain string)
}

// NoOpRequestHook is a convenience embed for hooks that only need one method.
type NoOpRequestHook struct{}

func (NoOpRequestHook) BeforeProxy(req types.TunnelRequest) types.TunnelRequest { return req }
func (NoOpRequestHook) AfterProxy(_ types.TunnelRequest, resp types.TunnelResponse) types.TunnelResponse {
	return resp
}

// NoOpConnectionHook is a convenience embed for hooks that only need one method.
type NoOpConnectionHook struct{}

func (NoOpConnectionHook) OnConnect(_ string, _ int)      {}
func (NoOpConnectionHook) OnDisconnect(_ string, _ error) {}
func (NoOpConnectionHook) OnRequest(_ string)             {}

// --- Plugin interface ---

// Plugin is the self-contained unit of optional functionality.
// Each plugin registers its own CLI flags, decides if it's active,
// contributes config to send to the worker, and provides hooks.
type Plugin interface {
	// Name returns a short identifier (e.g. "inspector", "auth").
	Name() string
	// RegisterFlags is called before flag.Parse() — add your flags here.
	RegisterFlags(fs *flag.FlagSet)
	// Enabled returns true if the plugin should activate (check your flags).
	Enabled() bool
	// WorkerConfig returns key-value pairs to merge into the tunnel config
	// sent to the worker during registration. Return nil if nothing to send.
	WorkerConfig() map[string]any
	// RequestHooks returns request hooks to add to the pipeline, or nil.
	RequestHooks() []RequestHook
	// ConnectionHooks returns connection hooks to add to the pipeline, or nil.
	ConnectionHooks() []ConnectionHook
}

// --- Pipeline ---

// Pipeline runs registered hooks in order. Zero-value is ready to use.
type Pipeline struct {
	plugins   []Plugin
	reqHooks  []RequestHook
	connHooks []ConnectionHook
}

// RegisterPlugin adds a plugin. Call before flag.Parse().
func (p *Pipeline) RegisterPlugin(pl Plugin) {
	p.plugins = append(p.plugins, pl)
}

// RegisterFlags calls RegisterFlags on all plugins.
func (p *Pipeline) RegisterFlags(fs *flag.FlagSet) {
	for _, pl := range p.plugins {
		pl.RegisterFlags(fs)
	}
}

// Activate checks which plugins are enabled after flag.Parse(),
// and collects their hooks into the pipeline.
func (p *Pipeline) Activate() {
	for _, pl := range p.plugins {
		if !pl.Enabled() {
			continue
		}
		for _, h := range pl.RequestHooks() {
			p.reqHooks = append(p.reqHooks, h)
		}
		for _, h := range pl.ConnectionHooks() {
			p.connHooks = append(p.connHooks, h)
		}
	}
}

// WorkerConfig merges config from all enabled plugins into a single map.
func (p *Pipeline) WorkerConfig() map[string]any {
	merged := map[string]any{}
	for _, pl := range p.plugins {
		if !pl.Enabled() {
			continue
		}
		for k, v := range pl.WorkerConfig() {
			merged[k] = v
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

func (p *Pipeline) AddRequestHook(h RequestHook)       { p.reqHooks = append(p.reqHooks, h) }
func (p *Pipeline) AddConnectionHook(h ConnectionHook) { p.connHooks = append(p.connHooks, h) }

func (p *Pipeline) RunBeforeProxy(req types.TunnelRequest) types.TunnelRequest {
	for _, h := range p.reqHooks {
		req = h.BeforeProxy(req)
	}
	return req
}

func (p *Pipeline) RunAfterProxy(req types.TunnelRequest, resp types.TunnelResponse) types.TunnelResponse {
	for _, h := range p.reqHooks {
		resp = h.AfterProxy(req, resp)
	}
	return resp
}

func (p *Pipeline) NotifyConnect(subdomain string, port int) {
	for _, h := range p.connHooks {
		h.OnConnect(subdomain, port)
	}
}

func (p *Pipeline) NotifyDisconnect(subdomain string, err error) {
	for _, h := range p.connHooks {
		h.OnDisconnect(subdomain, err)
	}
}

func (p *Pipeline) NotifyRequest(subdomain string) {
	for _, h := range p.connHooks {
		h.OnRequest(subdomain)
	}
}
