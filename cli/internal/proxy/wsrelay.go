package proxy

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sync"

	"github.com/QuadTriangle/prod.bd/cli/internal/types"

	"github.com/gorilla/websocket"
)

// wsSession wraps a local WebSocket connection with a write mutex.
// gorilla/websocket does not support concurrent writes.
type wsSession struct {
	conn *websocket.Conn
	wmu  sync.Mutex
}

func (s *wsSession) writeMessage(msgType int, data []byte) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	return s.conn.WriteMessage(msgType, data)
}

// UpstreamResolver returns the upstream base URL for a WS open, or "" for default.
type UpstreamResolver func(msg types.WSOpen) string

// WSRelay manages proxied visitor WebSocket sessions for a single tunnel connection.
type WSRelay struct {
	defaultUpstream string
	subdomain       string
	writeBin        func(header any, body []byte) error
	writeJSON       func(v any) error
	resolve         UpstreamResolver
	pipeline        interface {
		NotifyWSFrame(subdomain, sessionID, direction string, isText bool, payload string, size int)
		NotifyWSSessionStart(subdomain, sessionID string, sender func(isText bool, payload []byte) error)
		NotifyWSSessionEnd(subdomain, sessionID string)
	}

	mu       sync.Mutex
	sessions map[string]*wsSession
}

func NewWSRelay(defaultUpstream string, subdomain string, writeBin func(header any, body []byte) error, writeJSON func(v any) error, resolve UpstreamResolver, pipeline interface {
	NotifyWSFrame(subdomain, sessionID, direction string, isText bool, payload string, size int)
	NotifyWSSessionStart(subdomain, sessionID string, sender func(isText bool, payload []byte) error)
	NotifyWSSessionEnd(subdomain, sessionID string)
}) *WSRelay {
	return &WSRelay{
		defaultUpstream: defaultUpstream,
		subdomain:       subdomain,
		writeBin:        writeBin,
		writeJSON:       writeJSON,
		resolve:         resolve,
		pipeline:        pipeline,
		sessions:        make(map[string]*wsSession),
	}
}

// HandleOpen dials the upstream WebSocket server and starts relaying frames.
func (r *WSRelay) HandleOpen(msg types.WSOpen) {
	upstream := r.defaultUpstream
	if r.resolve != nil {
		if u := r.resolve(msg); u != "" {
			upstream = u
		}
	}

	// Convert http(s) upstream to ws(s)
	parsed, err := url.Parse(upstream)
	if err != nil {
		log.Printf("WS open: bad upstream URL %q: %v", upstream, err)
		_ = r.writeJSON(types.WSClose{Type: types.TypeWSClose, ID: msg.ID, Code: 1011, Reason: "Bad upstream URL"})
		return
	}
	wsScheme := "ws"
	if parsed.Scheme == "https" {
		wsScheme = "wss"
	}
	localURL := fmt.Sprintf("%s://%s%s", wsScheme, parsed.Host, msg.Path)

	reqHeader := http.Header{}
	for k, vals := range msg.Headers {
		canonical := http.CanonicalHeaderKey(k)
		switch canonical {
		case "Upgrade", "Connection", "Sec-Websocket-Key",
			"Sec-Websocket-Version", "Sec-Websocket-Extensions",
			"Sec-Websocket-Protocol":
			continue // hop-by-hop; gorilla handles these
		default:
			reqHeader[canonical] = vals
		}
	}
	reqHeader.Set("Host", parsed.Host)

	dialer := websocket.Dialer{EnableCompression: true}
	localConn, _, err := dialer.Dial(localURL, reqHeader)
	if err != nil {
		log.Printf("WS open to %s failed for session %s: %v", upstream, msg.ID, err)
		_ = r.writeJSON(types.WSClose{
			Type:   types.TypeWSClose,
			ID:     msg.ID,
			Code:   1011,
			Reason: "Failed to connect to upstream WebSocket",
		})
		return
	}

	sess := &wsSession{conn: localConn}
	r.mu.Lock()
	r.sessions[msg.ID] = sess
	r.mu.Unlock()

	r.pipeline.NotifyWSSessionStart(r.subdomain, msg.ID, func(isText bool, payload []byte) error {
		if isText {
			return sess.writeMessage(websocket.TextMessage, payload)
		}
		return sess.writeMessage(websocket.BinaryMessage, payload)
	})

	go r.readLoop(msg.ID, sess)
}

func (r *WSRelay) readLoop(sessionID string, sess *wsSession) {
	defer func() {
		sess.conn.Close()
		r.mu.Lock()
		delete(r.sessions, sessionID)
		r.mu.Unlock()
		r.pipeline.NotifyWSSessionEnd(r.subdomain, sessionID)
	}()

	for {
		msgType, data, err := sess.conn.ReadMessage()
		if err != nil {
			closeCode := websocket.CloseNormalClosure
			closeReason := ""
			if ce, ok := err.(*websocket.CloseError); ok {
				closeCode = ce.Code
				closeReason = ce.Text
			}
			_ = r.writeJSON(types.WSClose{
				Type:   types.TypeWSClose,
				ID:     sessionID,
				Code:   closeCode,
				Reason: closeReason,
			})
			return
		}

		frame := types.WSFrame{Type: types.TypeWSFrame, ID: sessionID, IsText: msgType == websocket.TextMessage}
		if err := r.writeBin(frame, data); err != nil {
			log.Printf("Error sending ws-frame for session %s: %v", sessionID, err)
			return
		}
		r.pipeline.NotifyWSFrame(r.subdomain, sessionID, "out", frame.IsText, string(data), len(data))
	}
}

// HandleFrame forwards a tunnel frame to the local WebSocket.
func (r *WSRelay) HandleFrame(msg types.WSFrame) {
	r.mu.Lock()
	sess := r.sessions[msg.ID]
	r.mu.Unlock()
	if sess == nil {
		return
	}

	if msg.IsText {
		if err := sess.writeMessage(websocket.TextMessage, msg.Data); err != nil {
			log.Printf("Error writing text frame to local WS: %v", err)
		}
	} else {
		if err := sess.writeMessage(websocket.BinaryMessage, msg.Data); err != nil {
			log.Printf("Error writing binary frame to local WS: %v", err)
		}
	}
}

// HandleClose closes a local WebSocket session.
func (r *WSRelay) HandleClose(msg types.WSClose) {
	r.mu.Lock()
	sess := r.sessions[msg.ID]
	delete(r.sessions, msg.ID)
	r.mu.Unlock()
	if sess != nil {
		sess.writeMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(msg.Code, msg.Reason))
		sess.conn.Close()
	}
}
