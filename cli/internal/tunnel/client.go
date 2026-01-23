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

// Allow swapping for testing
var WorkerURL = "https://tunnel.prod.bd"

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

func StartTunnel(subdomain string, localPort int, workerBaseURL string) {
	u, _ := url.Parse(workerBaseURL)
	scheme := "wss"
	if u.Scheme == "http" {
		scheme = "ws"
	}

	wsURL := fmt.Sprintf("%s://%s/_tunnel?subdomain=%s", scheme, u.Host, subdomain)

	// Retry loop
	for {
		log.Printf("Connecting to %s (port %d)...", subdomain, localPort)
		if err := connectAndServe(wsURL, localPort); err != nil {
			log.Printf("Tunnel %s disconnected: %v. Retrying in 5s...", subdomain, err)
			time.Sleep(5 * time.Second)
		}
	}
}

func connectAndServe(wsURL string, localPort int) error {
	c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return err
	}
	defer c.Close()

	log.Printf("Tunnel established for port %d", localPort)

	// Thread-safe writer
	var writeMutex sync.Mutex
	writeJSON := func(v interface{}) error {
		writeMutex.Lock()
		defer writeMutex.Unlock()
		return c.WriteJSON(v)
	}

	for {
		_, message, err := c.ReadMessage()
		if err != nil {
			return err
		}

		// Handle independently to avoid blocking the read loop
		go func(msg []byte) {
			var req types.TunnelRequest
			if err := json.Unmarshal(msg, &req); err != nil {
				log.Printf("Error unmarshaling request: %v", err)
				return
			}

			// Proxy Request
			resp, err := proxy.HandleRequest(req, localPort)
			if err != nil {
				log.Printf("Error handling request: %v", err)
				// return error to tunnel?
			}

			// Send Response
			if err := writeJSON(resp); err != nil {
				// connection is probably dead
				// we are in a goroutine. We can't easily break the main loop.
				// The main loop will fail on next ReadMessage usually.
				log.Printf("Error sending response: %v", err)
			}
		}(message)
	}
}
