import { useState, useEffect } from "react"

const SMART_TAGS = [
  { tag: "{{subject}}", desc: "Assunto do email (definido na campanha)", sample: "Oferta exclusiva para você" },
  { tag: "{{email}}", desc: "Email completo do destinatario", sample: "joao@gmail.com" },
  { tag: "{{domain}}", desc: "Dominio do email (ex: gmail.com)", sample: "gmail.com" },
  { tag: "{{protocol}}", desc: "10 digitos unicos aleatorios por destinatario", sample: "3847162905" },
  { tag: "{{data}}", desc: "Data atual do envio (ex: 02/08/2026 - Fuso Brasil)", sample: "02/08/2026" },
  { tag: "{{hora}}", desc: "Hora atual do envio (ex: 16:50:32 - Fuso Brasil)", sample: "16:50:32" },
  { tag: "{{cta_url}}", desc: "Link do botao de acao (definido na campanha)", sample: "https://exemplo.com" },
  { tag: "{{unsubscribe_url}}", desc: "Link de cancelamento (automatico por VPS)", sample: "https://seudominio.com/unsubscribe?email=joao@gmail.com" },
]

const UNSUB_FOOTER = `
<div style="text-align:center;padding:16px 0;font-size:12px;color:#999;font-family:sans-serif;">
  Nao quer mais receber? <a href="{{unsubscribe_url}}" style="color:#999;">Cancelar inscricao</a>
</div>`

function EmailEditor({ template, onSave, onBack }) {
  const [name, setName] = useState(template?.name || "")
  const [subject, setSubject] = useState(template?.subject || "")
  const [htmlCode, setHtmlCode] = useState(template?.html || "")
  const [pureText, setPureText] = useState(template?.plain_text || "")
  const [viewMode, setViewMode] = useState("preview")
  const [injectUnsub, setInjectUnsub] = useState(true)
  const [copiedTag, setCopiedTag] = useState(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  function copyTag(tag) {
    navigator.clipboard.writeText(tag)
    setCopiedTag(tag)
    setTimeout(() => setCopiedTag(null), 1500)
  }

  function getFinalHtml() {
    let h = htmlCode
    if (injectUnsub && h && !h.includes("{{unsubscribe_url}}")) {
      h = h.includes("</body>") ? h.replace("</body>", UNSUB_FOOTER + "</body>") : h + UNSUB_FOOTER
    }
    return h
  }

  function getPreviewHtml() {
    let h = getFinalHtml()
    SMART_TAGS.forEach(({ tag, sample }) => { h = h.replaceAll(tag, sample) })
    return h
  }

  async function handleFileUpload(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploadLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("eml_content", f, f.name)
      const res = await fetch("/api/email/parse-eml", { method: "POST", body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        const d = err?.detail
        throw new Error(Array.isArray(d) ? d.map(x => x.msg).join("; ") : d || "Erro ao processar EML")
      }
      const data = await res.json()
      setHtmlCode(data.html || "")
      setPureText(data.text || "")
      if (!subject) setSubject(data.subject || "")
      if (!name) setName(f.name.replace(".eml", ""))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploadLoading(false)
      e.target.value = ""
    }
  }

  function htmlToText(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, " ")
      .trim()
  }

  async function handleSave() {
    if (!name.trim()) { setError("De um nome para o template"); return }
    setSaving(true)
    setError(null)
    try {
      const finalHtml = getFinalHtml()
      const finalText = htmlToText(finalHtml)
      setPureText(finalText)
      const payload = { name, subject, html: finalHtml, plain_text: finalText }
      const url = template?.id ? `/api/email/templates/${template.id}` : "/api/email/templates"
      const method = template?.id ? "PUT" : "POST"
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error("Erro ao salvar")
      const saved = await res.json()
      onSave(saved)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={{ background: "none", border: "1px solid #30363d", borderRadius: 4, padding: "5px 12px", cursor: "pointer", color: "#8b949e", fontSize: "0.85em" }}>
          Colecao
        </button>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Nome do template..."
          style={{ flex: 1, padding: "6px 10px", fontSize: "0.95em", fontWeight: "bold", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", color: "#c9d1d9" }}
        />
        <label style={{ fontSize: "0.8em", color: "#58a6ff", cursor: "pointer", border: "1px solid #1f6feb", borderRadius: 4, padding: "5px 12px" }}>
          {uploadLoading ? "Importando..." : "Importar .eml"}
          <input type="file" accept=".eml" onChange={handleFileUpload} disabled={uploadLoading} style={{ display: "none" }} />
        </label>
        <button onClick={handleSave} disabled={saving} style={{ background: "#238636", color: "white", border: "none", borderRadius: 4, padding: "6px 16px", cursor: saving ? "not-allowed" : "pointer", fontWeight: "bold", fontSize: "0.85em" }}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {error && <div style={{ background: "#3d2424", color: "#f85149", padding: "8px 12px", borderRadius: 4, marginBottom: 12, fontSize: "0.85em" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 16, alignItems: "start" }}>
        {/* Coluna Esquerda: Editor / Preview */}
        <div>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Assunto — ex: Oferta para {{email}} gerada em {{data}}"
            style={{ width: "100%", padding: "8px 10px", fontSize: "0.9em", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", color: "#c9d1d9", marginBottom: 12 }}
          />

          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            {["preview", "code"].map(m => (
              <button key={m} onClick={() => setViewMode(m)} style={{ padding: "5px 14px", fontSize: "0.82em", borderRadius: 4, border: "1px solid #30363d", cursor: "pointer", background: viewMode === m ? "#1f6feb" : "transparent", color: viewMode === m ? "white" : "#8b949e" }}>
                {m === "preview" ? "Preview Visual" : "Código HTML"}
              </button>
            ))}
            <label style={{ marginLeft: "auto", fontSize: "0.8em", color: "#8b949e", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={injectUnsub} onChange={e => setInjectUnsub(e.target.checked)} />
              Auto-injetar footer unsubscribe
            </label>
          </div>

          {viewMode === "preview" ? (
            <div style={{ background: "#fff", borderRadius: 4, border: "1px solid #30363d", overflow: "hidden", marginBottom: 12 }}>
              <iframe title="preview" srcDoc={getPreviewHtml()} sandbox="" style={{ width: "100%", height: "480px", border: "none" }} />
            </div>
          ) : (
            <textarea
              value={htmlCode}
              onChange={e => setHtmlCode(e.target.value)}
              placeholder="Cole o código HTML do seu e-mail aqui..."
              style={{ width: "100%", height: "480px", marginBottom: 12, background: "#0d1117", color: "#79c0ff", padding: 10, borderRadius: 4, border: "1px solid #30363d", fontFamily: "monospace", fontSize: "0.78em", lineHeight: 1.5, resize: "vertical" }}
            />
          )}

          {template?.id && (
            <textarea
              value={pureText}
              onChange={e => setPureText(e.target.value)}
              placeholder="Texto puro (fallback para clientes sem HTML)..."
              style={{ width: "100%", height: "80px", padding: 8, fontSize: "0.82em", fontFamily: "monospace", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", color: "#8b949e", resize: "vertical", marginTop: 8 }}
            />
          )}
        </div>

        {/* Coluna Direita: Bloco Lateral de Tags & Exemplos */}
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, padding: 12, position: "sticky", top: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, borderBottom: "1px solid #30363d", paddingBottom: 8 }}>
            <h4 style={{ margin: 0, fontSize: "0.9em", color: "#c9d1d9", display: "flex", alignItems: "center", gap: 6 }}>
              <span>🏷️</span> Tags & Exemplos
            </h4>
            <span style={{ fontSize: "0.72em", color: "#8b949e" }}>Clique para copiar</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "560px", overflowY: "auto", paddingRight: 4 }}>
            {SMART_TAGS.map(({ tag, desc, sample }) => (
              <div
                key={tag}
                onClick={() => copyTag(tag)}
                style={{
                  background: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  padding: "8px 10px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  borderColor: copiedTag === tag ? "#238636" : "#30363d",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <code style={{ fontSize: "0.82em", color: copiedTag === tag ? "#3fb950" : "#79c0ff", fontWeight: "bold" }}>
                    {tag}
                  </code>
                  <span style={{ fontSize: "0.7em", color: copiedTag === tag ? "#3fb950" : "#8b949e" }}>
                    {copiedTag === tag ? "✓ Copiado" : "copiar"}
                  </span>
                </div>
                <div style={{ fontSize: "0.76em", color: "#8b949e", marginBottom: 4 }}>{desc}</div>
                <div style={{ fontSize: "0.72em", color: "#e3b341", background: "#1c1917", padding: "3px 6px", borderRadius: 4, fontFamily: "monospace", wordBreak: "break-all" }}>
                  Exemplo: {sample}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #30363d", fontSize: "0.72em", color: "#8b949e", lineHeight: 1.4 }}>
            💡 <strong>Dica:</strong> Você também pode usar estas tags dentro da <strong>CTA URL</strong> da campanha para enviar dados à sua Landing Page!
          </div>
        </div>
      </div>
    </div>
  )
}

export default function EmailBuilder() {
  const [templates, setTemplates] = useState([])
  const [selected, setSelected] = useState(null)
  const [loadingList, setLoadingList] = useState(true)

  useEffect(() => { fetchTemplates() }, [])

  async function fetchTemplates() {
    setLoadingList(true)
    try {
      const res = await fetch("/api/email/templates")
      if (res.ok) setTemplates(await res.json())
    } finally {
      setLoadingList(false)
    }
  }

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!confirm("Apagar este template?")) return
    await fetch(`/api/email/templates/${id}`, { method: "DELETE" })
    setTemplates(t => t.filter(x => x.id !== id))
  }

  function handleSaved(saved) {
    setTemplates(prev => {
      const exists = prev.find(t => t.id === saved.id)
      return exists ? prev.map(t => t.id === saved.id ? saved : t) : [saved, ...prev]
    })
    setSelected(saved)
  }

  if (selected !== null) {
    return (
      <div style={{ padding: "20px" }}>
        <EmailEditor template={selected} onSave={handleSaved} onBack={() => setSelected(null)} />
      </div>
    )
  }

  return (
    <div style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Email Builder</h2>
        <button onClick={() => setSelected({})} style={{ marginLeft: "auto", background: "#238636", color: "white", border: "none", borderRadius: 4, padding: "7px 16px", cursor: "pointer", fontWeight: "bold", fontSize: "0.85em" }}>
          + Novo Email
        </button>
      </div>

      {loadingList && <div style={{ color: "#58a6ff" }}>Carregando...</div>}

      {!loadingList && templates.length === 0 && (
        <div style={{ textAlign: "center", color: "#6e7681", padding: "40px 0" }}>
          <div style={{ fontSize: "2em", marginBottom: 8 }}>No emails yet</div>
          <div>Clique em + Novo Email para comecar.</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
        {templates.map(tpl => (
          <div
            key={tpl.id}
            onClick={() => setSelected(tpl)}
            style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "14px 16px", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#58a6ff"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#30363d"}
          >
            <div style={{ fontWeight: "bold", color: "#c9d1d9", marginBottom: 4, fontSize: "0.95em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {tpl.name}
            </div>
            <div style={{ fontSize: "0.8em", color: "#8b949e", marginBottom: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {tpl.subject || "Sem assunto"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.72em", color: "#6e7681" }}>
                {new Date(tpl.updated_at).toLocaleDateString("pt-BR")}
              </span>
              <button
                onClick={e => handleDelete(e, tpl.id)}
                style={{ background: "none", border: "1px solid #6e7681", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "#6e7681", fontSize: "0.75em" }}
              >
                Apagar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
