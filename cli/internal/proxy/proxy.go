package proxy

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"maps"
	"net/http"
	"prodbd/internal/types"
	"time"
)

func HandleRequest(req types.TunnelRequest, localPort int) types.TunnelResponse {
	client := &http.Client{
		Timeout: 30 * time.Second,
		// Don't follow redirects, let the browser handle them
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	targetURL := fmt.Sprintf("http://localhost:%d%s", localPort, req.Path)

	var body io.Reader
	if req.Body != "" {
		decoded, err := base64.StdEncoding.DecodeString(req.Body)
		if err != nil {
			return types.TunnelResponse{
				Type:   types.TypeHTTPResponse,
				ID:     req.ID,
				Status: 502,
				Body:   base64.StdEncoding.EncodeToString([]byte("Invalid Request Body")),
			}
		}
		body = bytes.NewReader(decoded)
	}

	httpReq, err := http.NewRequest(req.Method, targetURL, body)
	if err != nil {
		return types.TunnelResponse{
			Type:   types.TypeHTTPResponse,
			ID:     req.ID,
			Status: 502,
			Body:   base64.StdEncoding.EncodeToString([]byte("Failed to create request")),
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

	// Many local dev servers check Host header
	httpReq.Host = fmt.Sprintf("localhost:%d", localPort)

	resp, err := client.Do(httpReq)
	if err != nil {
		return types.TunnelResponse{
			Type:   types.TypeHTTPResponse,
			ID:     req.ID,
			Status: 502,
			Body:   base64.StdEncoding.EncodeToString(fmt.Appendf(nil, "Failed to connect to local port %d: %v", localPort, err)),
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
		Body:    base64.StdEncoding.EncodeToString(respBody),
	}
}
