package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

const version = "1.0.0"

func main() {
	cfg := loadConfig()
	client := NewPanelClient(cfg.PanelURL, cfg.NodeID, cfg.Token)

	log.Printf("[agent v%s] node_id=%d panel=%s poll=%ds", version, cfg.NodeID, cfg.PanelURL, cfg.PollSecs)

	ticker := time.NewTicker(time.Duration(cfg.PollSecs) * time.Second)
	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	defer heartbeatTicker.Stop()

	// Initial heartbeat
	if err := client.Heartbeat(); err != nil {
		log.Printf("[warn] heartbeat failed: %v", err)
	}

	for {
		select {
		case <-heartbeatTicker.C:
			if err := client.Heartbeat(); err != nil {
				log.Printf("[warn] heartbeat failed: %v", err)
			}

		case <-ticker.C:
			task, err := client.PollTask()
			if err != nil {
				log.Printf("[warn] poll error: %v", err)
				continue
			}
			if task == nil {
				continue // nothing to do
			}

			log.Printf("[task %d] %d recipients rate=%d/h subject=%q",
				task.ID, len(task.Recipients), task.RatePerHour, task.Subject)

			results := SendBatch(task)

			report := buildReport(results)
			if err := client.ReportTask(task.ID, report); err != nil {
				log.Printf("[warn] report failed: %v", err)
			} else {
				log.Printf("[task %d] done sent=%d errors=%d", task.ID, report.SentCount, report.ErrorCount)
			}
		}
	}
}

func buildReport(results []SendResult) TaskReport {
	var logLines []string
	sent, errs := 0, 0
	for _, r := range results {
		if r.Error != "" {
			errs++
			logLines = append(logLines, fmt.Sprintf("ERR %s: %s", r.To, r.Error))
		} else {
			sent++
			logLines = append(logLines, fmt.Sprintf("OK  %s", r.To))
		}
	}
	return TaskReport{
		SentCount:  sent,
		ErrorCount: errs,
		Log:        strings.Join(logLines, "\n"),
	}
}
