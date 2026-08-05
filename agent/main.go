package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const version = "1.1.0"

func main() {
	cfg := loadConfig()
	client := NewPanelClient(cfg.PanelURL, cfg.NodeID, cfg.Token)

	log.Printf("[agent v%s] node_id=%d panel=%s poll=%ds", version, cfg.NodeID, cfg.PanelURL, cfg.PollSecs)

	// ── Contexto de cancelamento para shutdown gracioso ──────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Captura SIGTERM e SIGINT (systemctl stop / Ctrl+C)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		sig := <-sigCh
		log.Printf("[agent] sinal %v recebido — aguardando tarefa em andamento antes de encerrar...", sig)
		cancel() // sinaliza para o loop principal e para SendBatch
	}()

	// ── Variáveis de controle da tarefa atual ────────────────────────────────
	var isBusy int32
	var currentTaskID int32
	var currentTaskCancel context.CancelFunc
	var mu sync.Mutex // Protege currentTaskCancel e currentTaskID
	var wg sync.WaitGroup

	// ── Heartbeat em goroutine própria ───────────────────────────────────────
	// Roda independentemente do loop de envio — nunca é bloqueado por SendBatch.
	go func() {
		// Heartbeat imediato ao iniciar
		if resp, err := client.Heartbeat(0); err != nil {
			log.Printf("[warn] heartbeat falhou: %v", err)
		} else if resp.AbortTaskID > 0 {
			// Ignora no start
		}

		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				activeTask := int(atomic.LoadInt32(&currentTaskID))
				resp, err := client.Heartbeat(activeTask)
				if err != nil {
					log.Printf("[warn] heartbeat falhou: %v", err)
					continue
				}

				if resp.AbortTaskID > 0 {
					mu.Lock()
					if currentTaskCancel != nil && atomic.LoadInt32(&currentTaskID) == int32(resp.AbortTaskID) {
						log.Printf("[agent] recebida ordem de PAUSAR/ABORTAR tarefa %d!", resp.AbortTaskID)
						currentTaskCancel()
					}
					mu.Unlock()
				}
			}
		}
	}()

	// ── Loop de polling de tarefas ───────────────────────────────────────────

	pollTicker := time.NewTicker(time.Duration(cfg.PollSecs) * time.Second)
	defer pollTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			// Aguarda o envio atual terminar antes de sair (garante o report)
			log.Println("[agent] aguardando conclusão da tarefa em andamento...")
			wg.Wait()
			log.Println("[agent] encerrado com sucesso.")
			os.Exit(0)

		case <-pollTicker.C:
			// Se já há uma tarefa rodando, não pega outra
			if atomic.LoadInt32(&isBusy) == 1 {
				continue
			}

			task, err := client.PollTask()
			if err != nil {
				log.Printf("[warn] erro no poll: %v", err)
				continue
			}
			if task == nil {
				continue // sem tarefa disponível
			}

			log.Printf("[task %d] %d destinatários rate=%d/h assunto=%q",
				task.ID, len(task.Recipients), task.RatePerHour, task.Subject)

			atomic.StoreInt32(&isBusy, 1)
			atomic.StoreInt32(&currentTaskID, int32(task.ID))
			
			taskCtx, taskCancel := context.WithCancel(ctx)
			mu.Lock()
			currentTaskCancel = taskCancel
			mu.Unlock()
			
			wg.Add(1)
			go func(t *Task) {
				defer wg.Done()
				defer func() {
					mu.Lock()
					currentTaskCancel = nil
					mu.Unlock()
					atomic.StoreInt32(&isBusy, 0)
					atomic.StoreInt32(&currentTaskID, 0)
				}()

				results := SendBatch(taskCtx, t)
				report := buildReport(results)

				if err := client.ReportTask(t.ID, report); err != nil {
					log.Printf("[warn] falha ao reportar task %d: %v", t.ID, err)
				} else {
					log.Printf("[task %d] concluída enviados=%d erros=%d", t.ID, report.SentCount, report.ErrorCount)
				}
			}(task)
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
