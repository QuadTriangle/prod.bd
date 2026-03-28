package proxy

import (
	"bytes"
	"fmt"
	"io"
	"maps"
	"net/http"
	"time"

	"github.com/QuadTriangle/prod.bd/cli/internal/config"
	"github.com/QuadTriangle/prod.bd/cli/internal/types"
)

// DefaultTarget returns the default localhost URL for a given port.
func DefaultTarget(localPort int) string {
	host := config.GetTargetHost()
	return fmt.Sprintf("http://%s:%d", host, localPort)
}

// HandleRequest proxies a tunnel request to the given upstream base URL.
func HandleRequest(req types.TunnelRequest, upstream string) types.TunnelResponse {
	client := &http.Client{
		Timeout: 30 * time.Second,
		// Don't follow redirects, let the browser handle them
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	targetURL := upstream + req.Path

	var body io.Reader
	if len(req.Body) > 0 {
		body = bytes.NewReader(req.Body)
	}

	httpReq, err := http.NewRequest(req.Method, targetURL, body)
	if err != nil {
		return types.TunnelResponse{
			Type:   types.TypeHTTPResponse,
			ID:     req.ID,
			Status: 502,
			Body:   []byte("Failed to create request"),
		}
	}

	for k, vals := range req.Headers {
		canonical := http.CanonicalHeaderKey(k)
		// If we forward Accept-Encoding, Go passes compressed bytes through
		// raw, but Cloudflare's edge may strip Content-Encoding on the way
		// back — leaving the browser with undecoded gzip bytes.
		if canonical == "Accept-Encoding" {
			continue
		}
		httpReq.Header[canonical] = vals
	}

	// Set Host to match the upstream target
	httpReq.Host = httpReq.URL.Host

	resp, err := client.Do(httpReq)
	if err != nil {
		return types.TunnelResponse{
			Type:   types.TypeHTTPResponse,
			ID:     req.ID,
			Status: 502,
			Body:   fmt.Appendf(nil, "Failed to connect to %s: %v", upstream, err),
		}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.TunnelResponse{Type: types.TypeHTTPResponse, ID: req.ID, Status: 502}
	}

	// Preserve all header values (multi-value)
	headers := make(map[string][]string)
	maps.Copy(headers, resp.Header)
	// Body is already decompressed by Go's transport, so these are stale
	delete(headers, "Content-Encoding")
	delete(headers, "Content-Length")

	return types.TunnelResponse{
		Type:    types.TypeHTTPResponse,
		ID:      req.ID,
		Status:  resp.StatusCode,
		Headers: headers,
		Body:    respBody,
	}
}
