package main

import (
	"bytes"
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

// SendBatch sends emails to all recipients via the local Postfix (localhost:25).
// It respects ratePerHour by spacing sends with jitter; 0 means no limit.
func SendBatch(task *Task) []SendResult {
	results := make([]SendResult, 0, len(task.Recipients))

	var baseDelay time.Duration
	if task.RatePerHour > 0 {
		baseDelay = time.Hour / time.Duration(task.RatePerHour)
	}

	start := time.Now()
	total := len(task.Recipients)

	for i, to := range task.Recipients {
		err := sendOne(task, to)
		result := SendResult{To: to}
		if err != nil {
			result.Error = err.Error()
		}
		results = append(results, result)

		// Progress log every 100 sends
		if (i+1)%100 == 0 || i+1 == total {
			elapsed := time.Since(start)
			realRate := 0.0
			if elapsed > 0 {
				realRate = float64(i+1) / elapsed.Hours()
			}
			log.Printf("[task %d] progress %d/%d (%.0f/h real, %d/h target)",
				task.ID, i+1, total, realRate, task.RatePerHour)
		}

		if baseDelay > 0 && i+1 < total {
			time.Sleep(jitteredDelay(baseDelay))
		}
	}

	return results
}

func sendOne(task *Task, to string) error {
	msg := buildMessage(task, to)
	return sendToLocalPostfix(task.FromAddress, []string{to}, []byte(msg))
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

func generateProtocol() string {
	digits := []byte("0123456789")
	for i := len(digits) - 1; i > 0; i-- {
		b := make([]byte, 1)
		rand.Read(b)
		j := int(b[0]) % (i + 1)
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
