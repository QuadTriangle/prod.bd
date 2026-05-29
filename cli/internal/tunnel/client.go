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

	"github.com/QuadTriangle/prod.bd/cli/internal/binproto"
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
	dialer := websocket.Dialer{EnableCompression: true}
	c, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		return err
	}
	defer c.Close()

	pipeline.NotifyConnect(subdomain, localPort)
	log.Printf("Tunnel established for port %d", localPort)

	// Detect dead connections: if no data or pong arrives within 60s, ReadMessage fails.
	const pongWait = 60 * time.Second
	c.SetReadDeadline(time.Now().Add(pongWait))
	c.SetPongHandler(func(string) error {
		c.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Close WebSocket when shutdown signal received
	go func() {
		<-done
		c.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"))
		c.Close()
	}()

	// Thread-safe writer
	var writeMutex sync.Mutex
	writeBin := func(header any, body []byte) error {
		frame, err := binproto.Encode(header, body)
		if err != nil {
			return err
		}
		writeMutex.Lock()
		defer writeMutex.Unlock()
		return c.WriteMessage(websocket.BinaryMessage, frame)
	}
	writeJSON := func(v any) error {
		writeMutex.Lock()
		defer writeMutex.Unlock()
		return c.WriteJSON(v)
	}

	// Keepalive: send application-level ping every 30s (auto-responded by DO without waking it),
	// plus a WebSocket-level ping to trigger PongHandler and reset the read deadline.
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				writeMutex.Lock()
				// Application-level ping for DO auto-response
				_ = c.WriteMessage(websocket.TextMessage, []byte("ping"))
				// Protocol-level ping to reset read deadline via PongHandler
				err := c.WriteMessage(websocket.PingMessage, nil)
				writeMutex.Unlock()
				if err != nil {
					log.Printf("Keepalive ping failed: %v", err)
					return
				}
			}
		}
	}()

	defaultUpstream := proxy.DefaultTarget(localPort)

	// WebSocket relay with dynamic upstream resolution
	wsRelay := proxy.NewWSRelay(defaultUpstream, subdomain, writeBin, writeJSON, func(msg types.WSOpen) string {
		return pipeline.ResolveWS(subdomain, msg)
	}, pipeline)

	// Main read loop
	for {
		msgType, message, err := c.ReadMessage()
		if err != nil {
			return err
		}

		// Any successful read proves the connection is alive
		c.SetReadDeadline(time.Now().Add(pongWait))

		if msgType == websocket.TextMessage && string(message) == "pong" {
			continue
		}

		go handleMessage(msgType, message, defaultUpstream, subdomain, writeBin, writeJSON, wsRelay, pipeline)
	}
}

// handleMessage routes an incoming tunnel message by its type field.
func handleMessage(msgType int, raw []byte, defaultUpstream string, subdomain string, writeBin func(any, []byte) error, writeJSON func(any) error, wsRelay *proxy.WSRelay, pipeline *hooks.Pipeline) {
	var envelope struct {
		Type string `json:"type"`
	}

	var body []byte

	if msgType == websocket.BinaryMessage {
		hdr, b, err := binproto.Decode(raw)
		if err != nil {
			log.Printf("Error decoding binary frame: %v", err)
			return
		}
		if err := json.Unmarshal(hdr, &envelope); err != nil {
			log.Printf("Error unmarshaling header: %v", err)
			return
		}
		body = b
		raw = hdr
	} else {
		if err := json.Unmarshal(raw, &envelope); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			return
		}
	}

	switch envelope.Type {
	case types.TypeHTTPRequest:
		var req types.TunnelRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			log.Printf("Error unmarshaling HTTP request: %v", err)
			return
		}
		req.Body = body
		pipeline.NotifyRequest(subdomain)
		req = pipeline.RunBeforeProxy(req)

		upstream := pipeline.ResolveHTTP(subdomain, req)
		if upstream == "" {
			upstream = defaultUpstream
		}

		resp := proxy.HandleRequest(req, upstream)
		resp = pipeline.RunAfterProxy(req, resp)
		if err := writeBin(resp, resp.Body); err != nil {
			log.Printf("Error sending HTTP response: %v", err)
		}

	case types.TypeWSOpen:
		var msg types.WSOpen
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("Error unmarshaling ws-open: %v", err)
			return
		}
		// Run BeforeProxy hooks to apply header overrides (e.g. --host-header)
		synthetic := types.TunnelRequest{Headers: msg.Headers}
		synthetic = pipeline.RunBeforeProxy(synthetic)
		msg.Headers = synthetic.Headers
		pipeline.NotifyWSFrame(subdomain, msg.ID, "in", true, "", 0)
		wsRelay.HandleOpen(msg)

	case types.TypeWSFrame:
		var msg types.WSFrame
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("Error unmarshaling ws-frame: %v", err)
			return
		}
		msg.Data = body
		pipeline.NotifyWSFrame(subdomain, msg.ID, "in", msg.IsText, string(body), len(body))
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
