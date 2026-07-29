import NodeRow from "./NodeRow"

export default function NodeTable({ nodes, onChanged }) {
  if (nodes.length === 0) return <p className="empty-hint">Nenhum VPS cadastrado ainda.</p>

  return (
    <div className="node-list">
      {nodes.map((n) => (
        <NodeRow key={n.id} node={n} onChanged={onChanged} />
      ))}
    </div>
  )
}
