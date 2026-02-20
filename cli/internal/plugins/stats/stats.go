package stats

import (
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
	"github.com/QuadTriangle/prod.bd/cli/internal/types"
)

// InterceptRule defines a rule that matches requests and applies modifications.
type InterceptRule struct {
	ID           int               `json:"id"`
	PathPattern  string            `json:"path_pattern"`             // regex to match request path
	Methods      []string          `json:"methods,omitempty"`        // empty = all methods
	Action       string            `json:"action"`                   // "modify-request", "modify-response", "pause", "mock"
	SetHeaders   map[string]string `json:"set_headers,omitempty"`    // headers to add/override
	SetStatus    int               `json:"set_status,omitempty"`     // override response status
	SetBody      string            `json:"set_body,omitempty"`       // override body
	AddLatencyMs int               `json:"add_latency_ms,omitempty"` // inject artificial latency (ms)
	Enabled      bool              `json:"enabled"`
	compiled     *regexp.Regexp
}

func (r *InterceptRule) matches(method, path string) bool {
	if !r.Enabled {
		return false
	}
	if len(r.Methods) > 0 {
		found := false
		for _, m := range r.Methods {
			if strings.EqualFold(m, method) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if r.compiled == nil {
		return false
	}
	return r.compiled.MatchString(path)
}

// goroutineID returns the current goroutine's ID.
func goroutineID() uint64 {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
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
	ContentType     string   // response content-type for quick display
	Tags            []string // user-defined tags
}

// SavedRequest is a named request template for the composer (like Postman collections).
type SavedRequest struct {
	ID       int      `json:"id"`
	Name     string   `json:"name"`
	Method   string   `json:"method"`
	Path     string   `json:"path"`
	Params   []KVPair `json:"params,omitempty"`  // query params
	Headers  []KVPair `json:"headers,omitempty"` // request headers
	BodyType string   `json:"body_type"`         // "none", "json", "form", "raw"
	Body     string   `json:"body,omitempty"`
	Created  int64    `json:"created"`
}

// KVPair is a key-value pair with an enabled toggle.
type KVPair struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
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
	mu               sync.RWMutex
	tunnels          map[string]*TunnelStats
	tunnelOrder      []string
	logs             []RequestEntry
	maxLogs          int
	nextID           int
	pendingSubdomain sync.Map // goroutine ID -> subdomain

	// Intercept rules
	interceptMu     sync.RWMutex
	intercepts      []InterceptRule
	nextInterceptID int

	// Pause support: paused requests wait on a channel for release
	pausedMu sync.Mutex
	paused   map[string]*PausedRequest

	// Saved requests (composer collections)
	savedMu     sync.RWMutex
	saved       []SavedRequest
	nextSavedID int
}

// PausedRequest holds a paused request with its data so the UI can display/edit it.
type PausedRequest struct {
	ReleaseCh chan *EditedRequest
	Request   types.TunnelRequest
	PausedAt  time.Time
}

// EditedRequest is sent back when resuming a paused request with modifications.
type EditedRequest struct {
	Method  string              `json:"method,omitempty"`
	Path    string              `json:"path,omitempty"`
	Headers map[string][]string `json:"headers,omitempty"`
	Body    string              `json:"body,omitempty"`
}

func NewStore(maxLogs int) *Store {
	return &Store{
		tunnels: make(map[string]*TunnelStats),
		maxLogs: maxLogs,
		paused:  make(map[string]*PausedRequest),
	}
}

// --- Intercept rule CRUD ---

func (s *Store) AddIntercept(rule InterceptRule) (InterceptRule, error) {
	compiled, err := regexp.Compile(rule.PathPattern)
	if err != nil {
		return InterceptRule{}, err
	}
	rule.compiled = compiled
	s.interceptMu.Lock()
	defer s.interceptMu.Unlock()
	s.nextInterceptID++
	rule.ID = s.nextInterceptID
	s.intercepts = append(s.intercepts, rule)
	return rule, nil
}

func (s *Store) ListIntercepts() []InterceptRule {
	s.interceptMu.RLock()
	defer s.interceptMu.RUnlock()
	out := make([]InterceptRule, len(s.intercepts))
	copy(out, s.intercepts)
	return out
}

func (s *Store) UpdateIntercept(id int, rule InterceptRule) (InterceptRule, error) {
	compiled, err := regexp.Compile(rule.PathPattern)
	if err != nil {
		return InterceptRule{}, err
	}
	s.interceptMu.Lock()
	defer s.interceptMu.Unlock()
	for i := range s.intercepts {
		if s.intercepts[i].ID == id {
			rule.ID = id
			rule.compiled = compiled
			s.intercepts[i] = rule
			return rule, nil
		}
	}
	return InterceptRule{}, fmt.Errorf("rule %d not found", id)
}

func (s *Store) DeleteIntercept(id int) bool {
	s.interceptMu.Lock()
	defer s.interceptMu.Unlock()
	for i := range s.intercepts {
		if s.intercepts[i].ID == id {
			s.intercepts = append(s.intercepts[:i], s.intercepts[i+1:]...)
			return true
		}
	}
	return false
}

func (s *Store) MatchingIntercepts(method, path string) []InterceptRule {
	s.interceptMu.RLock()
	defer s.interceptMu.RUnlock()
	var out []InterceptRule
	for _, r := range s.intercepts {
		if r.matches(method, path) {
			out = append(out, r)
		}
	}
	return out
}

// --- Pause support (enhanced: can edit before resume) ---

func (s *Store) PauseRequest(reqID string, req types.TunnelRequest) <-chan *EditedRequest {
	ch := make(chan *EditedRequest, 1)
	s.pausedMu.Lock()
	s.paused[reqID] = &PausedRequest{
		ReleaseCh: ch,
		Request:   req,
		PausedAt:  time.Now(),
	}
	s.pausedMu.Unlock()
	return ch
}

func (s *Store) ResumeRequest(reqID string, edits *EditedRequest) bool {
	s.pausedMu.Lock()
	pr, ok := s.paused[reqID]
	if ok {
		pr.ReleaseCh <- edits
		close(pr.ReleaseCh)
		delete(s.paused, reqID)
	}
	s.pausedMu.Unlock()
	return ok
}

func (s *Store) ListPaused() map[string]*PausedRequest {
	s.pausedMu.Lock()
	defer s.pausedMu.Unlock()
	out := make(map[string]*PausedRequest, len(s.paused))
	for id, pr := range s.paused {
		out[id] = pr
	}
	return out
}

// --- Saved requests CRUD ---

func (s *Store) AddSaved(sr SavedRequest) SavedRequest {
	s.savedMu.Lock()
	defer s.savedMu.Unlock()
	s.nextSavedID++
	sr.ID = s.nextSavedID
	sr.Created = time.Now().Unix()
	s.saved = append(s.saved, sr)
	return sr
}

func (s *Store) ListSaved() []SavedRequest {
	s.savedMu.RLock()
	defer s.savedMu.RUnlock()
	out := make([]SavedRequest, len(s.saved))
	copy(out, s.saved)
	return out
}

func (s *Store) UpdateSaved(id int, sr SavedRequest) (SavedRequest, bool) {
	s.savedMu.Lock()
	defer s.savedMu.Unlock()
	for i := range s.saved {
		if s.saved[i].ID == id {
			sr.ID = id
			sr.Created = s.saved[i].Created
			s.saved[i] = sr
			return sr, true
		}
	}
	return SavedRequest{}, false
}

func (s *Store) DeleteSaved(id int) bool {
	s.savedMu.Lock()
	defer s.savedMu.Unlock()
	for i := range s.saved {
		if s.saved[i].ID == id {
			s.saved = append(s.saved[:i], s.saved[i+1:]...)
			return true
		}
	}
	return false
}

// --- Subdomain tracking ---

func (s *Store) SetPendingSubdomain(subdomain string) {
	s.pendingSubdomain.Store(goroutineID(), subdomain)
}

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
		MinLatency:  time.Duration(1<<63 - 1),
		ConnectedAt: time.Now(),
	}
	s.tunnelOrder = append(s.tunnelOrder, subdomain)
}

func (s *Store) RecordDisconnect(subdomain string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tunnels, subdomain)
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

	// Extract content-type from response headers
	contentType := ""
	if resp.Headers != nil {
		for k, v := range resp.Headers {
			if strings.EqualFold(k, "content-type") && len(v) > 0 {
				contentType = v[0]
				break
			}
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
		ContentType:     contentType,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextID++
	entry.ID = s.nextID

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

func (s *Store) GetByID(id int) *RequestEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := range s.logs {
		if s.logs[i].ID == id {
			cp := s.logs[i]
			return &cp
		}
	}
	return nil
}

// ClearLogs removes all request log entries and resets the ID counter.
func (s *Store) ClearLogs() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logs = nil
	s.nextID = 0
}

// SearchLogs searches request/response bodies and paths for a substring.
func (s *Store) SearchLogs(query string, limit int) []RequestEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	q := strings.ToLower(query)
	var out []RequestEntry
	for i := len(s.logs) - 1; i >= 0 && len(out) < limit; i-- {
		e := s.logs[i]
		if strings.Contains(strings.ToLower(e.Path), q) ||
			strings.Contains(strings.ToLower(e.RequestBody), q) ||
			strings.Contains(strings.ToLower(e.ResponseBody), q) {
			out = append(out, e)
		}
	}
	return out
}

func (s *Store) PortForSubdomain(subdomain string) (int, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if ts, ok := s.tunnels[subdomain]; ok {
		return ts.Port, true
	}
	return 0, false
}

// --- Plugin wiring ---

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
	return []hooks.RequestHook{
		&interceptHook{store: p.store},
		&reqHook{store: p.store},
	}
}
func (p *Plugin) ConnectionHooks() []hooks.ConnectionHook {
	return []hooks.ConnectionHook{&connHook{store: p.store, plugin: p}}
}

func (p *Plugin) Store() *Store { return p.store }

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
	store   *Store
	pending sync.Map
}

type reqMeta struct {
	start     time.Time
	subdomain string
}

func (h *reqHook) BeforeProxy(req types.TunnelRequest) types.TunnelRequest {
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
	h.store.SetPendingSubdomain(subdomain)
}

// --- Intercept hook ---

type interceptHook struct {
	hooks.NoOpRequestHook
	store *Store
}

func (h *interceptHook) BeforeProxy(req types.TunnelRequest) types.TunnelRequest {
	rules := h.store.MatchingIntercepts(req.Method, req.Path)
	for _, rule := range rules {
		switch rule.Action {
		case "pause":
			log.Printf("[intercept] pausing %s %s (rule %d)", req.Method, req.Path, rule.ID)
			ch := h.store.PauseRequest(req.ID, req)
			edits := <-ch // block until resumed via API
			log.Printf("[intercept] resumed %s %s", req.Method, req.Path)
			// Apply any edits the user made while paused
			if edits != nil {
				if edits.Method != "" {
					req.Method = edits.Method
				}
				if edits.Path != "" {
					req.Path = edits.Path
				}
				if edits.Headers != nil {
					req.Headers = edits.Headers
				}
				if edits.Body != "" {
					req.Body = base64.StdEncoding.EncodeToString([]byte(edits.Body))
				}
			}
		case "modify-request":
			for k, v := range rule.SetHeaders {
				if req.Headers == nil {
					req.Headers = make(map[string][]string)
				}
				req.Headers[k] = []string{v}
			}
			if rule.SetBody != "" {
				req.Body = base64.StdEncoding.EncodeToString([]byte(rule.SetBody))
			}
		}
		// Inject latency on request side
		if rule.AddLatencyMs > 0 {
			time.Sleep(time.Duration(rule.AddLatencyMs) * time.Millisecond)
		}
	}
	return req
}

func (h *interceptHook) AfterProxy(req types.TunnelRequest, resp types.TunnelResponse) types.TunnelResponse {
	rules := h.store.MatchingIntercepts(req.Method, req.Path)
	for _, rule := range rules {
		switch rule.Action {
		case "modify-response":
			if rule.SetStatus > 0 {
				resp.Status = rule.SetStatus
			}
			for k, v := range rule.SetHeaders {
				if resp.Headers == nil {
					resp.Headers = make(map[string][]string)
				}
				resp.Headers[k] = []string{v}
			}
			if rule.SetBody != "" {
				resp.Body = base64.StdEncoding.EncodeToString([]byte(rule.SetBody))
			}
		case "mock":
			// Full mock: skip the real response entirely, replace with rule data
			if rule.SetStatus > 0 {
				resp.Status = rule.SetStatus
			} else {
				resp.Status = 200
			}
			resp.Headers = make(map[string][]string)
			resp.Headers["Content-Type"] = []string{"application/json"}
			for k, v := range rule.SetHeaders {
				resp.Headers[k] = []string{v}
			}
			if rule.SetBody != "" {
				resp.Body = base64.StdEncoding.EncodeToString([]byte(rule.SetBody))
			}
		}
	}
	return resp
}
