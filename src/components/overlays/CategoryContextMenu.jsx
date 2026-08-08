import { Pencil, Trash2 } from 'lucide-react'

export function CategoryContextMenu({ target, position, onRename, onDelete }) {
  if (!target) return <div id="category-menu" className="context-menu" aria-hidden="true" />
  return (
    <div id="category-menu" className="context-menu visible" role="menu" aria-hidden="false" style={{ left: position.x, top: position.y }}>
      <button id="menu-rename" type="button" role="menuitem" onClick={onRename}><Pencil size={15} /> Renommer</button>
      <button id="menu-delete" className="danger" type="button" role="menuitem" onClick={onDelete}><Trash2 size={15} /> Supprimer</button>
    </div>
  )
}
