package stats

import (
	"encoding/base64"
	"flag"
	"log"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
	"github.com/QuadTriangle/prod.bd/cli/internal/types"
)

// goroutineID returns the current goroutine's ID.
// Used to correlate OnRequest (has subdomain) with BeforeProxy (has request ID)
// within the same goroutine in handleMessage.
func goroutineID() uint64 {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	// "goroutine 123 [..."
	s := strings.TrimPrefix(string(buf[:n]), "goroutine ")
	s = s[:strings.IndexByte(s, ' ')]
	id, _ := strconv.ParseUint(s, 10, 64)
	return id
}

// RequestEntry is a single logged request/response pair held in memory.
type RequestEntry struct {
	ID              int
	Subdomain       string
	Method          string
	Path            string
	Status          int
	Latency         time.Duration
	BytesIn         int
	BytesOut        int
	Timestamp       time.Time
	RequestHeaders  map[string][]string
	RequestBody     string
	ResponseHeaders map[string][]string
	ResponseBody    string
}

// TunnelStats holds aggregate stats for one tunnel.
type TunnelStats struct {
	Subdomain     string
	Port          int
	TotalRequests int
	ErrorCount    int
	TotalBytesIn  int
	TotalBytesOut int
	TotalLatency  time.Duration
	MaxLatency    time.Duration
	MinLatency    time.Duration
	ConnectedAt   time.Time
}

// Store is the in-memory stats store. Safe for concurrent use.
type Store struct {
	mu          sync.RWMutex
	tunnels     map[string]*TunnelStats // keyed by subdomain
	tunnelOrder []string                // insertion order for stable iteration
	logs        []RequestEntry          // ring buffer
	maxLogs     int
	nextID      int
	// lastSubdomain tracks the most recent subdomain from OnRequest
	// so AfterProxy can associate the request with the right tunnel.
	// Keyed by goroutine-safe request flow: OnRequest sets it, BeforeProxy reads it.
	pendingSubdomain sync.Map // request-ID -> subdomain
}

func NewStore(maxLogs int) *Store {
	return &Store{
		tunnels: make(map[string]*TunnelStats),
		maxLogs: maxLogs,
	}
}

// SetPendingSubdomain is called from OnRequest (which has the subdomain)
// right before BeforeProxy, so the reqHook can pick it up.
func (s *Store) SetPendingSubdomain(subdomain string) {
	// Use a counter-based key isn't feasible since OnRequest doesn't know the request ID yet.
	// Instead we use a channel-like approach: store the subdomain, BeforeProxy consumes it.
	// This works because handleMessage calls NotifyRequest then RunBeforeProxy sequentially
	// within the same goroutine.
	s.pendingSubdomain.Store(goroutineID(), subdomain)
}

// ConsumePendingSubdomain retrieves and removes the subdomain set by OnRequest.
func (s *Store) ConsumePendingSubdomain() string {
	if v, ok := s.pendingSubdomain.LoadAndDelete(goroutineID()); ok {
		return v.(string)
	}
	return ""
}

func (s *Store) RecordConnect(subdomain string, port int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tunnels[subdomain] = &TunnelStats{
		Subdomain:   subdomain,
		Port:        port,
		MinLatency:  time.Duration(1<<63 - 1), // max duration sentinel
		ConnectedAt: time.Now(),
	}
	s.tunnelOrder = append(s.tunnelOrder, subdomain)
}

func (s *Store) RecordDisconnect(subdomain string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tunnels, subdomain)
	// Remove from order slice
	for i, sd := range s.tunnelOrder {
		if sd == subdomain {
			s.tunnelOrder = append(s.tunnelOrder[:i], s.tunnelOrder[i+1:]...)
			break
		}
	}
}

func (s *Store) RecordRequest(subdomain string, req types.TunnelRequest, resp types.TunnelResponse, latency time.Duration) {
	bytesIn := len(req.Body)
	if req.Body != "" {
		if decoded, err := base64.StdEncoding.DecodeString(req.Body); err == nil {
			bytesIn = len(decoded)
		}
	}
	bytesOut := len(resp.Body)
	if resp.Body != "" {
		if decoded, err := base64.StdEncoding.DecodeString(resp.Body); err == nil {
			bytesOut = len(decoded)
		}
	}

	// Decode bodies for storage (cap at 64KB to avoid memory bloat)
	var reqBody, respBody string
	if req.Body != "" {
		if decoded, err := base64.StdEncoding.DecodeString(req.Body); err == nil && len(decoded) < 64_000 {
			reqBody = string(decoded)
		}
	}
	if resp.Body != "" {
		if decoded, err := base64.StdEncoding.DecodeString(resp.Body); err == nil && len(decoded) < 64_000 {
			respBody = string(decoded)
		}
	}

	entry := RequestEntry{
		Subdomain:       subdomain,
		Method:          req.Method,
		Path:            req.Path,
		Status:          resp.Status,
		Latency:         latency,
		BytesIn:         bytesIn,
		BytesOut:        bytesOut,
		Timestamp:       time.Now(),
		RequestHeaders:  req.Headers,
		RequestBody:     reqBody,
		ResponseHeaders: resp.Headers,
		ResponseBody:    respBody,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextID++
	entry.ID = s.nextID

	// Ring buffer: keep last maxLogs entries
	if len(s.logs) >= s.maxLogs {
		s.logs = append(s.logs[1:], entry)
	} else {
		s.logs = append(s.logs, entry)
	}

	if ts, ok := s.tunnels[subdomain]; ok {
		ts.TotalRequests++
		ts.TotalBytesIn += bytesIn
		ts.TotalBytesOut += bytesOut
		ts.TotalLatency += latency
		if latency > ts.MaxLatency {
			ts.MaxLatency = latency
		}
		if latency < ts.MinLatency {
			ts.MinLatency = latency
		}
		if resp.Status >= 400 {
			ts.ErrorCount++
		}
	}
}

// Snapshot returns a copy of all tunnel stats in stable insertion order.
func (s *Store) Snapshot() []TunnelStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]TunnelStats, 0, len(s.tunnelOrder))
	for _, sd := range s.tunnelOrder {
		if ts, ok := s.tunnels[sd]; ok {
			cp := *ts
			out = append(out, cp)
		}
	}
	return out
}

// RecentLogs returns the last n request entries.
func (s *Store) RecentLogs(n int) []RequestEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if n > len(s.logs) {
		n = len(s.logs)
	}
	out := make([]RequestEntry, n)
	copy(out, s.logs[len(s.logs)-n:])
	return out
}

// --- Plugin wiring ---

// Plugin implements hooks.Plugin for in-memory stats collection.
// Controlled by a single -dashboard flag: port > 0 enables stats + dashboard, 0 disables everything.
type Plugin struct {
	dashboardPort int
	store         *Store
	server        *Server
}

func New() *Plugin {
	return &Plugin{
		store: NewStore(1000),
	}
}

func (p *Plugin) Name() string { return "stats" }
func (p *Plugin) RegisterFlags(fs *flag.FlagSet) {
	fs.IntVar(&p.dashboardPort, "dashboard-port", 9999, "Stats dashboard port (0 to disable stats entirely)")
}
func (p *Plugin) Enabled() bool                { return p.dashboardPort > 0 }
func (p *Plugin) WorkerConfig() map[string]any { return nil }
func (p *Plugin) RequestHooks() []hooks.RequestHook {
	return []hooks.RequestHook{&reqHook{store: p.store}}
}
func (p *Plugin) ConnectionHooks() []hooks.ConnectionHook {
	return []hooks.ConnectionHook{&connHook{store: p.store, plugin: p}}
}

// Store returns the underlying store for external consumers (TUI, subcommands).
func (p *Plugin) Store() *Store { return p.store }

// startDashboard starts the local HTTP server for the dashboard on first connect.
func (p *Plugin) startDashboard() {
	if p.dashboardPort == 0 || p.server != nil {
		return
	}
	srv, err := StartServer(p.store, p.dashboardPort)
	if err != nil {
		log.Printf("[stats] failed to start dashboard server: %v", err)
		return
	}
	p.server = srv
	log.Printf("[stats] dashboard API listening on http://%s", srv.Addr())
}

// --- Hooks ---

type reqHook struct {
	hooks.NoOpRequestHook
	store *Store
	// Per-request tracking: start time + subdomain, keyed by request ID
	pending sync.Map // req.ID -> reqMeta
}

type reqMeta struct {
	start     time.Time
	subdomain string
}

func (h *reqHook) BeforeProxy(req types.TunnelRequest) types.TunnelRequest {
	// Consume the subdomain that OnRequest stashed for this goroutine
	subdomain := h.store.ConsumePendingSubdomain()
	h.pending.Store(req.ID, reqMeta{start: time.Now(), subdomain: subdomain})
	return req
}

func (h *reqHook) AfterProxy(req types.TunnelRequest, resp types.TunnelResponse) types.TunnelResponse {
	var latency time.Duration
	subdomain := ""
	if v, ok := h.pending.LoadAndDelete(req.ID); ok {
		meta := v.(reqMeta)
		latency = time.Since(meta.start)
		subdomain = meta.subdomain
	}

	h.store.RecordRequest(subdomain, req, resp, latency)

	return resp
}

type connHook struct {
	hooks.NoOpConnectionHook
	store  *Store
	plugin *Plugin
}

func (h *connHook) OnConnect(subdomain string, port int) {
	h.store.RecordConnect(subdomain, port)
	h.plugin.startDashboard()
}

func (h *connHook) OnDisconnect(subdomain string, err error) {
	h.store.RecordDisconnect(subdomain)
}

func (h *connHook) OnRequest(subdomain string) {
	// Stash subdomain for the reqHook.BeforeProxy call that follows
	// in the same goroutine (handleMessage calls NotifyRequest → RunBeforeProxy sequentially)
	h.store.SetPendingSubdomain(subdomain)
}
