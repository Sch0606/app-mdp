import { useEffect, useState } from 'react'
import { Dialog } from './Dialog.jsx'

export function ImportPreviewDialog({ entries, onClose, onConfirm }) {
  const [selected, setSelected] = useState([])

  useEffect(() => setSelected(entries.map((_, index) => index)), [entries])

  function toggle(index) {
    setSelected((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])
  }

  return (
    <Dialog
      open={entries.length > 0}
      title="Accès détectés"
      labelledBy="import-preview-title"
      description="Sélectionnez les accès à importer, puis supprimez le fichier exporté : il est en clair."
      onClose={onClose}
      actions={<><button className="secondary-button" id="cancel-import-preview" type="button" onClick={onClose}>Annuler</button><button className="primary-button" id="confirm-import-preview" type="button" disabled={!selected.length} onClick={() => onConfirm(selected.map((index) => entries[index]))}>Importer {selected.length} accès</button></>}
    >
      <div className="import-preview-list" id="import-preview-list">
        {entries.map((entry, index) => (
          <label className="import-preview-row" key={`${entry.plateforme}-${entry.email}-${index}`}>
            <input type="checkbox" checked={selected.includes(index)} onChange={() => toggle(index)} />
            <span><strong>{entry.plateforme || 'Accès sans nom'}</strong><small>{[entry.email || 'Sans identifiant', entry.site].filter(Boolean).join(' · ')}</small></span>
            {entry.categorie && <em className="import-preview-category">{entry.categorie}</em>}
          </label>
        ))}
      </div>
    </Dialog>
  )
}
