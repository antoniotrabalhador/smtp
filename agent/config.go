package main

import (
	"flag"
	"fmt"
	"os"
)

type Config struct {
	PanelURL string
	NodeID   int
	Token    string
	PollSecs int
}

func loadConfig() Config {
	panelURL := flag.String("panel", "", "Panel base URL (e.g. https://panel.example.com)")
	nodeID := flag.Int("node-id", 0, "Node ID assigned by the panel")
	token := flag.String("token", "", "Agent auth token")
	pollSecs := flag.Int("poll", 10, "Polling interval in seconds")
	flag.Parse()

	// Allow env var overrides
	if v := os.Getenv("PANEL_URL"); v != "" {
		*panelURL = v
	}
	if v := os.Getenv("NODE_TOKEN"); v != "" {
		*token = v
	}

	if *panelURL == "" || *nodeID == 0 || *token == "" {
		fmt.Fprintln(os.Stderr, "Usage: agent -panel <url> -node-id <id> -token <token>")
		fmt.Fprintln(os.Stderr, "Or set PANEL_URL and NODE_TOKEN env vars.")
		os.Exit(1)
	}

	return Config{
		PanelURL: *panelURL,
		NodeID:   *nodeID,
		Token:    *token,
		PollSecs: *pollSecs,
	}
}
