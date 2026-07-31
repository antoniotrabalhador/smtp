package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
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

	// Overrides por variável de ambiente (priority sobre flags)
	if v := os.Getenv("PANEL_URL"); v != "" {
		*panelURL = v
	}
	if v := os.Getenv("NODE_TOKEN"); v != "" {
		*token = v
	}
	// NODE_ID via env var — consistência com PANEL_URL e NODE_TOKEN
	if v := os.Getenv("NODE_ID"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			*nodeID = parsed
		} else {
			fmt.Fprintf(os.Stderr, "NODE_ID inválido: %q (deve ser um inteiro)\n", v)
			os.Exit(1)
		}
	}

	if *panelURL == "" || *nodeID == 0 || *token == "" {
		fmt.Fprintln(os.Stderr, "Usage: agent -panel <url> -node-id <id> -token <token>")
		fmt.Fprintln(os.Stderr, "Or set PANEL_URL, NODE_TOKEN and NODE_ID env vars.")
		os.Exit(1)
	}

	return Config{
		PanelURL: *panelURL,
		NodeID:   *nodeID,
		Token:    *token,
		PollSecs: *pollSecs,
	}
}
