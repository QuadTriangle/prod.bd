package tunnel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/QuadTriangle/prod.bd/cli/internal/hooks"
	"github.com/QuadTriangle/prod.bd/cli/internal/proxy"
	"github.com/QuadTriangle/prod.bd/cli/internal/types"

	"github.com/gorilla/websocket"
)

func Register(clientID string, ports []int, workerBaseURL string, workerConfig map[string]any) (map[int]string, error) {
	reqBody := types.RegisterRequest{
		ClientID: clientID,
		Ports:    ports,
		Config:   workerConfig,
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	resp, err := http.Post(workerBaseURL+"/api/register", "application/json", bytes.NewBuffer(data))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("server returned status: %d", resp.StatusCode)
	}

	var res types.RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}

	if res.Error != "" {
		return nil, fmt.Errorf("server error: %s", res.Error)
	}

	return res.Tunnels, nil
}

func StartTunnel(subdomain string, localPort int, workerBaseURL string, pipeline *hooks.Pipeline, done <-chan struct{}) {
	u, _ := url.Parse(workerBaseURL)
	scheme := "wss"
	if u.Scheme == "http" {
		scheme = "ws"
	}

	wsURL := fmt.Sprintf("%s://%s/_tunnel?subdomain=%s", scheme, u.Host, subdomain)

	// Retry loop
	for {
		select {
		case <-done:
			log.Printf("Tunnel %s shutting down", subdomain)
			return
		default:
		}

		log.Printf("Connecting to %s (port %d)...", subdomain, localPort)
		if err := connectAndServe(wsURL, localPort, subdomain, pipeline, done); err != nil {
			pipeline.NotifyDisconnect(subdomain, err)
			log.Printf("Tunnel %s disconnected: %v. Retrying in 5s...", subdomain, err)
			select {
			case <-done:
				return
			case <-time.After(5 * time.Second):
			}
		}
	}
}

func connectAndServe(wsURL string, localPort int, subdomain string, pipeline *hooks.Pipeline, done <-chan struct{}) error {
	c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return err
	}
	defer c.Close()

	pipeline.NotifyConnect(subdomain, localPort)
	log.Printf("Tunnel established for port %d", localPort)

	// Close WebSocket when shutdown signal received
	go func() {
		<-done
		c.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"))
		c.Close()
	}()

	// Thread-safe writer
	var writeMutex sync.Mutex
	writeJSON := func(v any) error {
		writeMutex.Lock()
		defer writeMutex.Unlock()
		return c.WriteJSON(v)
	}
	writeText := func(msg string) error {
		writeMutex.Lock()
		defer writeMutex.Unlock()
		return c.WriteMessage(websocket.TextMessage, []byte(msg))
	}

	// Keepalive: ping every 30s to prevent idle disconnects
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if err := writeText("ping"); err != nil {
					log.Printf("Keepalive ping failed: %v", err)
					return
				}
			}
		}
	}()

	// WebSocket relay for visitor WS sessions
	wsRelay := proxy.NewWSRelay(localPort, writeJSON)

	// Main read loop
	for {
		_, message, err := c.ReadMessage()
		if err != nil {
			return err
		}

		if string(message) == "pong" {
			continue
		}

		go handleMessage(message, localPort, subdomain, writeJSON, wsRelay, pipeline)
	}
}

// handleMessage routes an incoming tunnel message by its type field.
func handleMessage(raw []byte, localPort int, subdomain string, writeJSON func(any) error, wsRelay *proxy.WSRelay, pipeline *hooks.Pipeline) {
	// Peek at the type field to route without fully unmarshaling into the wrong struct
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		log.Printf("Error unmarshaling message: %v", err)
		return
	}

	switch envelope.Type {
	case types.TypeHTTPRequest:
		var req types.TunnelRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			log.Printf("Error unmarshaling HTTP request: %v", err)
			return
		}
		pipeline.NotifyRequest(subdomain)
		req = pipeline.RunBeforeProxy(req)
		resp := proxy.HandleRequest(req, localPort)
		resp = pipeline.RunAfterProxy(req, resp)
		if err := writeJSON(resp); err != nil {
			log.Printf("Error sending HTTP response: %v", err)
		}

	case types.TypeWSOpen:
		var msg types.WSOpen
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("Error unmarshaling ws-open: %v", err)
			return
		}
		wsRelay.HandleOpen(msg)

	case types.TypeWSFrame:
		var msg types.WSFrame
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("Error unmarshaling ws-frame: %v", err)
			return
		}
		wsRelay.HandleFrame(msg)

	case types.TypeWSClose:
		var msg types.WSClose
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("Error unmarshaling ws-close: %v", err)
			return
		}
		wsRelay.HandleClose(msg)
	}
}
