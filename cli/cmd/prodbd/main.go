package main

import (
	"fmt"
	"log"
	"os"
	"prodbd/internal/config"
	"prodbd/internal/tunnel"
	"strconv"
	"sync"
)

// Default worker URL, can be overridden by env var
const DefaultWorkerURL = "https://tunnel.prod.bd"

func main() {
	if len(os.Args) < 2 {
		fmt.Printf("Usage: %s <port> [port...]\n", os.Args[0])
		os.Exit(1)
	}

	ports := make([]int, 0)
	for _, arg := range os.Args[1:] {
		port, err := strconv.Atoi(arg)
		if err != nil {
			log.Fatalf("Invalid port: %s", arg)
		}
		ports = append(ports, port)
	}

	workerURL := os.Getenv("WORKER_URL")
	if workerURL == "" {
        // Warn user if using default placeholder
		// if DefaultWorkerURL == "https://tunnel.prod.bd" {
        //     log.Println("WARNING: Using placeholder Worker URL. Set WORKER_URL environment variable or update code.")
        // }
		workerURL = DefaultWorkerURL
	}
    // Update the package variable (not ideal but works for simple CLI)
    tunnel.WorkerURL = workerURL

	// 1. Get Client ID
	clientID, err := config.GetClientID()
	if err != nil {
		log.Fatalf("Failed to get client ID: %v", err)
	}
	log.Printf("Client ID: %s", clientID)

	// 2. Register Ports
	log.Println("Registering ports...")
	mapping, err := tunnel.Register(clientID, ports, workerURL)
    if err != nil {
        log.Fatalf("Failed to register ports: %v", err)
    }

    // 3. Print Mappings
    fmt.Println("\n--- Tunnel Mappings ---")
    for port, subdomain := range mapping {
        fmt.Printf("http://localhost:%d  ->  https://%s.prod.bd\n", port, subdomain)
    }
    fmt.Println("-----------------------")

    // 4. Start Tunnels
    var wg sync.WaitGroup
    for port, subdomain := range mapping {
        wg.Add(1)
        go func(p int, s string) {
            defer wg.Done()
            tunnel.StartTunnel(s, p, workerURL)
        }(port, subdomain)
    }

    wg.Wait()
}
