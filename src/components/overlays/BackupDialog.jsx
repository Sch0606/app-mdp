import { useEffect, useState } from 'react'
import { Dialog } from './Dialog.jsx'

export function BackupDialog({ state, onClose, onConfirm }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const exportMode = state?.mode === 'export'

  useEffect(() => setPassword(''), [state])

  async function confirm() {
    if (password.length < 8 || busy) return
    setBusy(true)
    try {
      await onConfirm(password)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={Boolean(state)}
      title={exportMode ? 'Exporter le coffre' : 'Importer le coffre'}
      labelledBy="backup-title"
      description={exportMode ? 'Choisissez un mot de passe distinct pour chiffrer la sauvegarde.' : 'Entrez le mot de passe utilisé pour protéger cette sauvegarde.'}
      onClose={onClose}
      actions={<><button className="secondary-button" id="cancel-backup" type="button" onClick={onClose}>Annuler</button><button className="primary-button" id="confirm-backup" type="button" disabled={password.length < 8 || busy} onClick={confirm}>{busy ? 'Traitement…' : exportMode ? 'Exporter' : 'Importer'}</button></>}
    >
      <label className="dialog-field"><span>Mot de passe de sauvegarde</span><input id="backup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') confirm() }} minLength={8} autoComplete="new-password" autoFocus /></label>
    </Dialog>
  )
}
