package tunnel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"prodbd/internal/proxy"
	"prodbd/internal/types"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

func Register(clientID string, ports []int, workerBaseURL string) (map[int]string, error) {
	reqBody := types.RegisterRequest{
		ClientID: clientID,
		Ports:    ports,
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

func StartTunnel(subdomain string, localPort int, workerBaseURL string, done <-chan struct{}) {
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
		if err := connectAndServe(wsURL, localPort, done); err != nil {
			log.Printf("Tunnel %s disconnected: %v. Retrying in 5s...", subdomain, err)
			select {
			case <-done:
				return
			case <-time.After(5 * time.Second):
			}
		}
	}
}

func connectAndServe(wsURL string, localPort int, done <-chan struct{}) error {
	c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return err
	}
	defer c.Close()

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
	writeJSON := func(v interface{}) error {
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

	for {
		_, message, err := c.ReadMessage()
		if err != nil {
			return err
		}

		// Ignore keepalive pong from server
		if string(message) == "pong" {
			continue
		}

		go func(msg []byte) {
			var req types.TunnelRequest
			if err := json.Unmarshal(msg, &req); err != nil {
				log.Printf("Error unmarshaling request: %v", err)
				return
			}

			resp, err := proxy.HandleRequest(req, localPort)
			if err != nil {
				log.Printf("Error handling request: %v", err)
				return
			}

			if err := writeJSON(resp); err != nil {
				log.Printf("Error sending response: %v", err)
			}
		}(message)
	}
}
