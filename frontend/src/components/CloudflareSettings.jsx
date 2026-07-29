import { useEffect, useState } from "react"
import {
  deleteCloudflareDomainRecord,
  getCloudflareConfig,
  importCloudflareZones,
  listCloudflareDomainRecords,
  listCloudflareDomains,
  testCloudflareConfig,
  updateCloudflareConfig,
} from "../api"

export default function CloudflareSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [token, setToken] = useState("")
  const [status, setStatus] = useState(null)
  const [hasToken, setHasToken] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [domains, setDomains] = useState([])
  const [openDomainId, setOpenDomainId] = useState(null)
  const [loadingRecordsId, setLoadingRecordsId] = useState(null)
  const [deletingRecordId, setDeletingRecordId] = useState(null)
  const [recordsByDomainId, setRecordsByDomainId] = useState({})

  async function load() {
    setLoading(true)
    setStatus(null)
    try {
      const [cfg, items] = await Promise.all([getCloudflareConfig(), listCloudflareDomains()])
      setHasToken(Boolean(cfg.has_token))
      setUpdatedAt(cfg.updated_at || null)
      setDomains(items || [])
    } catch (err) {
      setStatus({ ok: false, message: err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSave() {
    setSaving(true)
    setStatus(null)
    try {
      if (!token.trim()) {
        setStatus({ ok: false, message: "Cole um API Token para salvar." })
        return
      }
      const cfg = await updateCloudflareConfig({ api_token: token.trim() })
      const sync = await importCloudflareZones()
      const items = await listCloudflareDomains()
      setHasToken(Boolean(cfg.has_token))
      setUpdatedAt(cfg.updated_at || null)
      setDomains(items || [])
      setToken("")
      setStatus({
        ok: true,
        message: `Token salvo. Domínios sincronizados: novos ${sync.created}, atualizados ${sync.updated}.`,
      })
    } catch (err) {
      setStatus({ ok: false, message: err.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleClearToken() {
    setSaving(true)
    setStatus(null)
    try {
      const cfg = await updateCloudflareConfig({ clear_token: true })
      setHasToken(Boolean(cfg.has_token))
      setUpdatedAt(cfg.updated_at || null)
      setDomains([])
      setRecordsByDomainId({})
      setOpenDomainId(null)
      setToken("")
      setStatus({ ok: true, message: "Token removido." })
    } catch (err) {
      setStatus({ ok: false, message: err.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setStatus(null)
    try {
      const resp = await testCloudflareConfig()
      setStatus({
        ok: true,
        message: `Conexão OK. Token: ${resp.token_status}.`,
      })
    } catch (err) {
      setStatus({ ok: false, message: err.message })
    } finally {
      setTesting(false)
    }
  }

  async function loadDomainRecords(domainId) {
    setLoadingRecordsId(domainId)
    try {
      const data = await listCloudflareDomainRecords(domainId)
      const records = data.records || []
      setRecordsByDomainId((prev) => ({ ...prev, [domainId]: records }))
      return records
    } finally {
      setLoadingRecordsId(null)
    }
  }

  async function toggleDomainRecords(domainId) {
    if (openDomainId === domainId) {
      setOpenDomainId(null)
      return
    }
    setOpenDomainId(domainId)
    if (recordsByDomainId[domainId]) return
    try {
      await loadDomainRecords(domainId)
    } catch (err) {
      setStatus({ ok: false, message: err.message })
    }
  }

  async function handleDeleteRecord(domainId, record) {
    const label = `${record.type} ${record.name}`
    if (!window.confirm(`Excluir o registro ${label}?`)) {
      return
    }

    setDeletingRecordId(record.id)
    setStatus(null)
    try {
      await deleteCloudflareDomainRecord(domainId, record.id)
      await loadDomainRecords(domainId)
      setStatus({ ok: true, message: `Registro excluído: ${label}.` })
    } catch (err) {
      setStatus({ ok: false, message: err.message })
    } finally {
      setDeletingRecordId(null)
    }
  }

  if (loading) return <p style={{ color: "#8b949e" }}>Carregando configuração Cloudflare...</p>

  return (
    <div className="add-node-form" style={{ maxWidth: 760, gridTemplateColumns: "1fr 1fr" }}>
      <h2>Domínios</h2>
      <p className="full-width" style={{ color: "#8b949e", fontSize: "0.9em", margin: "0 0 8px 0" }}>
        Configure somente o API Token para liberar automações na VPS Manager.
      </p>

      <label className="full-width">
        API Token
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasToken ? "•••••••••••• (token salvo)" : "cole o token com Zone:DNS:Edit"}
        />
      </label>

      <div className="form-actions full-width" style={{ marginTop: 4 }}>
        <button onClick={handleSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button onClick={handleTest} disabled={testing || saving}>
          {testing ? "Testando..." : "Testar conexão"}
        </button>
        <button onClick={handleClearToken} disabled={saving} style={{ background: "#2d1616", color: "#ffb3b3" }}>
          Remover token
        </button>
      </div>

      {updatedAt && (
        <p className="full-width node-card-meta">Última atualização: {new Date(updatedAt).toLocaleString()}</p>
      )}
      {status && (
        <div className={`full-width section-result ${status.ok ? "status-ok" : "status-err"}`}>{status.message}</div>
      )}
      <div className="full-width" style={{ marginTop: 12, borderTop: "1px solid #30363d", paddingTop: 12 }}>
        <h3 style={{ margin: "0 0 10px 0" }}>Domínios sincronizados</h3>
        {domains.length === 0 ? (
          <p className="node-card-meta">Nenhum domínio sincronizado ainda.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {domains.map((item) => (
              <div key={item.id}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    border: "1px solid #30363d",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: "#0d1117",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{item.domain}</div>
                    <div className="node-card-meta" style={{ marginTop: 2 }}>
                      zone: {item.zone_id || "auto"}
                    </div>
                  </div>
                  <button onClick={() => toggleDomainRecords(item.id)}>
                    {openDomainId === item.id ? "▲ Ocultar DNS" : "▼ Ver DNS"}
                  </button>
                </div>
                {openDomainId === item.id && (
                  <div style={{ marginTop: 6, border: "1px solid #30363d", borderRadius: 8, padding: "8px 10px", background: "#11161c" }}>
                    {loadingRecordsId === item.id ? (
                      <div className="node-card-meta">Carregando registros...</div>
                    ) : (recordsByDomainId[item.id] || []).length === 0 ? (
                      <div className="node-card-meta">Nenhum registro encontrado.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        {(recordsByDomainId[item.id] || []).map((r) => (
                          <div key={r.id} style={{ fontSize: "0.82em", fontFamily: "monospace", border: "1px solid #2a3340", borderRadius: 6, padding: "6px 8px", background: "#0d1117" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                              <div>
                                <div><strong>{r.type}</strong> {r.name}</div>
                                <div style={{ color: "#9fb3c8", wordBreak: "break-all" }}>{r.content}</div>
                                <div style={{ color: "#7f8c9b", marginTop: 2 }}>
                                  ttl: {r.ttl}{r.priority ? ` · priority: ${r.priority}` : ""}{typeof r.proxied === "boolean" ? ` · proxied: ${r.proxied ? "true" : "false"}` : ""}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDeleteRecord(item.id, r)}
                                disabled={deletingRecordId === r.id}
                                style={{ background: "#2d1616", color: "#ffb3b3", whiteSpace: "nowrap" }}
                              >
                                {deletingRecordId === r.id ? "Excluindo..." : "Excluir"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
