package hooks

import (
	"flag"
	"fmt"

	qrcode "github.com/skip2/go-qrcode"
)

// QRCodePlugin prints a scannable QR code to the terminal on connect.
type QRCodePlugin struct {
	enabled bool
}

func NewQRCodePlugin() *QRCodePlugin { return &QRCodePlugin{} }

func (q *QRCodePlugin) Name() string { return "qrcode" }

func (q *QRCodePlugin) RegisterFlags(fs *flag.FlagSet) {
	fs.BoolVar(&q.enabled, "qr", false, "Print QR code for tunnel URL on connect")
}

func (q *QRCodePlugin) Enabled() bool                       { return q.enabled }
func (q *QRCodePlugin) WorkerConfig() map[string]any         { return nil }
func (q *QRCodePlugin) RequestHooks() []RequestHook          { return nil }
func (q *QRCodePlugin) WSHooks() []WSHook                    { return nil }
func (q *QRCodePlugin) ProxyHooks() []ProxyHook              { return nil }
func (q *QRCodePlugin) ExtraPorts() []int                    { return nil }

func (q *QRCodePlugin) ConnectionHooks() []ConnectionHook {
	return []ConnectionHook{&qrConnHook{}}
}

type qrConnHook struct{ NoOpConnectionHook }

func (h *qrConnHook) OnConnect(subdomain string, _ int) {
	tunnelURL := fmt.Sprintf("https://%s.prod.bd", subdomain)
	qr, err := qrcode.New(tunnelURL, qrcode.Medium)
	if err != nil {
		fmt.Printf("(qr) failed to generate QR code: %v\n", err)
		return
	}
	fmt.Printf("\nScan to open %s:\n\n%s\n", tunnelURL, qr.ToSmallString(false))
}
