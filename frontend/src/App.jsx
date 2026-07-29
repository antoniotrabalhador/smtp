import { useEffect, useState } from "react"
import { listNodes } from "./api"
import AddNodeForm from "./components/AddNodeForm"
import Campaigns from "./components/Campaigns"
import NodeTable from "./components/NodeTable"
import EmailBuilder from "./components/EmailBuilder"
import RecipientLists from "./components/RecipientLists"
import CampaignMonitor from "./components/CampaignMonitor"
import Webhooks from "./components/Webhooks"

function TabButton({ id, active, onClick, children }) {
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        flex: "0 0 auto",
        padding: "12px 20px",
        background: active ? "#0d1117" : "transparent",
        border: "none",
        borderBottom: active ? "3px solid #58a6ff" : "3px solid transparent",
        color: active ? "#58a6ff" : "#8b949e",
        cursor: "pointer",
        fontSize: "0.95em",
        fontWeight: active ? "600" : "400",
        transition: "all 0.2s",
      }}
    >
      {children}
    </button>
  )
}

function App() {
  const [health, setHealth] = useState("checking...")
  const [nodes, setNodes] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [activeTab, setActiveTab] = useState("vps")

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setHealth(data.status))
      .catch(() => setHealth("unreachable"))
    refreshNodes()
  }, [])

  function refreshNodes() {
    listNodes().then(setNodes).catch(() => setNodes([]))
  }

  function handleCreated() {
    refreshNodes()
    setShowAddForm(false)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <div style={{ background: "#0d1117", borderBottom: "1px solid #30363d", paddingBottom: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #30363d" }}>
          <h1 style={{ margin: 0 }}>SMTP Fleet Panel</h1>
          <p style={{ margin: "8px 0 0 0", fontSize: "0.9em", color: "#8b949e" }}>Backend status: {health}</p>
        </div>
        <div style={{ display: "flex", gap: 0 }}>
          <TabButton id="vps"       active={activeTab === "vps"}       onClick={setActiveTab}>🖥️ VPS Manager</TabButton>
          <TabButton id="email"     active={activeTab === "email"}     onClick={setActiveTab}>📧 Email Builder</TabButton>
          <TabButton id="campaigns" active={activeTab === "campaigns"} onClick={setActiveTab}>🚀 Campanhas</TabButton>
          <TabButton id="monitor"   active={activeTab === "monitor"}   onClick={setActiveTab}>📡 Monitor</TabButton>
          <TabButton id="lists"     active={activeTab === "lists"}     onClick={setActiveTab}>📋 Listas</TabButton>
          <TabButton id="webhooks"  active={activeTab === "webhooks"}  onClick={setActiveTab}>🔗 Webhooks</TabButton>
        </div>
      </div>

      <div style={{ flex: 1, padding: "20px", overflowY: "auto" }}>
        {activeTab === "vps" && (
          <>
            <h2>VPS cadastradas</h2>
            {nodes.length === 0 ? (
              <p style={{ color: "#8b949e" }}>Nenhum VPS cadastrado ainda.</p>
            ) : (
              <NodeTable nodes={nodes} onChanged={refreshNodes} />
            )}
            <button className="add-node-toggle" onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? "− Fechar" : "+ Adicionar VPS"}
            </button>
            {showAddForm && <AddNodeForm onCreated={handleCreated} />}
          </>
        )}
        {activeTab === "email"     && <EmailBuilder />}
        {activeTab === "campaigns" && <Campaigns nodes={nodes} />}
        {activeTab === "monitor"   && <CampaignMonitor />}
        {activeTab === "lists"     && <RecipientLists />}
        {activeTab === "webhooks"  && <Webhooks />}
      </div>
    </div>
  )
}

export default App
