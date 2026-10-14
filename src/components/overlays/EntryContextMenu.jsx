import { Copy, Link2, Pencil, Trash2, UserRound } from 'lucide-react'
import { ContextMenu } from './ContextMenu.jsx'

export function EntryContextMenu({ target, position, returnFocus, onClose, onEdit, onCopyPassword, onCopyEmail, onShare, onDelete }) {
  return (
    <ContextMenu
      id="entry-menu"
      open={Boolean(target)}
      label="Actions de l’accès"
      position={position}
      returnFocus={returnFocus}
      onClose={onClose}
      items={[
        { id: 'entry-menu-edit', label: 'Modifier', icon: <Pencil size={15} />, onSelect: onEdit },
        { id: 'entry-menu-copy-email', label: 'Copier l’identifiant', icon: <UserRound size={15} />, onSelect: onCopyEmail },
        { id: 'entry-menu-copy', label: 'Copier le mot de passe', icon: <Copy size={15} />, onSelect: onCopyPassword },
        { id: 'entry-menu-share', label: 'Partager par lien', icon: <Link2 size={15} />, onSelect: onShare },
        { id: 'entry-menu-delete', label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, onSelect: onDelete },
      ]}
    />
  )
}
