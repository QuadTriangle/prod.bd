package stats

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

//go:generate sh -c "cd dashboard && pnpm install && pnpm run build"

//go:embed dashboard/dist/*
var dashboardFS embed.FS

type tunnelJSON struct {
	Subdomain     string  `json:"subdomain"`
	Port          int     `json:"port"`
	TotalRequests int     `json:"total_requests"`
	ErrorCount    int     `json:"error_count"`
	AvgLatency    float64 `json:"avg_latency"`
	MaxLatency    float64 `json:"max_latency"`
	MinLatency    float64 `json:"min_latency"`
	TotalBytesIn  int     `json:"total_bytes_in"`
	TotalBytesOut int     `json:"total_bytes_out"`
	ConnectedAt   int64   `json:"connected_at"`
}

type requestJSON struct {
	ID              int                 `json:"id"`
	Subdomain       string              `json:"subdomain"`
	Method          string              `json:"method"`
	Path            string              `json:"path"`
	Status          int                 `json:"status"`
	LatencyMs       float64             `json:"latency_ms"`
	BytesIn         int                 `json:"bytes_in"`
	BytesOut        int                 `json:"bytes_out"`
	CreatedAt       int64               `json:"created_at"`
	RequestHeaders  map[string][]string `json:"request_headers,omitempty"`
	RequestBody     string              `json:"request_body,omitempty"`
	ResponseHeaders map[string][]string `json:"response_headers,omitempty"`
	ResponseBody    string              `json:"response_body,omitempty"`
}

type summaryJSON struct {
	ActiveTunnels int     `json:"active_tunnels"`
	TotalRequests int     `json:"total_requests"`
	TotalErrors   int     `json:"total_errors"`
	AvgLatency    float64 `json:"avg_latency"`
	TotalBytesIn  int     `json:"total_bytes_in"`
	TotalBytesOut int     `json:"total_bytes_out"`
}

type pausedJSON struct {
	ID       string              `json:"id"`
	Method   string              `json:"method"`
	Path     string              `json:"path"`
	Headers  map[string][]string `json:"headers,omitempty"`
	Body     string              `json:"body,omitempty"`
	PausedAt int64               `json:"paused_at"`
}

type Server struct {
	store    *Store
	listener net.Listener
}

func StartServer(store *Store, port int) (*Server, error) {
	mux := http.NewServeMux()
	s := &Server{store: store}
	mux.HandleFunc("/api/stats/tunnels", s.handleTunnels)
	mux.HandleFunc("/api/stats/requests", s.handleRequests)
	mux.HandleFunc("/api/stats/summary", s.handleSummary)
	mux.HandleFunc("/api/stats/replay/", s.handleReplay)
	mux.HandleFunc("/api/stats/send", s.handleSend)
	mux.HandleFunc("/api/stats/intercepts", s.handleIntercepts)
	mux.HandleFunc("/api/stats/intercepts/", s.handleInterceptByID)
	mux.HandleFunc("/api/stats/paused", s.handlePaused)
	mux.HandleFunc("/api/stats/resume/", s.handleResume)
	mux.HandleFunc("/api/stats/saved", s.handleSaved)
	mux.HandleFunc("/api/stats/saved/", s.handleSavedByID)
	mux.HandleFunc("/api/stats/search", s.handleSearch)
	mux.HandleFunc("/api/stats/curl/", s.handleCurl)
	mux.HandleFunc("/api/stats/clear", s.handleClear)
	// Serve built Astro static files from dashboard/dist
	distFS, _ := fs.Sub(dashboardFS, "dashboard/dist")
	fileServer := http.FileServer(http.FS(distFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the file; fall back to index.html for SPA routing
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		if _, err := fs.Stat(distFS, strings.TrimPrefix(path, "/")); err != nil {
			// Serve index.html for any unmatched route
			data, _ := fs.ReadFile(distFS, "index.html")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(data)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return nil, err
	}
	s.listener = ln
	srv := &http.Server{Handler: corsMiddleware(mux)}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[stats] server error: %v", err)
		}
	}()
	return s, nil
}

func (s *Server) Addr() string { return s.listener.Addr().String() }

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func (s *Server) handleTunnels(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	out := make([]tunnelJSON, 0, len(snap))
	for _, ts := range snap {
		avg := float64(0)
		if ts.TotalRequests > 0 {
			avg = float64(ts.TotalLatency.Milliseconds()) / float64(ts.TotalRequests)
		}
		minLat := float64(0)
		if ts.MinLatency < time.Duration(1<<63-1) {
			minLat = float64(ts.MinLatency.Milliseconds())
		}
		out = append(out, tunnelJSON{
			Subdomain: ts.Subdomain, Port: ts.Port,
			TotalRequests: ts.TotalRequests, ErrorCount: ts.ErrorCount,
			AvgLatency: avg, MaxLatency: float64(ts.MaxLatency.Milliseconds()), MinLatency: minLat,
			TotalBytesIn: ts.TotalBytesIn, TotalBytesOut: ts.TotalBytesOut,
			ConnectedAt: ts.ConnectedAt.Unix(),
		})
	}
	writeJSON(w, map[string]any{"tunnels": out})
}

func (s *Server) handleRequests(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = n
	}
	if limit > 500 {
		limit = 500
	}
	subdomain := r.URL.Query().Get("subdomain")
	entries := s.store.RecentLogs(limit)
	reqs := make([]requestJSON, 0, len(entries))
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		if subdomain != "" && e.Subdomain != subdomain {
			continue
		}
		reqs = append(reqs, requestJSON{
			ID: e.ID, Subdomain: e.Subdomain, Method: e.Method, Path: e.Path,
			Status: e.Status, LatencyMs: float64(e.Latency.Milliseconds()),
			BytesIn: e.BytesIn, BytesOut: e.BytesOut, CreatedAt: e.Timestamp.Unix(),
			RequestHeaders: e.RequestHeaders, RequestBody: e.RequestBody,
			ResponseHeaders: e.ResponseHeaders, ResponseBody: e.ResponseBody,
		})
	}
	writeJSON(w, map[string]any{"requests": reqs})
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	snap := s.store.Snapshot()
	var sum summaryJSON
	sum.ActiveTunnels = len(snap)
	var totalLatency int64
	for _, ts := range snap {
		sum.TotalRequests += ts.TotalRequests
		sum.TotalErrors += ts.ErrorCount
		sum.TotalBytesIn += ts.TotalBytesIn
		sum.TotalBytesOut += ts.TotalBytesOut
		totalLatency += ts.TotalLatency.Milliseconds()
	}
	if sum.TotalRequests > 0 {
		sum.AvgLatency = float64(totalLatency) / float64(sum.TotalRequests)
	}
	writeJSON(w, map[string]any{"summary": sum})
}

func (s *Server) handleReplay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/stats/replay/"))
	if err != nil {
		http.Error(w, "invalid request id", http.StatusBadRequest)
		return
	}
	entry := s.store.GetByID(id)
	if entry == nil {
		http.Error(w, "request not found", http.StatusNotFound)
		return
	}
	port, ok := s.store.PortForSubdomain(entry.Subdomain)
	if !ok {
		http.Error(w, "tunnel no longer connected", http.StatusGone)
		return
	}
	targetURL := fmt.Sprintf("http://127.0.0.1:%d%s", port, entry.Path)
	var body io.Reader
	if entry.RequestBody != "" {
		body = bytes.NewReader([]byte(entry.RequestBody))
	}
	req, err := http.NewRequest(entry.Method, targetURL, body)
	if err != nil {
		http.Error(w, "failed to create request", http.StatusInternalServerError)
		return
	}
	for k, vals := range entry.RequestHeaders {
		req.Header[k] = vals
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("replay failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	latency := time.Since(start)
	respBody, _ := io.ReadAll(resp.Body)
	headers := make(map[string][]string)
	for k, v := range resp.Header {
		headers[k] = v
	}
	writeJSON(w, map[string]any{"original_id": id, "status": resp.StatusCode, "latency_ms": float64(latency.Milliseconds()), "headers": headers, "body": string(respBody)})
}

func (s *Server) handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var payload struct {
		Subdomain string              `json:"subdomain"`
		Method    string              `json:"method"`
		Path      string              `json:"path"`
		Headers   map[string][]string `json:"headers"`
		Body      string              `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if payload.Method == "" {
		payload.Method = "GET"
	}
	if payload.Path == "" {
		payload.Path = "/"
	}
	port, ok := s.store.PortForSubdomain(payload.Subdomain)
	if !ok {
		http.Error(w, "tunnel not connected", http.StatusGone)
		return
	}
	targetURL := fmt.Sprintf("http://127.0.0.1:%d%s", port, payload.Path)
	var body io.Reader
	if payload.Body != "" {
		body = bytes.NewReader([]byte(payload.Body))
	}
	req, err := http.NewRequest(payload.Method, targetURL, body)
	if err != nil {
		http.Error(w, "failed to create request", http.StatusInternalServerError)
		return
	}
	for k, vals := range payload.Headers {
		req.Header[k] = vals
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	latency := time.Since(start)
	respBody, _ := io.ReadAll(resp.Body)
	headers := make(map[string][]string)
	for k, v := range resp.Header {
		headers[k] = v
	}
	writeJSON(w, map[string]any{"status": resp.StatusCode, "latency_ms": float64(latency.Milliseconds()), "headers": headers, "body": string(respBody)})
}

func (s *Server) handleIntercepts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]any{"rules": s.store.ListIntercepts()})
	case http.MethodPost:
		var rule InterceptRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		created, err := s.store.AddIntercept(rule)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, created)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleInterceptByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/stats/intercepts/"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var rule InterceptRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		updated, err := s.store.UpdateIntercept(id, rule)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, updated)
	case http.MethodDelete:
		if !s.store.DeleteIntercept(id) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handlePaused(w http.ResponseWriter, r *http.Request) {
	pausedMap := s.store.ListPaused()
	out := make([]pausedJSON, 0, len(pausedMap))
	for id, pr := range pausedMap {
		body := ""
		if pr.Request.Body != "" {
			if decoded, err := base64.StdEncoding.DecodeString(pr.Request.Body); err == nil {
				body = string(decoded)
			}
		}
		out = append(out, pausedJSON{
			ID: id, Method: pr.Request.Method, Path: pr.Request.Path,
			Headers: pr.Request.Headers, Body: body, PausedAt: pr.PausedAt.Unix(),
		})
	}
	writeJSON(w, map[string]any{"paused": out})
}

func (s *Server) handleResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	reqID := strings.TrimPrefix(r.URL.Path, "/api/stats/resume/")
	var edits *EditedRequest
	if r.ContentLength > 0 {
		edits = &EditedRequest{}
		if err := json.NewDecoder(r.Body).Decode(edits); err != nil {
			edits = nil
		}
	}
	if !s.store.ResumeRequest(reqID, edits) {
		http.Error(w, "request not paused", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]any{"resumed": reqID})
}

func (s *Server) handleSaved(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]any{"saved": s.store.ListSaved()})
	case http.MethodPost:
		var sr SavedRequest
		if err := json.NewDecoder(r.Body).Decode(&sr); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		created := s.store.AddSaved(sr)
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, created)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSavedByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/stats/saved/"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var sr SavedRequest
		if err := json.NewDecoder(r.Body).Decode(&sr); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		updated, ok := s.store.UpdateSaved(id, sr)
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, updated)
	case http.MethodDelete:
		if !s.store.DeleteSaved(id) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		http.Error(w, "missing q parameter", http.StatusBadRequest)
		return
	}
	limit := 50
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = n
	}
	results := s.store.SearchLogs(q, limit)
	reqs := make([]requestJSON, 0, len(results))
	for _, e := range results {
		reqs = append(reqs, requestJSON{
			ID: e.ID, Subdomain: e.Subdomain, Method: e.Method, Path: e.Path,
			Status: e.Status, LatencyMs: float64(e.Latency.Milliseconds()),
			BytesIn: e.BytesIn, BytesOut: e.BytesOut, CreatedAt: e.Timestamp.Unix(),
			RequestHeaders: e.RequestHeaders, RequestBody: e.RequestBody,
			ResponseHeaders: e.ResponseHeaders, ResponseBody: e.ResponseBody,
		})
	}
	writeJSON(w, map[string]any{"requests": reqs})
}

func (s *Server) handleCurl(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/stats/curl/"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	entry := s.store.GetByID(id)
	if entry == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	port, _ := s.store.PortForSubdomain(entry.Subdomain)
	url := fmt.Sprintf("http://127.0.0.1:%d%s", port, entry.Path)
	var parts []string
	parts = append(parts, "curl")
	if entry.Method != "GET" {
		parts = append(parts, "-X", entry.Method)
	}
	for k, vals := range entry.RequestHeaders {
		for _, v := range vals {
			parts = append(parts, "-H", fmt.Sprintf("'%s: %s'", k, v))
		}
	}
	if entry.RequestBody != "" {
		escaped := strings.ReplaceAll(entry.RequestBody, "'", "'\\''")
		parts = append(parts, "-d", fmt.Sprintf("'%s'", escaped))
	}
	parts = append(parts, fmt.Sprintf("'%s'", url))
	writeJSON(w, map[string]any{"curl": strings.Join(parts, " ")})
}

func (s *Server) handleClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.store.ClearLogs()
	writeJSON(w, map[string]any{"cleared": true})
}
