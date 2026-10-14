import { X } from 'lucide-react'
import { ModalLayer } from './ModalLayer.jsx'

export function Dialog({ open, className = '', title, description, children, onClose, actions, labelledBy, dismissible = true }) {
  return (
    <ModalLayer
      open={open}
      labelledBy={labelledBy}
      describedBy={description ? `${labelledBy}-description` : undefined}
      onClose={onClose}
      closeOnBackdrop={dismissible}
      closeOnEscape={dismissible}
      contentClassName={`dialog ${className}`.trim()}
    >
      <header><div><p className="section-label">Coffre</p><h2 id={labelledBy}>{title}</h2></div>{dismissible && <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button>}</header>
      {description && <p className="dialog-description" id={`${labelledBy}-description`}>{description}</p>}
      {children && <div className="dialog-content">{children}</div>}
      {actions && <footer>{actions}</footer>}
    </ModalLayer>
  )
}
