import { useEffect, useState } from "react"
import { deleteNode, listCloudflareDomains, testSsh, updateNode } from "../api"

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="dns-copy-field">
      <span className="dns-copy-label">{label}</span>
      <code className="dns-copy-value">{value}</code>
      <button className="btn-copy" onClick={copy}>{copied ? "✓" : "Copiar"}</button>
    </div>
  )
}

function DnsRecord({ tipo, fields }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="dns-record">
      <div
        className="dns-record-tipo"
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <span>Tipo: <strong>{tipo}</strong></span>
        <span style={{ fontSize: "0.85em", color: "#8b949e" }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && fields.map(([label, value]) => (
        <CopyField key={label} label={label} value={value} />
      ))}
    </div>
  )
}

export default function NodeRow({ node, onChanged }) {
  const [open, setOpen] = useState(false)
  const [cloudflareDomainId, setCloudflareDomainId] = useState(node.cloudflare_domain_id || "")
  const [cloudflareDomains, setCloudflareDomains] = useState([])
  const [savingDomain, setSavingDomain] = useState(false)
  const [domainError, setDomainError] = useState(null)

  const [emailName, setEmailName] = useState(
    node.email_from ? node.email_from.split("@")[0] : ""
  )
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailError, setEmailError] = useState(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapResult, setBootstrapResult] = useState(null)
  const [bootstrapLog, setBootstrapLog] = useState([])

  const [verifying, setVerifying] = useState(false)
  const [dnsResults, setDnsResults] = useState(null)
  const [provisioningDns, setProvisioningDns] = useState(false)
  const [provisionResult, setProvisionResult] = useState(null)

  const [testEmailTo, setTestEmailTo] = useState("")
  const [sendingTest, setSendingTest] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState(null)

  const [panelUrl, setPanelUrl] = useState("http://localhost:8000")
  const [installingAgent, setInstallingAgent] = useState(false)
  const [agentLog, setAgentLog] = useState([])
  const [agentResult, setAgentResult] = useState(null)

  const [installingUnsub, setInstallingUnsub] = useState(false)
  const [unsubLog, setUnsubLog] = useState([])
  const [unsubResult, setUnsubResult] = useState(null)

  useEffect(() => {
    listCloudflareDomains().then(setCloudflareDomains).catch(() => setCloudflareDomains([]))
  }, [])

  async function readResponseBody(res) {
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  useEffect(() => {
    setCloudflareDomainId(node.cloudflare_domain_id || "")
  }, [node.cloudflare_domain_id])

  async function handleSaveDomain() {
    setSavingDomain(true)
    setDomainError(null)
    try {
      if (!cloudflareDomainId) {
        await updateNode(node.id, { cloudflare_domain_id: null, domain: null, email_from: null })
      } else {
        await updateNode(node.id, { cloudflare_domain_id: Number(cloudflareDomainId), email_from: null })
      }
      onChanged()
    } catch (err) {
      setDomainError(err.message)
    } finally {
      setSavingDomain(false)
    }
  }

  async function handleSaveEmail() {
    setSavingEmail(true)
    setEmailError(null)
    try {
      const fullEmail = emailName && node.domain ? `${emailName}@${node.domain}` : null
      await updateNode(node.id, { email_from: fullEmail })
      onChanged()
    } catch (err) {
      setEmailError(err.message)
    } finally {
      setSavingEmail(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      setTestResult(await testSsh(node.id))
    } finally {
      setTesting(false)
    }
  }

  async function handleVerifyDns() {
    setVerifying(true)
    setDnsResults(null)
    try {
      const res = await fetch(`/api/nodes/${node.id}/verify-dns`)
      const data = await res.json()
      setDnsResults(data.results)
    } catch (err) {
      setDnsResults([{ label: "Erro", ok: false, detail: err.message }])
    } finally {
      setVerifying(false)
    }
  }

  async function handleProvisionCloudflareDns(stage = "initial") {
    setProvisioningDns(true)
    setProvisionResult(null)
    try {
      const res = await fetch(`/api/nodes/${node.id}/provision-cloudflare?stage=${encodeURIComponent(stage)}`, { method: "POST" })
      const data = await readResponseBody(res)
      if (!res.ok) {
        setProvisionResult({
          success: false,
          message: data?.detail || data?.raw || "Falha ao criar DNS na Cloudflare",
        })
        return
      }
      setProvisionResult({
        success: true,
        message: `Cloudflare OK (${data.records?.length || 0} registros). Zona: ${data.zone_id}`,
        records: data.records || [],
      })
    } catch (err) {
      setProvisionResult({ success: false, message: err.message })
    } finally {
      setProvisioningDns(false)
    }
  }

  async function handleSendTest() {
    if (!testEmailTo.trim()) return
    setSendingTest(true)
    setTestEmailResult(null)
    try {
      const res = await fetch(`/api/nodes/${node.id}/send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmailTo.trim() }),
      })
      setTestEmailResult(await res.json())
    } catch (err) {
      setTestEmailResult({ success: false, message: err.message })
    } finally {
      setSendingTest(false)
    }
  }

  const [agentLogsOpen, setAgentLogsOpen] = useState(false)
  const [agentLogsText, setAgentLogsText] = useState("")
  const [loadingLogs, setLoadingLogs] = useState(false)

  async function handleViewLogs() {
    setLoadingLogs(true)
    setAgentLogsText("")
    setAgentLogsOpen(true)
    try {
      const res = await fetch(`/api/nodes/${node.id}/agent-logs?lines=200`)
      const data = await res.json()
      setAgentLogsText(data.output || "(sem saída)")
    } catch (err) {
      setAgentLogsText("Erro: " + err.message)
    } finally {
      setLoadingLogs(false)
    }
  }

  async function handleInstallAgent() {
    setInstallingAgent(true)
    setAgentLog([])
    setAgentResult(null)
    try {
      const resp = await fetch(`/api/nodes/${node.id}/install-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel_url: panelUrl }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        setAgentResult({ success: false, message: err.detail || "Erro" })
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === "done") {
              setAgentResult(evt)
              onChanged()
            } else {
              setAgentLog((prev) => [...prev, evt])
            }
          } catch {}
        }
      }
    } catch (err) {
      setAgentResult({ success: false, message: err.message })
    } finally {
      setInstallingAgent(false)
    }
  }

  async function handleRestartAgent() {
    setInstallingAgent(true)
    setAgentLog([])
    setAgentResult(null)
    try {
      const resp = await fetch(`/api/nodes/${node.id}/restart-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel_url: panelUrl }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        setAgentResult({ success: false, message: err.detail || "Erro" })
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === "done") {
              setAgentResult(evt)
              onChanged()
            } else {
              setAgentLog((prev) => [...prev, evt])
            }
          } catch {}
        }
      }
    } catch (err) {
      setAgentResult({ success: false, message: err.message })
    } finally {
      setInstallingAgent(false)
    }
  }

  async function handleInstallUnsub() {
    setInstallingUnsub(true)
    setUnsubLog([])
    setUnsubResult(null)
    try {
      const resp = await fetch(`/api/nodes/${node.id}/install-unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel_url: panelUrl }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        setUnsubResult({ success: false, message: err.detail || "Erro" })
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === "done") {
              setUnsubResult(evt)
            } else {
              setUnsubLog((prev) => [...prev, evt])
            }
          } catch {}
        }
      }
    } catch (err) {
      setUnsubResult({ success: false, message: err.message })
    } finally {
      setInstallingUnsub(false)
    }
  }

  async function handleBootstrap() {
    if (!confirm(`Isso vai instalar Postfix + opendkim em ${node.ip}. Confirma?`)) return
    setBootstrapping(true)
    setBootstrapResult(null)
    setBootstrapLog([])

    try {
      const resp = await fetch(`/api/nodes/${node.id}/bootstrap`, { method: "POST" })
      if (!resp.ok) {
        const err = await resp.json()
        setBootstrapResult({ success: false, message: err.detail || "Erro desconhecido" })
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            if (evt.type === "done") {
              setBootstrapResult(evt)
              onChanged()
            } else {
              setBootstrapLog((prev) => [...prev, evt])
            }
          } catch {}
        }
      }
    } catch (err) {
      setBootstrapResult({ success: false, message: err.message })
    } finally {
      setBootstrapping(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover ${node.hostname}?`)) return
    await deleteNode(node.id)
    onChanged()
  }

  // Status badge: verde se bootstrap ok, amarelo se domínio setado, cinza se vazio
  const statusDot = node.bootstrap_status === "success"
    ? "dot-green"
    : node.domain
    ? "dot-yellow"
    : "dot-gray"

  return (
    <div className={`node-card ${open ? "node-card-open" : ""}`}>
      <div className="node-card-header" onClick={() => setOpen((v) => !v)}>
        <div className="node-card-header-left">
          <span className={`status-dot ${statusDot}`} />
          <strong className="node-card-title">{node.hostname}</strong>
          <span className="node-card-meta">{node.ip}</span>
          <span className="node-card-badge">{node.role}</span>
          {node.tags && <span className="node-card-tags">{node.tags}</span>}
        </div>
        <div className="node-card-header-right">
          {node.domain && <span className="node-card-meta">{node.domain}</span>}
          {node.agent_status && (
            <span style={{
              fontSize: "0.72em", padding: "2px 7px", borderRadius: 10, fontWeight: 600,
              background: node.agent_status === "online" ? "#0d2e0d" : "#2e1a00",
              color: node.agent_status === "online" ? "#3fb950" : "#d29922",
              border: `1px solid ${node.agent_status === "online" ? "#3fb950" : "#d29922"}`,
            }}>
              {node.agent_status === "online" ? "● agent online" : "○ agent offline"}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}
            style={{
              padding: "6px 12px",
              fontSize: "0.85em",
              backgroundColor: "#dc3545",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "500"
            }}
          >
            Remover
          </button>
          <span className="node-card-chevron">{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div className="node-sections">
          {/* SSH */}
          <div className="node-section">
            <span className="node-section-label">SSH</span>
            <div className="node-section-info">{node.ssh_user}@{node.ip}:{node.ssh_port} <em>({node.auth_method})</em></div>
            <button onClick={handleTest} disabled={testing}>
              {testing ? "Testando..." : "Testar conexão"}
            </button>
            {node.domain && (
              <button onClick={handleVerifyDns} disabled={verifying} style={{ marginTop: 6 }}>
                {verifying ? "Verificando..." : "⟳ Verificar DNS"}
              </button>
            )}
            {testResult && (
              <div className={`section-result ${testResult.success ? "status-ok" : "status-err"}`}>
                {testResult.message}
                {testResult.output && <div className="ssh-output">{testResult.output}</div>}
              </div>
            )}
            {dnsResults && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                {dnsResults.map((r, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 6,
                    fontSize: "0.78em", fontFamily: "monospace",
                    padding: "3px 6px", borderRadius: 3,
                    background: r.ok ? "#0d2e0d" : "#2e0d0d",
                  }}>
                    <span style={{ color: r.ok ? "#3fb950" : "#f85149", fontWeight: "bold", minWidth: 12 }}>
                      {r.ok ? "✓" : "✗"}
                    </span>
                    <span style={{ color: r.ok ? "#3fb950" : "#f85149", minWidth: 100 }}>{r.label}</span>
                    <span style={{ color: "#aaa", wordBreak: "break-all" }}>{r.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Domínio */}
          <div className="node-section">
            <span className="node-section-label">Domínio</span>
            <div className="domain-row">
              <select value={cloudflareDomainId} onChange={(e) => setCloudflareDomainId(e.target.value)}>
                <option value="">Selecione um domínio</option>
                {cloudflareDomains.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.domain}
                  </option>
                ))}
              </select>
              <button onClick={handleSaveDomain} disabled={savingDomain}>
                {savingDomain ? "..." : "Salvar"}
              </button>
            </div>
            {cloudflareDomains.length === 0 && (
              <div className="node-card-meta">Cadastre domínios na aba Cloudflare para vincular à VPS.</div>
            )}
            {domainError && <div className="status-err">{domainError}</div>}

            {node.domain && (
              <div className="dns-hint">
                <div className="dns-hint-title">
                  Configure no DNS de <strong>{node.domain}</strong> antes do bootstrap:
                </div>

                <DnsRecord tipo="A" fields={[
                  ["Nome", "mail"],
                  ["Classe", "IN"],
                  ["TTL", "14400"],
                  ["IPv4", node.ip],
                ]} />

                <DnsRecord tipo="A (apex)" fields={[
                  ["Nome", "@"],
                  ["Classe", "IN"],
                  ["TTL", "300"],
                  ["IPv4", node.ip],
                ]} />

                <div className="dns-hint-note">
                  PTR (reverso): configurar no painel do seu provedor VPS, apontando {node.ip} → mail.{node.domain}<br />
                  No cadastro inicial: apenas <strong>A mail</strong> e <strong>A apex</strong>.<br />
                  Depois do bootstrap: adicionar <strong>MX</strong>, <strong>SPF</strong>, <strong>DKIM</strong> e <strong>DMARC</strong>.
                </div>
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => handleProvisionCloudflareDns("initial")} disabled={provisioningDns}>
                    {provisioningDns ? "Sincronizando DNS..." : "☁️ Criar DNS inicial"}
                  </button>
                </div>
                {provisionResult && (
                  <div className={`section-result ${provisionResult.success ? "status-ok" : "status-err"}`} style={{ marginTop: 8 }}>
                    <div>{provisionResult.message}</div>
                    {provisionResult.success && provisionResult.records?.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary>Ver registros aplicados</summary>
                        <div style={{ marginTop: 6, fontSize: "0.85em" }}>
                          {provisionResult.records.map((r, idx) => (
                            <div key={`${r.type}-${r.name}-${idx}`}>
                              [{r.status}] {r.type} {r.name} → {r.content}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}

            {node.bootstrap_status === "success" && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: "0.85em", color: "#666", marginBottom: 6 }}>Enviar email de teste:</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                    placeholder="destinatario@exemplo.com"
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={handleSendTest}
                    disabled={sendingTest || !testEmailTo.trim()}
                  >
                    {sendingTest ? "Enviando..." : "✉ Enviar"}
                  </button>
                </div>
                {testEmailResult && (
                  <div className={`section-result ${testEmailResult.success ? "status-ok" : "status-err"}`} style={{ marginTop: 6 }}>
                    {testEmailResult.message}
                  </div>
                )}
                <div style={{ marginTop: 12, borderTop: "1px solid #30363d", paddingTop: 10 }}>
                  <div style={{ fontSize: "0.85em", color: "#666", marginBottom: 6 }}>DNS pós-bootstrap:</div>
                  <button onClick={() => handleProvisionCloudflareDns("post_bootstrap")} disabled={provisioningDns}>
                    {provisioningDns ? "Sincronizando..." : "☁️ Criar registros finais"}
                  </button>
                  <div className="dns-hint-note" style={{ marginTop: 8 }}>
                    Isso adiciona MX, SPF, DKIM e DMARC usando os dados gerados no bootstrap.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bootstrap */}
          <div className="node-section">
            <span className="node-section-label">Bootstrap</span>

            {/* Email From dentro do Bootstrap */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.85em", color: "#666", marginBottom: 4 }}>Remetente:</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={emailName}
                  onChange={(e) => setEmailName(e.target.value)}
                  placeholder="suporte"
                  style={{ padding: "6px 8px", fontSize: "0.9em" }}
                  disabled={!node.domain}
                />
                <button onClick={handleSaveEmail} disabled={savingEmail || !node.domain}>
                  {savingEmail ? "..." : "Salvar"}
                </button>
              </div>
              {node.domain && (
                <div style={{ fontSize: "0.9em", color: "#666", marginTop: 4 }}>
                  {emailName}@{node.domain}
                </div>
              )}
              {!node.domain && (
                <div style={{ fontSize: "0.8em", color: "#d9534f", marginTop: 4 }}>
                  Preencha o domínio primeiro
                </div>
              )}
              {emailError && <div className="status-err">{emailError}</div>}
              {!node.email_from && node.domain && (
                <div style={{ fontSize: "0.8em", color: "#d9534f", marginTop: 4 }}>
                  Salve o remetente para liberar o bootstrap
                </div>
              )}
            </div>

            <button onClick={handleBootstrap} disabled={!node.domain || !node.email_from || bootstrapping}>
              {bootstrapping ? "Instalando..." : "▶ Bootstrap"}
            </button>

            {(bootstrapping || bootstrapLog.length > 0) && !bootstrapResult && (
              <div style={{
                marginTop: 10,
                background: "#0d1117",
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "monospace",
                fontSize: "0.78em",
                lineHeight: 1.7,
                maxHeight: 160,
                overflowY: "auto",
              }}>
                {bootstrapLog.map((evt, i) => {
                  const icon = evt.type === "ok" ? "✓" : evt.type === "error" ? "✗" : evt.type === "warn" ? "⚠" : "⟳"
                  const color = evt.type === "ok" ? "#3fb950" : evt.type === "error" ? "#f85149" : evt.type === "warn" ? "#d29922" : "#58a6ff"
                  return (
                    <div key={i} style={{ color }}>
                      <span style={{ marginRight: 6 }}>{icon}</span>{evt.message}
                    </div>
                  )
                })}
                {bootstrapping && bootstrapLog.length > 0 && (
                  <div style={{ color: "#58a6ff", opacity: 0.6 }}>⟳ aguardando...</div>
                )}
              </div>
            )}
            {node.bootstrap_status && !bootstrapResult && (
              <div className="node-card-meta" style={{ marginTop: 4 }}>
                último status: <strong>{node.bootstrap_status}</strong>
              </div>
            )}
            {bootstrapResult && (
              <div className={`section-result ${bootstrapResult.success ? "status-ok" : "status-err"}`}>
                <div>{bootstrapResult.message}</div>
                {bootstrapResult.log && (
                  <details className="bootstrap-log">
                    <summary>log completo</summary>
                    <pre>{bootstrapResult.log}</pre>
                  </details>
                )}
                {bootstrapResult.dkim_dns_record && (
                  <div className="dns-hint" style={{ marginTop: 8 }}>
                    <div className="dns-hint-title">Registrar DKIM no DNS:</div>
                    <DnsRecord tipo="TXT (DKIM)" fields={[
                      ["Nome", `${bootstrapResult.dkim_selector || node.dkim_selector}._domainkey`],
                      ["Classe", "IN"],
                      ["TTL", "14400"],
                      ["Texto", bootstrapResult.dkim_dns_record],
                    ]} />
                  </div>
                )}
                {bootstrapResult.dmarc_dns_record && (
                  <div className="dns-hint" style={{ marginTop: 8 }}>
                    <div className="dns-hint-title">Registrar DMARC no DNS:</div>
                    <DnsRecord tipo="TXT (DMARC)" fields={[
                      ["Nome", `_dmarc`],
                      ["Classe", "IN"],
                      ["TTL", "14400"],
                      ["Texto", bootstrapResult.dmarc_dns_record],
                    ]} />
                  </div>
                )}
                {bootstrapResult.tls_provider && (
                  <div className="node-card-meta" style={{ marginTop: 8 }}>
                    TLS: <strong>{bootstrapResult.tls_provider === "letsencrypt" ? "Let's Encrypt" : "self-signed (Let's Encrypt falhou, ver log)"}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Instalar Agente */}
            <div style={{ marginTop: 20, borderTop: "1px solid #e0e0e0", paddingTop: 14 }}>
              <span className="node-section-label" style={{ display: "block", marginBottom: 8 }}>Agente</span>
              <div style={{ fontSize: "0.82em", color: "#666", marginBottom: 6 }}>URL pública do painel:</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input
                  value={panelUrl}
                  onChange={(e) => setPanelUrl(e.target.value)}
                  placeholder="http://IP-DO-PAINEL:8000"
                  style={{ flex: 1, fontSize: "0.85em" }}
                />
                <button
                  onClick={handleInstallAgent}
                  disabled={installingAgent || !panelUrl.trim()}
                >
                  {installingAgent ? "Instalando..." : "⚙ Instalar Agente"}
                </button>
                <button
                  onClick={handleRestartAgent}
                  disabled={installingAgent || !panelUrl.trim() || !node.agent_token}
                  title={!node.agent_token ? "Instale o agente primeiro" : ""}
                >
                  {installingAgent ? "Reiniciando..." : "↻ Reiniciar"}
                </button>
                <button
                  onClick={handleViewLogs}
                  disabled={loadingLogs || !node.agent_token}
                  title={!node.agent_token ? "Instale o agente primeiro" : ""}
                  style={{ background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d" }}
                >
                  {loadingLogs ? "⟳ Carregando..." : "📋 Ver Logs"}
                </button>
              </div>
              {node.agent_status && !agentResult && (
                <div className="node-card-meta">
                  agente: <strong style={{ color: node.agent_status === "online" ? "#3fb950" : "#d29922" }}>
                    {node.agent_status}
                  </strong>
                  {node.agent_last_seen && <span> · último ping: {new Date(node.agent_last_seen).toLocaleTimeString()}</span>}
                  {node.agent_panel_url && <span> · URL: <code style={{ fontSize: "0.85em" }}>{node.agent_panel_url}</code></span>}
                </div>
              )}
              {(installingAgent || agentLog.length > 0) && !agentResult && (
                <div style={{
                  background: "#0d1117", borderRadius: 6, padding: "8px 10px",
                  fontFamily: "monospace", fontSize: "0.78em", lineHeight: 1.7,
                  maxHeight: 160, overflowY: "auto",
                }}>
                  {agentLog.map((evt, i) => {
                    const icon = evt.type === "ok" ? "✓" : evt.type === "error" ? "✗" : evt.type === "warn" ? "⚠" : "⟳"
                    const color = evt.type === "ok" ? "#3fb950" : evt.type === "error" ? "#f85149" : evt.type === "warn" ? "#d29922" : "#58a6ff"
                    return <div key={i} style={{ color }}><span style={{ marginRight: 6 }}>{icon}</span>{evt.message}</div>
                  })}
                  {installingAgent && <div style={{ color: "#58a6ff", opacity: 0.6 }}>⟳ aguardando...</div>}
                </div>
              )}
              {agentResult && (
                <div className={`section-result ${agentResult.success ? "status-ok" : "status-err"}`}>
                  {agentResult.message}
                </div>
              )}
            </div>

            {/* Unsubscribe */}
            {node.domain && node.id && (
              <div style={{ marginTop: 16, borderTop: "1px solid #e0e0e0", paddingTop: 12 }}>
                <span className="node-section-label" style={{ display: "block", marginBottom: 6 }}>🔕 Unsubscribe</span>
                <div style={{ fontSize: "0.8em", color: "#8b949e", marginBottom: 8 }}>
                  Instala a rota <code>/unsubscribe</code> no nginx da VPS. Os headers
                  são adicionados automaticamente em cada envio.
                </div>
                <button
                  onClick={() => { setUnsubResult(null); handleInstallUnsub() }}
                  disabled={installingUnsub || !panelUrl.trim()}
                  style={{
                    fontSize: "0.85em", borderRadius: 4, border: "none",
                    cursor: installingUnsub || !panelUrl.trim() ? "not-allowed" : "pointer",
                    background: installingUnsub ? "#1f6feb" : unsubResult?.success ? "#238636" : "#1f6feb",
                    color: "white", fontWeight: "bold",
                  }}
                >
                  {installingUnsub ? "⟳ Instalando..." : unsubResult?.success ? "↻ Reinstalar /unsubscribe" : "⚙ Instalar /unsubscribe"}
                </button>
                {(installingUnsub || unsubLog.length > 0) && !unsubResult && (
                  <div style={{
                    background: "#0d1117", borderRadius: 6, padding: "8px 10px",
                    fontFamily: "monospace", fontSize: "0.78em", lineHeight: 1.7,
                    maxHeight: 100, overflowY: "auto", marginTop: 8,
                  }}>
                    {unsubLog.map((evt, i) => {
                      const icon = evt.type === "ok" ? "✓" : evt.type === "error" ? "✗" : evt.type === "warn" ? "⚠" : "⟳"
                      const color = evt.type === "ok" ? "#3fb950" : evt.type === "error" ? "#f85149" : evt.type === "warn" ? "#d29922" : "#58a6ff"
                      return <div key={i} style={{ color }}>{icon} {evt.message}</div>
                    })}
                    {installingUnsub && <div style={{ color: "#58a6ff", opacity: 0.6 }}>⟳ aguardando...</div>}
                  </div>
                )}
                {unsubResult && (
                  <div className={`section-result ${unsubResult.success ? "status-ok" : "status-err"}`} style={{ marginTop: 6 }}>
                    {unsubResult.message}
                  </div>
                )}
              </div>
            )}

          </div>{/* fim Bootstrap section */}

        </div>
      )}

      {agentLogsOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999,
        }} onClick={() => setAgentLogsOpen(false)}>
          <div style={{
            background: "#0d1117", border: "1px solid #30363d", borderRadius: 8,
            width: "min(900px, 95vw)", maxHeight: "80vh",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px", borderBottom: "1px solid #30363d",
            }}>
              <span style={{ fontWeight: 600, color: "#c9d1d9", fontSize: "0.9em" }}>
                📋 Logs do agente — {node.hostname}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleViewLogs}
                  disabled={loadingLogs}
                  style={{ fontSize: "0.78em", padding: "3px 10px", background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 4, cursor: "pointer" }}
                >
                  {loadingLogs ? "⟳" : "↻ Atualizar"}
                </button>
                <button
                  onClick={() => setAgentLogsOpen(false)}
                  style={{ fontSize: "0.78em", padding: "3px 10px", background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d", borderRadius: 4, cursor: "pointer" }}
                >
                  ✕ Fechar
                </button>
              </div>
            </div>
            <pre style={{
              flex: 1, overflow: "auto", margin: 0,
              padding: "12px 16px", fontFamily: "monospace",
              fontSize: "0.75em", lineHeight: 1.6,
              color: "#c9d1d9", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>
              {loadingLogs ? "⟳ Carregando logs..." : agentLogsText}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
