import { useState, useEffect, useCallback, useRef } from 'react'

const API = '/api/webhooks'

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    pending_config: { label: 'Aguardando teste',       bg: '#1c1a0e', color: '#f59e0b' },
    configuring:    { label: 'Configure o mapeamento', bg: '#0e1624', color: '#60a5fa' },
    active:         { label: '● Ativo',                bg: '#0e1c0e', color: '#4ade80' },
  }
  const s = map[status] || { label: status, bg: '#111', color: '#888' }
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}44`,
      padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
    }}>
      {s.label}
    </span>
  )
}

// ── Interactive JSON Tree ─────────────────────────────────────────────────────
function JsonTree({ data, path = '', onSelect, highlightPath }) {
  if (typeof data !== 'object' || data === null) {
    const active = path === highlightPath
    return (
      <span
        onClick={() => onSelect(path)}
        title={`Caminho: ${path}`}
        style={{
          cursor: 'pointer',
          color: active ? '#fff' : '#86efac',
          background: active ? '#166534' : 'transparent',
          borderRadius: '3px', padding: '0 4px',
          textDecoration: active ? 'none' : 'underline dotted #4ade8055',
          transition: 'all 0.15s',
        }}
      >
        {JSON.stringify(data)}
      </span>
    )
  }
  if (Array.isArray(data)) {
    return <span style={{ color: '#888' }}>[{data.length} items]</span>
  }
  return (
    <span>
      {'{'}
      <div style={{ paddingLeft: '16px' }}>
        {Object.entries(data).map(([k, v]) => {
          const childPath = path ? `${path}.${k}` : k
          return (
            <div key={k} style={{ lineHeight: '1.9' }}>
              <span style={{ color: '#93c5fd' }}>"{k}"</span>
              <span style={{ color: '#555' }}>: </span>
              <JsonTree data={v} path={childPath} onSelect={onSelect} highlightPath={highlightPath} />
            </div>
          )
        })}
      </div>
      {'}'}
    </span>
  )
}

// ── Mapping Editor ────────────────────────────────────────────────────────────
const newRow = (id) => ({ id, column_name: '', json_path: '', is_email: false })

function MappingEditor({ sample, onSave, saving, saveError, initialRows }) {
  const [rows, setRows] = useState(
    initialRows?.length
      ? initialRows.map(r => ({ id: r.id, column_name: r.column_name, json_path: r.json_path, is_email: r.is_email }))
      : [newRow(1)]
  )
  const [activeIdx, setActiveIdx] = useState(0)
  const nextId = useRef(100)

  const parsedSample = (() => { try { return sample ? JSON.parse(sample) : null } catch { return null } })()

  function addRow() {
    setRows(prev => [...prev, newRow(nextId.current++)])
    setActiveIdx(rows.length)
  }

  function removeRow(idx) {
    if (rows.length === 1) return
    setRows(prev => prev.filter((_, i) => i !== idx))
    setActiveIdx(Math.max(0, idx - 1))
  }

  function updateRow(idx, field, value) {
    if (field === 'is_email' && value === true) {
      setRows(prev => prev.map((r, i) => ({ ...r, is_email: i === idx })))
    } else {
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
    }
  }

  function handleJsonClick(path) {
    const lastPart = path.split('.').pop()
    setRows(prev => prev.map((r, i) => i !== activeIdx ? r : {
      ...r,
      json_path: path,
      column_name: r.column_name || lastPart,
    }))
  }

  const highlightPath = rows[activeIdx]?.json_path || ''

  return (
    <div>
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '14px' }}>

        {/* JSON tree panel */}
        <div style={{
          flex: '0 0 240px', background: '#060610', border: '1px solid #1e3a5f',
          borderRadius: '8px', padding: '10px 12px', maxHeight: '280px', overflowY: 'auto',
        }}>
          {parsedSample ? (
            <>
              <div style={{ color: '#60a5fa', fontSize: '11px', marginBottom: '8px', fontWeight: 600 }}>
                Clique num valor → preenche linha selecionada ↓
              </div>
              <pre style={{ fontSize: '12px', fontFamily: 'monospace', margin: 0, lineHeight: '1.8', color: '#ccc' }}>
                <JsonTree data={parsedSample} onSelect={handleJsonClick} highlightPath={highlightPath} />
              </pre>
            </>
          ) : (
            <span style={{ color: '#444', fontSize: '12px' }}>Payload não disponível</span>
          )}
        </div>

        {/* Mapping rows panel */}
        <div style={{ flex: 1, minWidth: '260px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 52px 28px', gap: '6px', marginBottom: '5px', padding: '0 2px' }}>
            <span style={{ color: '#555', fontSize: '11px' }}>Nome da coluna</span>
            <span style={{ color: '#555', fontSize: '11px' }}>Caminho no JSON</span>
            <span style={{ color: '#555', fontSize: '11px', textAlign: 'center' }}>Email?</span>
            <span />
          </div>

          {rows.map((row, idx) => (
            <div
              key={row.id}
              onClick={() => setActiveIdx(idx)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 52px 28px',
                gap: '6px', marginBottom: '5px', padding: '5px',
                background: activeIdx === idx ? '#0e1624' : '#0a0a0a',
                border: `1px solid ${activeIdx === idx ? '#3b82f6' : '#222'}`,
                borderRadius: '6px', cursor: 'pointer', transition: 'border-color 0.15s',
              }}
            >
              <input
                value={row.column_name}
                onChange={e => updateRow(idx, 'column_name', e.target.value)}
                onClick={e => { e.stopPropagation(); setActiveIdx(idx) }}
                placeholder="nome_campo"
                style={{ ...iSt, fontSize: '12px', padding: '5px 8px' }}
              />
              <input
                value={row.json_path}
                onChange={e => updateRow(idx, 'json_path', e.target.value)}
                onClick={e => { e.stopPropagation(); setActiveIdx(idx) }}
                placeholder="campo.aninhado"
                style={{ ...iSt, fontSize: '12px', padding: '5px 8px', color: '#fbbf24' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="checkbox"
                  checked={row.is_email}
                  onChange={e => updateRow(idx, 'is_email', e.target.checked)}
                  onClick={e => e.stopPropagation()}
                  title="Usar para deduplicação de email"
                  style={{ width: '15px', height: '15px', accentColor: '#4ade80', cursor: 'pointer' }}
                />
              </div>
              <button
                onClick={e => { e.stopPropagation(); removeRow(idx) }}
                disabled={rows.length === 1}
                style={{
                  background: 'transparent', border: 'none',
                  color: rows.length === 1 ? '#333' : '#666',
                  cursor: rows.length === 1 ? 'not-allowed' : 'pointer',
                  fontSize: '18px', padding: 0, lineHeight: 1,
                }}
              >×</button>
            </div>
          ))}

          <button
            onClick={addRow}
            style={{
              background: 'transparent', border: '1px dashed #2a2a2a', color: '#555',
              borderRadius: '6px', padding: '5px 0', cursor: 'pointer',
              fontSize: '12px', width: '100%', marginTop: '4px',
            }}
          >
            + adicionar coluna
          </button>
        </div>
      </div>

      {/* Activate button */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button
          onClick={() => onSave(rows)}
          disabled={saving}
          style={{
            background: '#166534', color: '#4ade80', border: '1px solid #16a34a',
            borderRadius: '6px', padding: '9px 22px', cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: '14px', fontWeight: 700,
          }}
        >
          {saving ? 'Ativando...' : '✓ Ativar Webhook'}
        </button>
        <span style={{ color: '#555', fontSize: '11px' }}>☑ Email = deduplicação automática</span>
      </div>
      {saveError && <p style={{ color: '#f87171', fontSize: '13px', marginTop: '8px' }}>{saveError}</p>}
    </div>
  )
}

// ── Leads Table ───────────────────────────────────────────────────────────────
function LeadsTable({ webhookId, mappings }) {
  const [result, setResult] = useState(null)

  useEffect(() => {
    fetch(`${API}/${webhookId}/leads?limit=100`)
      .then(r => r.json())
      .then(setResult)
      .catch(() => setResult({ leads: [], total: 0 }))
  }, [webhookId])

  if (!result) return <p style={{ color: '#666', fontSize: '13px', padding: '12px 0' }}>Carregando...</p>

  const cols = [...mappings].sort((a, b) => a.sort_order - b.sort_order)

  if (result.leads.length === 0) {
    return <p style={{ color: '#444', fontSize: '13px', padding: '12px 0', textAlign: 'center' }}>Nenhum lead recebido ainda.</p>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: '11px', color: '#555', marginBottom: '8px' }}>
        {result.total} leads · mostrando últimos {result.leads.length}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
            {cols.map(c => (
              <th key={c.column_name} style={{ textAlign: 'left', padding: '6px 10px', color: '#888', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {c.column_name}
                {c.is_email && <span style={{ color: '#4ade80', marginLeft: '4px', fontSize: '10px' }}>@</span>}
              </th>
            ))}
            <th style={{ textAlign: 'left', padding: '6px 10px', color: '#444', fontWeight: 400, whiteSpace: 'nowrap' }}>Recebido</th>
          </tr>
        </thead>
        <tbody>
          {result.leads.map(lead => {
            const d = (() => { try { return JSON.parse(lead.data) } catch { return {} } })()
            return (
              <tr key={lead.id} style={{ borderBottom: '1px solid #151515' }}>
                {cols.map(c => (
                  <td key={c.column_name} style={{ padding: '6px 10px', color: '#ccc', whiteSpace: 'nowrap' }}>
                    {d[c.column_name] ?? <span style={{ color: '#333' }}>—</span>}
                  </td>
                ))}
                <td style={{ padding: '6px 10px', color: '#444', whiteSpace: 'nowrap', fontSize: '11px' }}>
                  {new Date(lead.created_at).toLocaleString('pt-BR')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Webhook Card ──────────────────────────────────────────────────────────────
function WebhookCard({ wh, onDelete, onRefresh }) {
  const [polling, setPolling]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState('')
  const [copied, setCopied]     = useState(false)
  const [showLeads, setShowLeads] = useState(false)

  const url = `${window.location.origin}/api/webhooks/receive/${wh.token}`

  async function copyUrl() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function pollSample() {
    setPolling(true)
    try {
      const res = await fetch(`${API}/${wh.id}`)
      const data = await res.json()
      if (data.status !== 'pending_config') onRefresh()
    } finally {
      setPolling(false)
    }
  }

  async function handleSave(rows) {
    setSaveError('')
    const valid = rows.filter(r => r.column_name.trim() && r.json_path.trim())
    if (!valid.length) return setSaveError('Adicione ao menos uma coluna válida')
    setSaving(true)
    try {
      const res = await fetch(`${API}/${wh.id}/configure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mappings: valid.map((r, i) => ({
            column_name: r.column_name.trim(),
            json_path: r.json_path.trim(),
            is_email: r.is_email,
            sort_order: i,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setSaveError(err.detail || 'Erro ao ativar')
        return
      }
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleExport(format, scope) {
    try {
      const res = await fetch(`${API}/${wh.id}/export-file?file_format=${format}&scope=${scope}`)
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        alert(err?.detail || 'Erro ao exportar arquivo')
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition')
      let filename = `leads_${wh.name}_${scope}.${format}`
      if (disposition && disposition.includes('filename=')) {
        filename = disposition.split('filename=')[1].replace(/"/g, '')
      }
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(downloadUrl)
      onRefresh()
    } catch (err) {
      alert('Erro na conexão ao baixar: ' + err.message)
    }
  }

  return (
    <div style={{
      background: '#111',
      border: `1px solid ${wh.status === 'active' ? '#14532d' : '#1e1e1e'}`,
      borderRadius: '10px', padding: '18px 20px',
      transition: 'border-color 0.3s',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>{wh.name}</span>
          <StatusBadge status={wh.status} />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {wh.status === 'active' && (
            <>
              <span style={{
                background: '#0e1c0e', color: '#4ade80', border: '1px solid #14532d',
                padding: '2px 10px', borderRadius: '12px', fontSize: '12px',
              }}>
                {wh.total_received} leads no total
              </span>
              {wh.new_leads_count > 0 ? (
                <span style={{
                  background: '#2e1065', color: '#c084fc', border: '1px solid #581c87',
                  padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                }}>
                  🔥 {wh.new_leads_count} novos p/ baixar
                </span>
              ) : (
                <span style={{
                  background: '#18181b', color: '#71717a', border: '1px solid #27272a',
                  padding: '2px 10px', borderRadius: '12px', fontSize: '12px',
                }}>
                  ✓ Tudo baixado
                </span>
              )}
              <button
                onClick={() => handleExport('csv', 'new')}
                disabled={wh.new_leads_count === 0}
                title="Baixar apenas os leads novos que chegaram desde o último download no formato CSV (coluna;coluna)"
                style={{
                  background: wh.new_leads_count > 0 ? '#15803d' : '#27272a',
                  border: '1px solid #22c55e', color: wh.new_leads_count > 0 ? '#fff' : '#71717a',
                  borderRadius: '6px', padding: '4px 10px', cursor: wh.new_leads_count > 0 ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 600,
                }}
              >
                📥 CSV (Novos)
              </button>
              <button
                onClick={() => handleExport('txt', 'new')}
                disabled={wh.new_leads_count === 0}
                title="Baixar apenas os leads novos no formato TXT (coluna;coluna)"
                style={{
                  background: wh.new_leads_count > 0 ? '#1e3a8a' : '#27272a',
                  border: '1px solid #3b82f6', color: wh.new_leads_count > 0 ? '#fff' : '#71717a',
                  borderRadius: '6px', padding: '4px 10px', cursor: wh.new_leads_count > 0 ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 600,
                }}
              >
                📄 TXT (Novos)
              </button>
              <button
                onClick={() => handleExport('csv', 'all')}
                title="Baixar a base completa de todos os leads acumulados neste webhook (CSV)"
                style={{
                  background: '#18181b', border: '1px solid #3f3f46', color: '#a1a1aa',
                  borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px',
                }}
              >
                CSV (Todos)
              </button>
              <button
                onClick={() => handleExport('txt', 'all')}
                title="Baixar a base completa de todos os leads acumulados neste webhook (TXT)"
                style={{
                  background: '#18181b', border: '1px solid #3f3f46', color: '#a1a1aa',
                  borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px',
                }}
              >
                TXT (Todos)
              </button>
              <button
                onClick={() => setShowLeads(v => !v)}
                style={{
                  background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
                  borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
                }}
              >
                {showLeads ? '▲ Ocultar' : '▼ Ver leads'}
              </button>
            </>
          )}
          <button
            onClick={() => onDelete(wh.id)}
            style={{
              background: 'transparent', border: '1px solid #2a2a2a', color: '#555',
              borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px',
            }}
          >
            Remover
          </button>
        </div>
      </div>

      {/* URL bar */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
        <code style={{
          flex: 1, background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '6px',
          padding: '7px 12px', fontSize: '12px', color: '#a78bfa',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
        }}>
          POST {url}
        </code>
        <button
          onClick={copyUrl}
          style={{
            background: copied ? '#14532d' : '#1e293b',
            border: `1px solid ${copied ? '#22c55e' : '#334155'}`,
            color: copied ? '#22c55e' : '#94a3b8',
            borderRadius: '6px', padding: '7px 14px', cursor: 'pointer',
            fontSize: '12px', whiteSpace: 'nowrap', transition: 'all 0.2s',
          }}
        >
          {copied ? '✓ Copiado' : '📋 Copiar'}
        </button>
      </div>

      {/* Step 1 — waiting for test */}
      {wh.status === 'pending_config' && (
        <div style={{
          background: '#0a0a0a', border: '1px dashed #2a2a2a', borderRadius: '8px',
          padding: '18px', textAlign: 'center',
        }}>
          <p style={{ color: '#f59e0b', fontSize: '13px', margin: '0 0 12px' }}>
            ⏳ Envie um POST de teste para a URL acima — o painel irá capturar o payload automaticamente
          </p>
          <button
            onClick={pollSample}
            disabled={polling}
            style={{
              background: '#1c1a0e', border: '1px solid #92400e', color: '#f59e0b',
              borderRadius: '6px', padding: '7px 18px', cursor: 'pointer', fontSize: '13px',
            }}
          >
            {polling ? '↻ Verificando...' : '↻ Já enviei — verificar'}
          </button>
        </div>
      )}

      {/* Step 2 — configure mappings */}
      {wh.status === 'configuring' && (
        <div style={{
          background: '#0a0a0a', border: '1px solid #1e3a5f',
          borderRadius: '8px', padding: '14px',
        }}>
          <div style={{ color: '#60a5fa', fontSize: '12px', fontWeight: 600, marginBottom: '12px' }}>
            📥 Mapeie os campos do payload para colunas da sua lista de leads:
          </div>
          <MappingEditor
            sample={wh.sample_payload}
            onSave={handleSave}
            saving={saving}
            saveError={saveError}
            initialRows={wh.mappings}
          />
        </div>
      )}

      {/* Step 3 — active */}
      {wh.status === 'active' && (
        <>
          <div style={{ fontSize: '12px', color: '#555', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#444' }}>Colunas:</span>
            {wh.mappings.map(m => (
              <code key={m.id} style={{
                color: '#fbbf24', background: '#1a1500', border: '1px solid #2a1f00',
                borderRadius: '4px', padding: '1px 6px', fontSize: '11px',
              }}>
                {m.column_name}{m.is_email ? ' <email>' : ''}
              </code>
            ))}
          </div>
          {showLeads && (
            <div style={{ marginTop: '12px', background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px' }}>
              <LeadsTable webhookId={wh.id} mappings={wh.mappings} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Webhooks() {
  const [webhooks, setWebhooks] = useState([])
  const [loading, setLoading]   = useState(true)
  const [newName, setNewName]   = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(API)
      setWebhooks(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function handleCreate(e) {
    e.preventDefault()
    setCreateError('')
    if (!newName.trim()) return setCreateError('Nome obrigatório')
    setCreating(true)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) { const err = await res.json(); setCreateError(err.detail || 'Erro'); return }
      setNewName('')
      await fetchAll()
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remover este webhook e todos os leads?')) return
    await fetch(`${API}/${id}`, { method: 'DELETE' })
    setWebhooks(prev => prev.filter(w => w.id !== id))
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h2 style={{ color: '#fff', marginBottom: '6px' }}>🔗 Webhooks de Entrada</h2>
      <p style={{ color: '#888', marginBottom: '24px', fontSize: '14px' }}>
        Receba dados de formulários externos, mapeie os campos e crie sua própria base de leads.
      </p>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, maxWidth: '400px' }}>
          <label style={{ color: '#888', fontSize: '12px' }}>Nome do webhook</label>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="ex: Formulário Landing Page"
            style={iSt}
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          style={{
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px',
            padding: '10px 20px', cursor: creating ? 'not-allowed' : 'pointer',
            fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          {creating ? 'Criando...' : '+ Novo Webhook'}
        </button>
      </form>
      {createError && <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '16px' }}>{createError}</p>}

      <div style={{ marginBottom: '24px' }} />

      {loading ? (
        <p style={{ color: '#666' }}>Carregando...</p>
      ) : webhooks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', background: '#0a0a0a', borderRadius: '10px', color: '#444' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔗</div>
          <p style={{ margin: 0 }}>Nenhum webhook criado ainda.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {webhooks.map(wh => (
            <WebhookCard key={wh.id} wh={wh} onDelete={handleDelete} onRefresh={fetchAll} />
          ))}
        </div>
      )}
    </div>
  )
}

const iSt = {
  background: '#0a0a0a',
  border: '1px solid #2a2a2a',
  borderRadius: '6px',
  padding: '9px 12px',
  color: '#fff',
  fontSize: '14px',
  outline: 'none',
  width: '100%',
}
