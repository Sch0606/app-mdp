import { Copy, FileDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { downloadEmergencyKit, formatRecoveryKeyLines } from '../../lib/emergencyKit.js'
import { Dialog } from './Dialog.jsx'

export function RecoveryKitDialog({ kit, onCopy, onFeedback, onClose }) {
  const [saved, setSaved] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    setSaved(false)
    setDownloaded(false)
  }, [kit])

  function download() {
    try {
      downloadEmergencyKit(kit.key)
      setDownloaded(true)
    } catch (_) {
      onFeedback('Le kit PDF n’a pas pu être créé. Recopiez la clé à la main.')
    }
  }

  return (
    <Dialog
      open={Boolean(kit)}
      title="Kit de secours"
      labelledBy="recovery-kit-title"
      description={kit?.mode === 'setup'
        ? 'Votre coffre est créé. Conservez cette clé : c’est le seul moyen de l’ouvrir si vous oubliez le mot de passe maître.'
        : 'Une nouvelle clé de récupération a été créée. L’ancienne ne fonctionne plus.'}
      dismissible={false}
      onClose={onClose}
      actions={<button className="primary-button" id="confirm-recovery-kit" type="button" disabled={!saved} onClick={onClose}>Continuer</button>}
    >
      <div className="recovery-kit">
        <code id="recovery-key-value" aria-label="Clé de récupération">
          {formatRecoveryKeyLines(kit?.key || '').map((line) => <span key={line}>{line}</span>)}
        </code>
        <div className="settings-actions">
          <button className="primary-button" id="download-recovery-kit" type="button" onClick={download}><FileDown size={16} /> Télécharger le PDF</button>
          <button className="secondary-button" id="copy-recovery-key" type="button" onClick={() => onCopy(kit.key)}><Copy size={15} /> Copier</button>
        </div>
        <p className="recovery-kit-advice">
          {downloaded ? 'Imprimez le PDF puis supprimez-le de l’ordinateur. ' : ''}
          Ne rangez pas cette clé dans Clave : toute personne qui la possède peut ouvrir le coffre.
        </p>
        <label className="recovery-kit-confirm">
          <input id="recovery-kit-saved" type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>J’ai imprimé ou noté cette clé en lieu sûr.</span>
        </label>
      </div>
    </Dialog>
  )
}
