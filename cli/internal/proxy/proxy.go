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
			return types.TunnelResponse{
				ID:     req.ID,
				Status: 502,
				Body:   base64.StdEncoding.EncodeToString([]byte("Invalid Request Body")),
			}, nil
		}
		body = bytes.NewReader(decoded)
	}

	httpReq, err := http.NewRequest(req.Method, targetURL, body)
	if err != nil {
		return types.TunnelResponse{
			ID:     req.ID,
			Status: 502,
			Body:   base64.StdEncoding.EncodeToString([]byte("Failed to create request")),
		}, nil
	}

	for k, vals := range req.Headers {
		// fetch lowercase header to Go compatible header
		canonical := http.CanonicalHeaderKey(k)
		httpReq.Header[canonical] = vals
	}

	// Many local dev servers check Host header
	httpReq.Host = fmt.Sprintf("localhost:%d", localPort)

	resp, err := client.Do(httpReq)
	if err != nil {
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

	// Preserve all header values (multi-value)
	headers := make(map[string][]string)
	maps.Copy(headers, resp.Header)

	return types.TunnelResponse{
		ID:      req.ID,
		Status:  resp.StatusCode,
		Headers: headers,
		Body:    base64.StdEncoding.EncodeToString(respBody),
	}, nil
}
