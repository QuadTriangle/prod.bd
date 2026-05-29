package stats

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
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
	MatchHeaders map[string]string `json:"match_headers,omitempty"`  // headers to match
	Action       string            `json:"action"`                   // "modify-request", "modify-response", "pause", "mock"
	SetHeaders   map[string]string `json:"set_headers,omitempty"`    // headers to add/override
	SetStatus    int               `json:"set_status,omitempty"`     // override response status
	SetBody      string            `json:"set_body,omitempty"`       // override body
	AddLatencyMs int               `json:"add_latency_ms,omitempty"` // inject artificial latency (ms)
	Enabled      bool              `json:"enabled"`
	compiled     *regexp.Regexp
}

func (r *InterceptRule) matches(method, path string, headers map[string][]string) bool {
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
	if len(r.MatchHeaders) > 0 {
		for k, exp := range r.MatchHeaders {
			has := false
			for reqK, reqVals := range headers {
				if strings.EqualFold(reqK, k) {
					for _, v := range reqVals {
						if strings.EqualFold(v, exp) || exp == "*" {
							has = true
							break
						}
					}
					if has {
						break
					}
				}
			}
			if !has {
				return false
			}
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
	TruncatedBody   bool     // indicates if body > 64KB
	Upstream        string
}

// SavedRequest is a named request template for the composer (like Postman collections).
type SavedRequest struct {
	ID         int         `json:"id"`
	Name       string      `json:"name"`
	Method     string      `json:"method"`
	Path       string      `json:"path"`
	Params     []KVPair    `json:"params,omitempty"`  // query params
	Headers    []KVPair    `json:"headers,omitempty"` // request headers
	BodyType   string      `json:"body_type"`         // "none", "json", "form", "raw"
	Body       string      `json:"body,omitempty"`
	Assertions []Assertion `json:"assertions,omitempty"` // response assertions
	Created    int64       `json:"created"`
}

// Assertion defines a check to run against a response.
type Assertion struct {
	Target   string `json:"target"`   // "status", "latency", "header", "body_contains", "body_json"
	Property string `json:"property"` // header name or JSON path (e.g. "Content-Type" or "data.id")
	Operator string `json:"operator"` // "eq", "neq", "lt", "gt", "contains", "exists"
	Value    string `json:"value"`    // expected value
}

// AssertionResult is the outcome of evaluating one assertion.
type AssertionResult struct {
	Assertion Assertion `json:"assertion"`
	Passed    bool      `json:"passed"`
	Actual    string    `json:"actual"`
	Error     string    `json:"error,omitempty"`
}

// WSMessage is a single captured WebSocket frame.
type WSMessage struct {
	ID        int    `json:"id"`
	SessionID string `json:"session_id"`
	Subdomain string `json:"subdomain"`
	Direction string `json:"direction"` // "in" (visitor→local) or "out" (local→visitor)
	IsText    bool   `json:"is_text"`
	Payload   string `json:"payload"` // raw text or base64 for binary
	Size      int    `json:"size"`
	Timestamp int64  `json:"timestamp"`
}

// UpstreamRoute defines a routing rule: requests matching the pattern go to the target URL.
type UpstreamRoute struct {
	ID          int      `json:"id"`
	Subdomain   string   `json:"subdomain"`         // which tunnel this applies to ("*" = all)
	PathPattern string   `json:"path_pattern"`      // regex to match request path
	Methods     []string `json:"methods,omitempty"` // empty = all methods
	Target      string   `json:"target"`            // upstream base URL e.g. "https://api.prod.com"
	Rewrite     string   `json:"rewrite,omitempty"` // regex replacement for path
	Enabled     bool     `json:"enabled"`
	Priority    int      `json:"priority"` // higher = checked first
	compiled    *regexp.Regexp
}

func (r *UpstreamRoute) matches(subdomain, method, path string) bool {
	if !r.Enabled {
		return false
	}
	if r.Subdomain != "*" && r.Subdomain != subdomain {
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

// RunResult is the outcome of running one request in a collection run.
type RunResult struct {
	Name       string            `json:"name"`
	Method     string            `json:"method"`
	Path       string            `json:"path"`
	Status     int               `json:"status"`
	LatencyMs  float64           `json:"latency_ms"`
	Assertions []AssertionResult `json:"assertions,omitempty"`
	Error      string            `json:"error,omitempty"`
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
	logHead          int
	logCount         int
	nextID           int
	pendingSubdomain sync.Map // goroutine ID -> subdomain

	// Intercept rules
	interceptMu     sync.RWMutex
	intercepts      []InterceptRule
	nextInterceptID int

	// Pause support: paused requests wait on a channel for release
	pausedMu sync.Mutex
	paused   map[string]*PausedRequest

	// Caching target urls from BeforeProxy to ResolveHTTP
	resolvedTargets sync.Map

	// Saved requests (composer collections)
	savedMu     sync.RWMutex
	saved       []SavedRequest
	nextSavedID int

	// WebSocket messages
	wsMu       sync.RWMutex
	wsMessages []WSMessage
	maxWSMsgs  int
	nextWSID   int
	wsSenders  map[string]func(isText bool, payload []byte) error

	// Upstream routes: path-based routing rules per subdomain
	upstreamMu     sync.RWMutex
	upstreams      []UpstreamRoute
	nextUpstreamID int
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
	s := &Store{
		tunnels:   make(map[string]*TunnelStats),
		maxLogs:   maxLogs,
		logs:      make([]RequestEntry, maxLogs),
		paused:    make(map[string]*PausedRequest),
		maxWSMsgs: maxLogs,
		wsSenders: make(map[string]func(isText bool, payload []byte) error),
	}
	s.LoadState()
	return s
}

// --- Persistence ---

func getStatsFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	dir := filepath.Join(home, ".prod")
	os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "stats.json")
}

type StatsState struct {
	Intercepts []InterceptRule `json:"intercepts"`
	Upstreams  []UpstreamRoute `json:"upstreams"`
	Saved      []SavedRequest  `json:"saved"`
}

func (s *Store) SaveState() {
	p := getStatsFilePath()
	if p == "" {
		return
	}
	st := StatsState{
		Intercepts: s.ListIntercepts(),
		Upstreams:  s.ListUpstreams(),
		Saved:      s.ListSaved(),
	}
	b, _ := json.MarshalIndent(st, "", "  ")
	os.WriteFile(p, b, 0644)
}

func (s *Store) LoadState() {
	p := getStatsFilePath()
	if p == "" {
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var st StatsState
	if err := json.Unmarshal(b, &st); err != nil {
		return
	}
	s.interceptMu.Lock()
	s.intercepts = st.Intercepts
	for i := range s.intercepts {
		if s.intercepts[i].PathPattern != "" {
			s.intercepts[i].compiled, _ = regexp.Compile(s.intercepts[i].PathPattern)
		}
		if s.intercepts[i].ID > s.nextInterceptID {
			s.nextInterceptID = s.intercepts[i].ID
		}
	}
	s.interceptMu.Unlock()

	s.upstreamMu.Lock()
	s.upstreams = st.Upstreams
	for i := range s.upstreams {
		if s.upstreams[i].PathPattern != "" {
			s.upstreams[i].compiled, _ = regexp.Compile(s.upstreams[i].PathPattern)
		}
		if s.upstreams[i].ID > s.nextUpstreamID {
			s.nextUpstreamID = s.upstreams[i].ID
		}
	}
	s.upstreamMu.Unlock()

	s.savedMu.Lock()
	s.saved = st.Saved
	for i := range s.saved {
		if s.saved[i].ID > s.nextSavedID {
			s.nextSavedID = s.saved[i].ID
		}
	}
	s.savedMu.Unlock()
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
	s.interceptMu.Unlock()
	s.SaveState()
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
			s.interceptMu.Unlock()
			s.SaveState()
			return rule, nil
		}
	}
	s.interceptMu.Unlock()
	return InterceptRule{}, fmt.Errorf("rule %d not found", id)
}

func (s *Store) DeleteIntercept(id int) bool {
	s.interceptMu.Lock()
	defer s.interceptMu.Unlock()
	for i := range s.intercepts {
		if s.intercepts[i].ID == id {
			s.intercepts = append(s.intercepts[:i], s.intercepts[i+1:]...)
			s.interceptMu.Unlock()
			s.SaveState()
			return true
		}
	}
	s.interceptMu.Unlock()
	return false
}

func (s *Store) MatchingIntercepts(method, path string, headers map[string][]string) []InterceptRule {
	s.interceptMu.RLock()
	defer s.interceptMu.RUnlock()
	var out []InterceptRule
	for _, r := range s.intercepts {
		if r.matches(method, path, headers) {
			out = append(out, r)
		}
	}
	return out
}

// --- Upstream route CRUD ---

func (s *Store) AddUpstream(route UpstreamRoute) (UpstreamRoute, error) {
	compiled, err := regexp.Compile(route.PathPattern)
	if err != nil {
		return UpstreamRoute{}, err
	}
	route.compiled = compiled
	s.upstreamMu.Lock()
	defer s.upstreamMu.Unlock()
	s.nextUpstreamID++
	route.ID = s.nextUpstreamID
	s.upstreams = append(s.upstreams, route)
	s.upstreamMu.Unlock()
	s.SaveState()
	return route, nil
}

func (s *Store) ListUpstreams() []UpstreamRoute {
	s.upstreamMu.RLock()
	defer s.upstreamMu.RUnlock()
	out := make([]UpstreamRoute, len(s.upstreams))
	copy(out, s.upstreams)
	return out
}

func (s *Store) UpdateUpstream(id int, route UpstreamRoute) (UpstreamRoute, error) {
	compiled, err := regexp.Compile(route.PathPattern)
	if err != nil {
		return UpstreamRoute{}, err
	}
	s.upstreamMu.Lock()
	defer s.upstreamMu.Unlock()
	for i := range s.upstreams {
		if s.upstreams[i].ID == id {
			route.ID = id
			route.compiled = compiled
			s.upstreams[i] = route
			s.upstreamMu.Unlock()
			s.SaveState()
			return route, nil
		}
	}
	s.upstreamMu.Unlock()
	return UpstreamRoute{}, fmt.Errorf("upstream %d not found", id)
}

func (s *Store) DeleteUpstream(id int) bool {
	s.upstreamMu.Lock()
	defer s.upstreamMu.Unlock()
	for i := range s.upstreams {
		if s.upstreams[i].ID == id {
			s.upstreams = append(s.upstreams[:i], s.upstreams[i+1:]...)
			s.upstreamMu.Unlock()
			s.SaveState()
			return true
		}
	}
	s.upstreamMu.Unlock()
	return false
}

// MatchUpstream finds the highest-priority matching upstream for a request.
func (s *Store) MatchUpstream(subdomain, method, path string) *UpstreamRoute {
	s.upstreamMu.RLock()
	defer s.upstreamMu.RUnlock()
	best := -1
	bestPriority := -1
	for i, r := range s.upstreams {
		if r.matches(subdomain, method, path) && r.Priority > bestPriority {
			best = i
			bestPriority = r.Priority
		}
	}
	if best >= 0 {
		cp := s.upstreams[best]
		return &cp
	}
	return nil
}

// ResolveUpstream finds the target URL of the highest-priority matching upstream.
func (s *Store) ResolveUpstream(subdomain, method, path string) string {
	r := s.MatchUpstream(subdomain, method, path)
	if r != nil {
		return r.Target
	}
	return ""
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
	s.nextSavedID++
	sr.ID = s.nextSavedID
	sr.Created = time.Now().Unix()
	s.saved = append(s.saved, sr)
	s.savedMu.Unlock()
	s.SaveState()
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
			s.savedMu.Unlock()
			s.SaveState()
			return sr, true
		}
	}
	s.savedMu.Unlock()
	return SavedRequest{}, false
}

func (s *Store) DeleteSaved(id int) bool {
	s.savedMu.Lock()
	defer s.savedMu.Unlock()
	for i := range s.saved {
		if s.saved[i].ID == id {
			s.saved = append(s.saved[:i], s.saved[i+1:]...)
			s.savedMu.Unlock()
			s.SaveState()
			return true
		}
	}
	s.savedMu.Unlock()
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

func isBinaryContentType(headers map[string][]string) bool {
	for k, v := range headers {
		if strings.EqualFold(k, "content-type") && len(v) > 0 {
			ct := strings.ToLower(v[0])
			if strings.HasPrefix(ct, "image/") || strings.HasPrefix(ct, "audio/") || strings.HasPrefix(ct, "video/") || strings.HasPrefix(ct, "application/octet-stream") || strings.HasPrefix(ct, "application/pdf") {
				return true
			}
		}
	}
	return false
}

func (s *Store) RecordRequest(subdomain, upstream string, req types.TunnelRequest, resp types.TunnelResponse, latency time.Duration) {
	bytesIn := len(req.Body)
	bytesOut := len(resp.Body)

	var reqBody, respBody string
	var truncated bool
	binReq := isBinaryContentType(req.Headers)
	binResp := isBinaryContentType(resp.Headers)

	if len(req.Body) > 0 {
		if len(req.Body) < 64_000 {
			if binReq {
				reqBody = base64.StdEncoding.EncodeToString(req.Body)
			} else {
				reqBody = string(req.Body)
			}
		} else {
			truncated = true
		}
	}
	if len(resp.Body) > 0 {
		if len(resp.Body) < 64_000 {
			if binResp {
				respBody = base64.StdEncoding.EncodeToString(resp.Body)
			} else {
				respBody = string(resp.Body)
			}
		} else {
			truncated = true
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
		TruncatedBody:   truncated,
		Upstream:        upstream,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextID++
	entry.ID = s.nextID

	s.logs[s.logHead] = entry
	s.logHead = (s.logHead + 1) % s.maxLogs
	if s.logCount < s.maxLogs {
		s.logCount++
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
	if n > s.logCount {
		n = s.logCount
	}
	out := make([]RequestEntry, n)

	start := (s.logHead - n + s.maxLogs) % s.maxLogs
	if start+n <= s.maxLogs {
		copy(out, s.logs[start:start+n])
	} else {
		part1 := s.maxLogs - start
		copy(out, s.logs[start:])
		copy(out[part1:], s.logs[:n-part1])
	}
	return out
}

func (s *Store) GetByID(id int) *RequestEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := 0; i < s.logCount; i++ {
		if s.logs[i].ID == id {
			cp := s.logs[i]
			return &cp
		}
	}
	return nil
}

func (s *Store) UpdateTags(id int, tags []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := 0; i < s.maxLogs; i++ {
		if s.logs[i].ID == id {
			s.logs[i].Tags = tags
			s.SaveState()
			return
		}
	}
}

// ClearLogs removes all request log entries and resets the ID counter.
func (s *Store) ClearLogs() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logs = make([]RequestEntry, s.maxLogs)
	s.logHead = 0
	s.logCount = 0
	s.nextID = 0
}

// SearchLogs searches request/response bodies and paths for a substring.
func (s *Store) SearchLogs(query string, limit int) []RequestEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	q := strings.ToLower(query)
	var out []RequestEntry
	for i := 0; i < s.logCount && len(out) < limit; i++ {
		idx := (s.logHead - 1 - i + s.maxLogs) % s.maxLogs
		e := s.logs[idx]
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

// --- WebSocket message recording ---

func (s *Store) RecordWSMessage(subdomain, sessionID, direction string, isText bool, payload string, size int) {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	s.nextWSID++
	msg := WSMessage{
		ID: s.nextWSID, SessionID: sessionID, Subdomain: subdomain,
		Direction: direction, IsText: isText, Payload: payload,
		Size: size, Timestamp: time.Now().Unix(),
	}
	if len(s.wsMessages) >= s.maxWSMsgs {
		s.wsMessages = append(s.wsMessages[1:], msg)
	} else {
		s.wsMessages = append(s.wsMessages, msg)
	}
}

func (s *Store) RecentWSMessages(subdomain string, n int) []WSMessage {
	s.wsMu.RLock()
	defer s.wsMu.RUnlock()
	var out []WSMessage
	for i := len(s.wsMessages) - 1; i >= 0 && len(out) < n; i-- {
		if subdomain == "" || s.wsMessages[i].Subdomain == subdomain {
			out = append(out, s.wsMessages[i])
		}
	}
	return out
}

func (s *Store) ClearWSMessages() {
	s.wsMu.Lock()
	s.wsMessages = nil
	s.nextWSID = 0
	s.wsMu.Unlock()
}

// --- Assertion evaluation ---

func EvaluateAssertions(assertions []Assertion, status int, latencyMs float64, headers map[string][]string, body string) []AssertionResult {
	results := make([]AssertionResult, 0, len(assertions))
	for _, a := range assertions {
		r := AssertionResult{Assertion: a}
		switch a.Target {
		case "status":
			r.Actual = strconv.Itoa(status)
			r.Passed = compareStr(r.Actual, a.Operator, a.Value)
		case "latency":
			r.Actual = fmt.Sprintf("%.0f", latencyMs)
			r.Passed = compareStr(r.Actual, a.Operator, a.Value)
		case "header":
			val := ""
			for k, v := range headers {
				if strings.EqualFold(k, a.Property) && len(v) > 0 {
					val = v[0]
					break
				}
			}
			r.Actual = val
			if a.Operator == "exists" {
				r.Passed = val != ""
			} else {
				r.Passed = compareStr(val, a.Operator, a.Value)
			}
		case "body_contains":
			r.Actual = fmt.Sprintf("len=%d", len(body))
			r.Passed = strings.Contains(body, a.Value)
		case "body_json":
			r.Actual = extractJSONPath(body, a.Property)
			if a.Operator == "exists" {
				r.Passed = r.Actual != ""
			} else {
				r.Passed = compareStr(r.Actual, a.Operator, a.Value)
			}
		default:
			r.Error = "unknown target: " + a.Target
		}
		results = append(results, r)
	}
	return results
}

func compareStr(actual, op, expected string) bool {
	switch op {
	case "eq":
		return actual == expected
	case "neq":
		return actual != expected
	case "contains":
		return strings.Contains(actual, expected)
	case "lt":
		a, _ := strconv.ParseFloat(actual, 64)
		e, _ := strconv.ParseFloat(expected, 64)
		return a < e
	case "gt":
		a, _ := strconv.ParseFloat(actual, 64)
		e, _ := strconv.ParseFloat(expected, 64)
		return a > e
	}
	return false
}

// extractJSONPath does simple dot-path extraction: "data.user.id" from JSON.
func extractJSONPath(body, path string) string {
	var obj any
	if err := json.Unmarshal([]byte(body), &obj); err != nil {
		return ""
	}
	parts := strings.Split(path, ".")
	cur := obj
	for _, p := range parts {
		switch v := cur.(type) {
		case map[string]any:
			cur = v[p]
		case []any:
			idx, err := strconv.Atoi(p)
			if err != nil || idx < 0 || idx >= len(v) {
				return ""
			}
			cur = v[idx]
		default:
			return ""
		}
	}
	if cur == nil {
		return ""
	}
	return fmt.Sprintf("%v", cur)
}

// --- Plugin wiring ---

type Plugin struct {
	dashboardPort int
	dashboardAuth string
	workerURL     string
	baseDomain    string
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
	fs.StringVar(&p.dashboardAuth, "dashboard-auth", "", "Basic auth for dashboard (user:pass).")
}
func (p *Plugin) Enabled() bool                { return p.dashboardPort > 0 }
func (p *Plugin) WorkerConfig() map[string]any { return nil }
func (p *Plugin) RequestHooks() []hooks.RequestHook {
	return []hooks.RequestHook{
		&interceptHook{store: p.store},
		&reqHook{store: p.store, plugin: p},
	}
}
func (p *Plugin) ConnectionHooks() []hooks.ConnectionHook {
	return []hooks.ConnectionHook{&connHook{store: p.store, plugin: p}}
}

func (p *Plugin) WSHooks() []hooks.WSHook {
	return []hooks.WSHook{&wsHook{store: p.store, plugin: p}}
}

func (p *Plugin) ProxyHooks() []hooks.ProxyHook {
	return []hooks.ProxyHook{&upstreamHook{store: p.store}}
}

func (p *Plugin) ExtraPorts() []int {
	if p.dashboardAuth != "" && p.dashboardPort > 0 {
		return []int{p.dashboardPort}
	}
	return nil
}

func (p *Plugin) Store() *Store { return p.store }

func (p *Plugin) broadcast(event string, data any) {
	if p.server != nil {
		p.server.Broadcast(event, data)
	}
}

func (p *Plugin) SetAccountConfig(workerURL, baseDomain string) {
	p.workerURL = workerURL
	p.baseDomain = baseDomain
}

func (p *Plugin) startDashboard() {
	if p.dashboardPort == 0 || p.server != nil {
		return
	}
	srv, err := StartServer(p.store, p.dashboardPort, p.dashboardAuth, p.workerURL, p.baseDomain)
	if err != nil {
		log.Printf("[stats] failed to start dashboard server: %v", err)
		return
	}
	p.server = srv
	log.Printf("[stats] dashboard API listening on http://%s", srv.Addr())
}

// --- Hooks ---

// --- Upstream proxy hook ---

type upstreamHook struct {
	store *Store
}

func (h *upstreamHook) ResolveHTTP(subdomain string, req types.TunnelRequest) string {
	if val, ok := h.store.resolvedTargets.LoadAndDelete(req.ID); ok {
		return val.(string)
	}
	return h.store.ResolveUpstream(subdomain, req.Method, req.Path)
}

func (h *upstreamHook) ResolveWS(subdomain string, msg types.WSOpen) string {
	return h.store.ResolveUpstream(subdomain, "GET", msg.Path)
}

type reqHook struct {
	hooks.NoOpRequestHook
	store   *Store
	plugin  *Plugin
	pending sync.Map
}

type reqMeta struct {
	start     time.Time
	subdomain string
	upstream  string
}

func (h *reqHook) BeforeProxy(req types.TunnelRequest) types.TunnelRequest {
	subdomain := h.store.ConsumePendingSubdomain()

	// Pre-resolve upstream to record it and apply any rewrite
	r := h.store.MatchUpstream(subdomain, req.Method, req.Path)
	upstream := ""
	if r != nil {
		upstream = r.Target
		// Cache for ResolveHTTP so it doesn't fail when path is rewritten
		h.store.resolvedTargets.Store(req.ID, r.Target)
		if r.Rewrite != "" && r.compiled != nil {
			req.Path = r.compiled.ReplaceAllString(req.Path, r.Rewrite)
		}
	} else {
		if ts, ok := h.store.tunnels[subdomain]; ok {
			upstream = fmt.Sprintf("http://localhost:%d", ts.Port)
		} else {
			upstream = "local default"
		}
	}

	h.pending.Store(req.ID, reqMeta{start: time.Now(), subdomain: subdomain, upstream: upstream})
	return req
}

func (h *reqHook) AfterProxy(req types.TunnelRequest, resp types.TunnelResponse) types.TunnelResponse {
	var latency time.Duration
	subdomain := ""
	upstream := ""
	if v, ok := h.pending.LoadAndDelete(req.ID); ok {
		meta := v.(reqMeta)
		latency = time.Since(meta.start)
		subdomain = meta.subdomain
		upstream = meta.upstream
	}
	h.store.RecordRequest(subdomain, upstream, req, resp, latency)
	h.plugin.broadcast("request", map[string]any{
		"subdomain": subdomain, "method": req.Method, "path": req.Path,
		"status": resp.Status, "latency_ms": latency.Milliseconds(),
		"upstream": upstream,
	})
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
	h.plugin.broadcast("tunnel", map[string]any{"action": "connect", "subdomain": subdomain, "port": port})
}

func (h *connHook) OnDisconnect(subdomain string, err error) {
	h.store.RecordDisconnect(subdomain)
	h.plugin.broadcast("tunnel", map[string]any{"action": "disconnect", "subdomain": subdomain})
}

func (h *connHook) OnRequest(subdomain string) {
	h.store.SetPendingSubdomain(subdomain)
}

// --- WS hook ---

type wsHook struct {
	store  *Store
	plugin *Plugin
}

func (h *wsHook) OnWSSessionStart(subdomain, sessionID string, sender func(isText bool, payload []byte) error) {
	h.store.wsMu.Lock()
	h.store.wsSenders[sessionID] = sender
	h.store.wsMu.Unlock()
}

func (h *wsHook) OnWSSessionEnd(subdomain, sessionID string) {
	h.store.wsMu.Lock()
	delete(h.store.wsSenders, sessionID)
	h.store.wsMu.Unlock()
}

func (h *wsHook) OnWSFrame(subdomain, sessionID, direction string, isText bool, payload string, size int) {
	h.store.RecordWSMessage(subdomain, sessionID, direction, isText, payload, size)
	h.plugin.broadcast("ws_frame", map[string]any{
		"subdomain": subdomain, "session_id": sessionID, "direction": direction,
	})
}

// --- Intercept hook ---

type interceptHook struct {
	hooks.NoOpRequestHook
	store *Store
}

func (h *interceptHook) BeforeProxy(req types.TunnelRequest) types.TunnelRequest {
	rules := h.store.MatchingIntercepts(req.Method, req.Path, req.Headers)
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
					req.Body = []byte(edits.Body)
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
				req.Body = []byte(rule.SetBody)
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
	rules := h.store.MatchingIntercepts(req.Method, req.Path, req.Headers)
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
				resp.Body = []byte(rule.SetBody)
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
				resp.Body = []byte(rule.SetBody)
			}
		}
	}
	return resp
}
