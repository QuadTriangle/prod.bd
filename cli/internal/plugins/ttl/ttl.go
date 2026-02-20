package ttl

import (
	"flag"
	"log"
	"os"
	"sync"
	"syscall"
	"time"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
)

type plugin struct {
	ttl      *string
	duration time.Duration
	once     sync.Once
}

func New() hooks.Plugin {
	return &plugin{}
}

func (p *plugin) Name() string { return "ttl" }

func (p *plugin) RegisterFlags(fs *flag.FlagSet) {
	p.ttl = fs.String("ttl", "", "Tunnel expiry duration (e.g. 1h, 30m, 24h)")
}

func (p *plugin) Enabled() bool {
	if p.ttl == nil || *p.ttl == "" {
		return false
	}
	d, err := time.ParseDuration(*p.ttl)
	if err != nil || d <= 0 {
		return false
	}
	p.duration = d
	return true
}

func (p *plugin) WorkerConfig() map[string]any                { return nil }
func (p *plugin) RequestHooks() []hooks.RequestHook           { return nil }
func (p *plugin) ConnectionHooks() []hooks.ConnectionHook     { return []hooks.ConnectionHook{p} }
func (p *plugin) WSHooks() []hooks.WSHook                     { return nil }
func (p *plugin) ProxyHooks() []hooks.ProxyHook               { return nil }
func (p *plugin) ExtraPorts() []int                           { return nil }

func (p *plugin) OnConnect(_ string, _ int) {
	p.once.Do(func() {
		log.Printf("Tunnel will expire in %s", p.duration)
		go func() {
			time.Sleep(p.duration)
			log.Printf("TTL expired after %s, shutting down...", p.duration)
			proc, _ := os.FindProcess(os.Getpid())
			proc.Signal(syscall.SIGINT)
		}()
	})
}

func (p *plugin) OnDisconnect(_ string, _ error) {}
func (p *plugin) OnRequest(_ string)             {}
