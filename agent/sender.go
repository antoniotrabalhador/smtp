package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"mime"
	"mime/quotedprintable"
	"net/smtp"
	"strings"
	"time"
)

// SendResult holds per-recipient outcome.
type SendResult struct {
	To    string
	Error string
}

// jitteredDelay returns a duration with ±25% random jitter applied.
// This makes the send pattern less predictable to spam filters.
func jitteredDelay(base time.Duration) time.Duration {
	if base <= 0 {
		return 0
	}
	// Random value in [0, 50) → center at 25 → shift to [-25%, +25%]
	n, _ := rand.Int(rand.Reader, big.NewInt(50))
	jitterPct := n.Int64() - 25 // -25 to +24
	delta := time.Duration(int64(base) * jitterPct / 100)
	result := base + delta
	if result < time.Millisecond*100 {
		result = time.Millisecond * 100
	}
	return result
}

// SendBatch envia e-mails a todos os destinatários via Postfix local (127.0.0.1:25).
//
// Usa UMA conexão TCP persistente para o lote inteiro (SMTP multi-transação):
// cada mensagem começa com MAIL FROM e termina com o fechar do DATA writer,
// sem fechar a conexão TCP. O SMTP RFC permite múltiplas transações por sessão.
//
// Observação de spam: não há impacto pois a conexão é com o Postfix LOCAL.
// É o Postfix quem gerencia as conexões externas (e faz a entrega com DKIM, SPF etc.)
func SendBatch(ctx context.Context, task *Task) []SendResult {
	results := make([]SendResult, 0, len(task.Recipients))

	var baseDelay time.Duration
	if task.RatePerHour > 0 {
		baseDelay = time.Hour / time.Duration(task.RatePerHour)
	}

	start := time.Now()
	total := len(task.Recipients)

	// Tenta abrir uma única conexão persistente para o lote inteiro.
	// Em caso de falha usa sendOne (1 conexão por e-mail) como fallback.
	conn, err := openSMTPConn()
	if err != nil {
		log.Printf("[task %d] aviso: conexão persistente falhou (%v) — modo individual", task.ID, err)
	}
	if conn != nil {
		defer func() { _ = conn.Quit() }()
	}

	for i, to := range task.Recipients {
		// Verifica cancelamento antes de cada envio
		select {
		case <-ctx.Done():
			log.Printf("[task %d] cancelado após %d/%d envios — reportando parcial", task.ID, i, total)
			return results
		default:
		}

		result := SendResult{To: to}

		if conn != nil {
			err = sendOnePersistent(conn, task, to)
		} else {
			err = sendOne(task, to) // fallback: 1 conexão por e-mail
		}

		if err != nil {
			result.Error = err.Error()
			// Erro de conexão (EOF, broken pipe, etc.) → tenta reconectar
			if conn != nil && isConnError(err) {
				log.Printf("[task %d] conexão SMTP perdida, reconectando...", task.ID)
				_ = conn.Close()
				conn, err = openSMTPConn()
				if err != nil {
					log.Printf("[task %d] reconexão falhou: %v — modo individual", task.ID, err)
					conn = nil
				}
			}
		}
		results = append(results, result)

		// Log de progresso a cada 100 envios
		if (i+1)%100 == 0 || i+1 == total {
			elapsed := time.Since(start)
			realRate := 0.0
			if elapsed > 0 {
				realRate = float64(i+1) / elapsed.Hours()
			}
			log.Printf("[task %d] progresso %d/%d (%.0f/h real, %d/h alvo)",
				task.ID, i+1, total, realRate, task.RatePerHour)
		}

		if baseDelay > 0 && i+1 < total {
			// Usa select para que o delay também seja interrompível pelo ctx
			select {
			case <-ctx.Done():
				log.Printf("[task %d] cancelado durante espera após %d/%d envios", task.ID, i+1, total)
				return results
			case <-time.After(jitteredDelay(baseDelay)):
			}
		}
	}

	return results
}

func sendOne(task *Task, to string) error {
	msg := buildMessage(task, to)
	return sendToLocalPostfix(task.FromAddress, []string{to}, []byte(msg))
}

// openSMTPConn abre e inicializa uma conexão SMTP com o Postfix local.
func openSMTPConn() (*smtp.Client, error) {
	c, err := smtp.Dial("127.0.0.1:25")
	if err != nil {
		return nil, err
	}
	if err := c.Hello("localhost"); err != nil {
		_ = c.Close()
		return nil, err
	}
	return c, nil
}

// sendOnePersistent envia uma mensagem em uma conexão SMTP já aberta e inicializada.
// Após o DATA ser aceito, a conexão permanece aberta para a próxima transação.
// Em caso de erro no RCPT (destinatário inválido), faz RSET para limpar o estado
// da transação sem precisar reconectar.
func sendOnePersistent(c *smtp.Client, task *Task, to string) error {
	msg := buildMessage(task, to)

	if err := c.Mail(task.FromAddress); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		// RCPT falhou (ex: domínio inexistente) — reseta a transação SMTP
		// para que a próxima mensagem parta de um estado limpo
		_ = c.Reset()
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		_ = w.Close()
		return err
	}
	return w.Close()
}

// isConnError retorna true se o erro indica que a conexão TCP foi perdida.
// Nesses casos, reconectar é a ação correta. Erros SMTP normais (5xx) não
// são erros de conexão e não precisam de reconexão.
func isConnError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "EOF") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "i/o timeout") ||
		strings.Contains(msg, "use of closed network connection")
}

func sendToLocalPostfix(from string, to []string, msg []byte) error {
	client, err := smtp.Dial("127.0.0.1:25")
	if err != nil {
		return err
	}
	defer client.Close()

	if err := client.Hello("localhost"); err != nil {
		return err
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	for _, recipient := range to {
		if err := client.Rcpt(recipient); err != nil {
			return err
		}
	}

	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(msg); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func randomMessageID(domain string) string {
	b := make([]byte, 16)
	rand.Read(b)
	return fmt.Sprintf("<%s@%s>", hex.EncodeToString(b), domain)
}

func extractDomain(email string) string {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return "localhost"
}

// generateProtocol gera uma string de 10 dígitos embaralhados aleatoriamente.
// Usada como variável {{protocol}} nos templates para adicionar entropia ao conteúdo
// e dificultar detecção de padrões por filtros de spam baseados em hash.
// Lê todos os bytes aleatórios em UMA única chamada ao invés de 9 alocações.
func generateProtocol() string {
	digits := []byte("0123456789")
	b := make([]byte, len(digits)) // 1 alocação para todos os bytes aleatórios
	rand.Read(b)
	for i := len(digits) - 1; i > 0; i-- {
		j := int(b[i]) % (i + 1) // Fisher-Yates com bytes pré-lidos
		digits[i], digits[j] = digits[j], digits[i]
	}
	return string(digits)
}

func replaceTags(s, to string, task *Task, protocol string) string {
	domain := extractDomain(to)
	s = strings.ReplaceAll(s, "{{email}}", to)
	s = strings.ReplaceAll(s, "{{domain}}", domain)
	s = strings.ReplaceAll(s, "{{protocol}}", protocol)
	s = strings.ReplaceAll(s, "{{subject}}", task.Subject)
	if task.CtaURL != "" {
		s = strings.ReplaceAll(s, "{{cta_url}}", task.CtaURL)
	}
	if task.UnsubscribeURL != "" {
		// A URL de unsubscribe pode conter {{email}} — resolve antes de substituir
		unsubResolved := strings.ReplaceAll(task.UnsubscribeURL, "{{email}}", to)
		s = strings.ReplaceAll(s, "{{unsubscribe_url}}", unsubResolved)
	}
	return s
}

func encodeQuotedPrintable(s string) string {
	var buf bytes.Buffer
	writer := quotedprintable.NewWriter(&buf)
	_, _ = writer.Write([]byte(s))
	_ = writer.Close()
	return buf.String()
}

func buildMessage(task *Task, to string) string {
	var sb strings.Builder

	domain := extractDomain(task.FromAddress)
	msgID := randomMessageID(domain)
	now := time.Now()
	protocol := generateProtocol()

	// ── Core headers ──────────────────────────────────────────────────────────
	subject := replaceTags(task.Subject, to, task, protocol)
	html := replaceTags(task.HTML, to, task, protocol)
	plain := replaceTags(task.PlainText, to, task, protocol)

	sb.WriteString(fmt.Sprintf("From: %s\r\n", task.FromAddress))
	sb.WriteString(fmt.Sprintf("To: %s\r\n", to))
	sb.WriteString(fmt.Sprintf("Subject: %s\r\n", mime.QEncoding.Encode("UTF-8", subject)))
	sb.WriteString(fmt.Sprintf("Date: %s\r\n", now.Format(time.RFC1123Z)))
	sb.WriteString(fmt.Sprintf("Message-ID: %s\r\n", msgID))

	// ── Routing / bounce headers ──────────────────────────────────────────────
	sb.WriteString(fmt.Sprintf("Return-Path: <%s>\r\n", task.FromAddress))

	// ── Bulk / list headers ───────────────────────────────────────────────────
	sb.WriteString("Precedence: bulk\r\n")
	sb.WriteString(fmt.Sprintf("List-ID: <newsletter.%s>\r\n", domain))

	// ── Unsubscribe (RFC 8058 One-Click) ─────────────────────────────────────
	if task.UnsubscribeURL != "" {
		unsubTo := replaceTags(task.UnsubscribeURL, to, task, protocol)
		sb.WriteString(fmt.Sprintf("List-Unsubscribe: <%s>\r\n", unsubTo))
		sb.WriteString("List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n")
	}

	// ── Feedback-ID (Gmail spam report tracking) ──────────────────────────────
	if task.FeedbackID != "" {
		sb.WriteString(fmt.Sprintf("Feedback-ID: %s\r\n", task.FeedbackID))
	}

	// ── Anti-spam signals ─────────────────────────────────────────────────────
	sb.WriteString("X-Priority: 3\r\n")
	sb.WriteString("X-Mailer: SMTP-Fleet/1.0\r\n")

	// ── MIME multipart/alternative (HTML + plain text) ────────────────────────
	boundary := fmt.Sprintf("boundary_%s", hex.EncodeToString([]byte(msgID))[:16])
	sb.WriteString("MIME-Version: 1.0\r\n")

	if task.HTML != "" && plain != "" {
		sb.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", boundary))
		sb.WriteString("\r\n")

		// Plain text part
		sb.WriteString(fmt.Sprintf("--%s\r\n", boundary))
		sb.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		sb.WriteString("\r\n")
		sb.WriteString(encodeQuotedPrintable(plain))
		sb.WriteString("\r\n")

		// HTML part
		sb.WriteString(fmt.Sprintf("--%s\r\n", boundary))
		sb.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		sb.WriteString("\r\n")
		sb.WriteString(encodeQuotedPrintable(html))
		sb.WriteString("\r\n")

		sb.WriteString(fmt.Sprintf("--%s--\r\n", boundary))
	} else if task.HTML != "" {
		sb.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		sb.WriteString("\r\n")
		sb.WriteString(encodeQuotedPrintable(html))
	} else {
		sb.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		sb.WriteString("\r\n")
		sb.WriteString(encodeQuotedPrintable(replaceTags(task.Body, to, task, protocol)))
	}

	return sb.String()
}
