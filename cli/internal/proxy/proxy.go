package proxy

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"prodbd/internal/types"
	"time"
)

func HandleRequest(req types.TunnelRequest, localPort int) (types.TunnelResponse, error) {
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
			return types.TunnelResponse{ID: req.ID, Status: 502, Body: base64.StdEncoding.EncodeToString([]byte("Invalid Request Body"))}, nil
		}
		body = bytes.NewReader(decoded)
	}

	httpReq, err := http.NewRequest(req.Method, targetURL, body)
	if err != nil {
		return types.TunnelResponse{ID: req.ID, Status: 502, Body: base64.StdEncoding.EncodeToString([]byte("Failed to create request"))}, nil
	}

	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	// Many local dev servers (like Next.js) check Host header.
	// Let's set it to localhost for safety for now.
	httpReq.Host = fmt.Sprintf("localhost:%d", localPort)

	resp, err := client.Do(httpReq)
	if err != nil {
		// Connection refused or other error
		return types.TunnelResponse{
			ID:     req.ID,
			Status: 502,
			Body:   base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("Failed to connect to local port %d: %v", localPort, err))),
		}, nil
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.TunnelResponse{ID: req.ID, Status: 502}, nil
	}

	headers := make(map[string]string)
	for k, v := range resp.Header {
		// Just take the first value for simplicity, or join them?
		// standard map[string]string implies single value.
		// Real HTTP headers are multi-value.
		// Our TunnelResponse definition has map[string]string.
		headers[k] = v[0]
	}

	return types.TunnelResponse{
		ID:      req.ID,
		Status:  resp.StatusCode,
		Headers: headers,
		Body:    base64.StdEncoding.EncodeToString(respBody),
	}, nil
}
