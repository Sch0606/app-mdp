import { Pencil, Trash2 } from 'lucide-react'
import { ContextMenu } from './ContextMenu.jsx'

export function CategoryContextMenu({ target, position, returnFocus, onClose, onRename, onDelete }) {
  return (
    <ContextMenu
      id="category-menu"
      open={Boolean(target)}
      label="Actions de l’espace"
      position={position}
      returnFocus={returnFocus}
      onClose={onClose}
      items={[
        { id: 'menu-rename', label: 'Renommer', icon: <Pencil size={15} />, onSelect: onRename },
        { id: 'menu-delete', label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, onSelect: onDelete },
      ]}
    />
  )
}
