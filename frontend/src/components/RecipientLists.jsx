import { useState, useEffect, useRef } from "react"

function ProgressBar({ value, total, color = "#238636" }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div style={{ background: "#21262d", borderRadius: 4, height: 8, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.4s ease", borderRadius: 4 }} />
    </div>
  )
}

export default function RecipientLists() {
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [uploadingId, setUploadingId] = useState(null)
  const [uploadResult, setUploadResult] = useState({})
  const [uploadProgress, setUploadProgress] = useState({})
  const fileInputRef = useRef(null)
  const [pendingListId, setPendingListId] = useState(null)

  useEffect(() => { fetchLists() }, [])

  async function fetchLists() {
    try {
      const res = await fetch("/api/recipient-lists")
      setLists(await res.json())
    } catch { setLists([]) }
    finally { setLoading(false) }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/recipient-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (res.ok) { setNewName(""); fetchLists() }
    } finally { setCreating(false) }
  }

  function triggerUpload(listId) {
    setPendingListId(listId)
    fileInputRef.current?.click()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file || !pendingListId) return
    e.target.value = ""
    const listId = pendingListId
    setPendingListId(null)

    setUploadingId(listId)
    setUploadResult(prev => ({ ...prev, [listId]: null }))
    setUploadProgress(prev => ({ ...prev, [listId]: "Enviando..." }))

    try {
      const formData = new FormData()
      formData.append("file", file, file.name)
      const res = await fetch(`/api/recipient-lists/${listId}/upload`, { method: "POST", body: formData })
      const data = await res.json()
      setUploadResult(prev => ({ ...prev, [listId]: data }))
      fetchLists()
    } catch (err) {
      setUploadResult(prev => ({ ...prev, [listId]: { ok: false, error: err.message } }))
    } finally {
      setUploadingId(null)
      setUploadProgress(prev => ({ ...prev, [listId]: null }))
    }
  }

  async function handleDelete(listId) {
    if (!confirm("Remover esta lista e todos os destinatários?")) return
    await fetch(`/api/recipient-lists/${listId}`, { method: "DELETE" })
    fetchLists()
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>📋 Listas de Destinatários</h2>
          <p style={{ margin: "4px 0 0", color: "#8b949e", fontSize: "0.88em" }}>
            Gerencie suas listas de emails para campanhas em massa.
          </p>
        </div>
      </div>

      {/* Create new list */}
      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Nome da lista (ex: Leads Julho 2026)"
          style={{ flex: 1, padding: "8px 12px", fontSize: "0.9em" }}
        />
        <button type="submit" disabled={creating || !newName.trim()} style={{ whiteSpace: "nowrap" }}>
          {creating ? "..." : "+ Nova Lista"}
        </button>
      </form>

      <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleFileChange} />

      {loading ? (
        <p style={{ color: "#8b949e" }}>Carregando...</p>
      ) : lists.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#8b949e" }}>
          <div style={{ fontSize: "2em", marginBottom: 8 }}>📭</div>
          <div>Nenhuma lista criada ainda.</div>
          <div style={{ fontSize: "0.85em", marginTop: 4 }}>Crie uma lista e faça upload de um CSV com os emails.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {lists.map(list => {
            const result = uploadResult[list.id]
            const isUploading = uploadingId === list.id
            const activePct = list.total_count > 0 ? Math.round(list.active_count / list.total_count * 100) : 0
            const inactivePct = 100 - activePct

            return (
              <div key={list.id} style={{
                background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "16px 18px",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <strong style={{ fontSize: "1em", color: "#e6edf3" }}>{list.name}</strong>
                      <span style={{ fontSize: "0.75em", color: "#8b949e", background: "#21262d", padding: "2px 8px", borderRadius: 10 }}>
                        #{list.id}
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: 20, fontSize: "0.82em", color: "#8b949e", marginBottom: 10 }}>
                      <span>📊 <strong style={{ color: "#c9d1d9" }}>{list.total_count.toLocaleString()}</strong> total</span>
                      <span>✅ <strong style={{ color: "#3fb950" }}>{list.active_count.toLocaleString()}</strong> ativos</span>
                      <span>🚫 <strong style={{ color: "#f85149" }}>{(list.total_count - list.active_count).toLocaleString()}</strong> inativos</span>
                      <span>📅 {new Date(list.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>

                    {list.total_count > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                        <ProgressBar value={list.active_count} total={list.total_count} color="#238636" />
                        <span style={{ fontSize: "0.75em", color: "#8b949e", minWidth: 36 }}>{activePct}%</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => triggerUpload(list.id)}
                      disabled={isUploading}
                      style={{ fontSize: "0.82em", background: "#1f6feb", border: "none", color: "white", borderRadius: 4, padding: "5px 12px", cursor: "pointer" }}
                    >
                      {isUploading ? "⟳ Enviando..." : "⬆ Upload CSV"}
                    </button>
                    <button
                      onClick={() => handleDelete(list.id)}
                      style={{ fontSize: "0.82em", background: "#da3633", border: "none", color: "white", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {result && (
                  <div style={{
                    marginTop: 10, padding: "8px 12px", borderRadius: 6,
                    background: result.ok ? "#0d2e0d" : "#2e0d0d",
                    border: `1px solid ${result.ok ? "#238636" : "#da3633"}`,
                    fontSize: "0.82em", color: result.ok ? "#3fb950" : "#f85149",
                  }}>
                    {result.ok
                      ? `✅ +${result.added?.toLocaleString()} adicionados · ${result.skipped_duplicate?.toLocaleString()} duplicados ignorados · ${result.skipped_invalid?.toLocaleString()} inválidos · Total: ${result.total_count?.toLocaleString()} (${result.active_count?.toLocaleString()} ativos)`
                      : `❌ Erro: ${result.error || result.detail}`
                    }
                  </div>
                )}

                <div style={{ marginTop: 6, fontSize: "0.76em", color: "#8b949e" }}>
                  💡 Formatos aceitos: CSV com coluna de email, ou arquivo .txt com um email por linha
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
