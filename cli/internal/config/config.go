package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const DefaultWorkerURL = "https://tunnel.prod.bd"

func GetWorkerURL() string {
	if v := os.Getenv("WORKER_URL"); v != "" {
		return v
	}
	return DefaultWorkerURL
}

func GetClientID() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user home directory: %w", err)
	}

	configDir := filepath.Join(homeDir, ".prod")
	idFile := filepath.Join(configDir, "id")

	// Check if ID file exists
	if _, err := os.Stat(idFile); err == nil {
		data, err := os.ReadFile(idFile)
		if err != nil {
			return "", fmt.Errorf("failed to read id file: %w", err)
		}
		return strings.TrimSpace(string(data)), nil
	}

	// Create directory if not exists
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %w", err)
	}

	// Generate new ID
	id, err := generateID()
	if err != nil {
		return "", fmt.Errorf("failed to generate id: %w", err)
	}

	// Save ID
	if err := os.WriteFile(idFile, []byte(id), 0644); err != nil {
		return "", fmt.Errorf("failed to write id file: %w", err)
	}

	return id, nil
}

func generateID() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// host.docker.internal is not available in Linux
func GetTargetHost() string {
	if os.Getenv("NET_HOST") == "false" {
		return "host.docker.internal"
	}
	return "localhost"
}
