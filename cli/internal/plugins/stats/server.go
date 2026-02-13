package stats

import (
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"time"
)

//go:embed index.html
var dashboardHTML embed.FS

// JSON response types matching what the dashboard expects

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

// Server serves the stats API locally for the dashboard to connect to.
type Server struct {
	store    *Store
	listener net.Listener
}

// StartServer starts the local stats HTTP server on the given port.
// Returns the server and the actual address it's listening on.
func StartServer(store *Store, port int) (*Server, error) {
	mux := http.NewServeMux()
	s := &Server{store: store}

	mux.HandleFunc("/api/stats/tunnels", s.handleTunnels)
	mux.HandleFunc("/api/stats/requests", s.handleRequests)
	mux.HandleFunc("/api/stats/summary", s.handleSummary)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		data, _ := dashboardHTML.ReadFile("index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
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

func (s *Server) Addr() string {
	return s.listener.Addr().String()
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
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
	tunnels := make([]tunnelJSON, 0, len(snap))
	for _, ts := range snap {
		avg := float64(0)
		if ts.TotalRequests > 0 {
			avg = float64(ts.TotalLatency.Milliseconds()) / float64(ts.TotalRequests)
		}
		minLat := float64(0)
		if ts.MinLatency < time.Duration(1<<63-1) {
			minLat = float64(ts.MinLatency.Milliseconds())
		}
		tunnels = append(tunnels, tunnelJSON{
			Subdomain:     ts.Subdomain,
			Port:          ts.Port,
			TotalRequests: ts.TotalRequests,
			ErrorCount:    ts.ErrorCount,
			AvgLatency:    avg,
			MaxLatency:    float64(ts.MaxLatency.Milliseconds()),
			MinLatency:    minLat,
			TotalBytesIn:  ts.TotalBytesIn,
			TotalBytesOut: ts.TotalBytesOut,
			ConnectedAt:   ts.ConnectedAt.Unix(),
		})
	}
	writeJSON(w, map[string]any{"tunnels": tunnels})
}

func (s *Server) handleRequests(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
		limit = n
	}
	if limit > 500 {
		limit = 500
	}

	subdomain := r.URL.Query().Get("subdomain")
	entries := s.store.RecentLogs(limit)

	// Filter by subdomain if provided
	reqs := make([]requestJSON, 0, len(entries))
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		if subdomain != "" && e.Subdomain != subdomain {
			continue
		}
		reqs = append(reqs, requestJSON{
			ID:              e.ID,
			Subdomain:       e.Subdomain,
			Method:          e.Method,
			Path:            e.Path,
			Status:          e.Status,
			LatencyMs:       float64(e.Latency.Milliseconds()),
			BytesIn:         e.BytesIn,
			BytesOut:        e.BytesOut,
			CreatedAt:       e.Timestamp.Unix(),
			RequestHeaders:  e.RequestHeaders,
			RequestBody:     e.RequestBody,
			ResponseHeaders: e.ResponseHeaders,
			ResponseBody:    e.ResponseBody,
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
