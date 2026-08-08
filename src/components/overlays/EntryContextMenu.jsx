import { Copy, Pencil, Trash2, UserRound } from 'lucide-react'

export function EntryContextMenu({ target, position, onEdit, onCopyPassword, onCopyEmail, onDelete }) {
  if (!target) return <div id="entry-menu" className="context-menu entry-context-menu" aria-hidden="true" />

  return (
    <div id="entry-menu" className="context-menu entry-context-menu visible" role="menu" aria-hidden="false" style={{ left: position.x, top: position.y }}>
      <button id="entry-menu-edit" type="button" role="menuitem" onClick={onEdit}><Pencil size={15} /> Modifier</button>
      <button id="entry-menu-copy-email" type="button" role="menuitem" onClick={onCopyEmail}><UserRound size={15} /> Copier l’identifiant</button>
      <button id="entry-menu-copy" type="button" role="menuitem" onClick={onCopyPassword}><Copy size={15} /> Copier le mot de passe</button>
      <button id="entry-menu-delete" className="danger" type="button" role="menuitem" onClick={onDelete}><Trash2 size={15} /> Supprimer</button>
    </div>
  )
}
