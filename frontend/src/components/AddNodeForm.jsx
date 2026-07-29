import { useState } from "react"
import { createNode } from "../api"

const initialForm = {
  hostname: "",
  ip: "",
  role: "sender",
  ssh_port: 22,
  ssh_user: "root",
  auth_method: "key",
  ssh_password: "",
  ssh_private_key: "",
  tags: "",
}

export default function AddNodeForm({ onCreated }) {
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload = { ...form, ssh_port: Number(form.ssh_port) }
      if (payload.auth_method === "key") payload.ssh_password = null
      else payload.ssh_private_key = null
      await createNode(payload)
      setForm(initialForm)
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="add-node-form" onSubmit={handleSubmit}>
      <h2>Add VPS</h2>
      {error && <p className="status-err full-width">{error}</p>}

      <label>
        Nome
        <input value={form.hostname} onChange={(e) => update("hostname", e.target.value)} required />
      </label>

      <label>
        IP
        <input value={form.ip} onChange={(e) => update("ip", e.target.value)} required />
      </label>

      <label>
        Papel
        <select value={form.role} onChange={(e) => update("role", e.target.value)}>
          <option value="sender">sender</option>
          <option value="monitor">monitor</option>
          <option value="orchestrator">orchestrator</option>
        </select>
      </label>

      <label>
        SSH Port
        <input type="number" value={form.ssh_port} onChange={(e) => update("ssh_port", e.target.value)} required />
      </label>

      <label>
        SSH User
        <input value={form.ssh_user} onChange={(e) => update("ssh_user", e.target.value)} required />
      </label>

      <label>
        Método de auth
        <select value={form.auth_method} onChange={(e) => update("auth_method", e.target.value)}>
          <option value="key">chave SSH</option>
          <option value="password">senha</option>
        </select>
      </label>

      {form.auth_method === "key" ? (
        <label className="full-width">
          Chave privada
          <textarea value={form.ssh_private_key} onChange={(e) => update("ssh_private_key", e.target.value)} rows={4} />
        </label>
      ) : (
        <label>
          Senha
          <input type="password" value={form.ssh_password} onChange={(e) => update("ssh_password", e.target.value)} />
        </label>
      )}

      <label>
        Tags
        <input value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="ex: producao,warmup" />
      </label>

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Salvando..." : "Adicionar VPS"}
        </button>
      </div>
    </form>
  )
}
