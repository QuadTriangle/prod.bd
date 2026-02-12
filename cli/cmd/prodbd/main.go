package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"prodbd/internal/config"
	"prodbd/internal/hooks"
	"prodbd/internal/tunnel"
	"strconv"
	"sync"
	"syscall"
)

func main() {
	pipeline := &hooks.Pipeline{}

	// --- Register plugins ---
	// Each plugin owns its own flags and config.
	// To add a new feature, just add a line here:
	//   pipeline.RegisterPlugin(inspector.New())
	//   pipeline.RegisterPlugin(qrcode.New())
	//   pipeline.RegisterPlugin(auth.New())

	// Let plugins register their flags, then parse
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [flags] <port> [port...]\n\nFlags:\n", os.Args[0])
		flag.PrintDefaults()
	}
	pipeline.RegisterFlags(flag.CommandLine)
	flag.Parse()

	args := flag.Args()
	if len(args) < 1 {
		flag.Usage()
		os.Exit(1)
	}

	ports := make([]int, 0, len(args))
	for _, arg := range args {
		port, err := strconv.Atoi(arg)
		if err != nil {
			log.Fatalf("Invalid port: %s", arg)
		}
		ports = append(ports, port)
	}

	// Activate enabled plugins (collect hooks)
	pipeline.Activate()

	workerURL := config.GetWorkerURL()

	// 1. Get Client ID
	clientID, err := config.GetClientID()
	if err != nil {
		log.Fatalf("Failed to get client ID: %v", err)
	}

	// 2. Register Ports (with merged plugin config)
	log.Println("Registering ports...")
	mapping, err := tunnel.Register(clientID, ports, workerURL, pipeline.WorkerConfig())
	if err != nil {
		log.Fatalf("Failed to register ports: %v", err)
	}

	// 3. Print Mappings
	fmt.Println("\n--- Tunnel Mappings ---")
	for port, sub := range mapping {
		fmt.Printf("http://localhost:%d  ->  https://%s.prod.bd\n", port, sub)
	}
	fmt.Println("-----------------------")

	// 4. Graceful shutdown setup
	done := make(chan struct{})
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Printf("Received %v, shutting down...", sig)
		close(done)
	}()

	// 5. Start Tunnels
	var wg sync.WaitGroup
	for port, sub := range mapping {
		wg.Add(1)
		go func(p int, s string) {
			defer wg.Done()
			tunnel.StartTunnel(s, p, workerURL, pipeline, done)
		}(port, sub)
	}

	wg.Wait()
	log.Println("All tunnels closed. Goodbye!")
}
