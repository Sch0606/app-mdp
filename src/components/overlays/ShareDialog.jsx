import { AlertCircle, Check, Clock3, Copy, Eye, Globe, KeyRound, Link2, Lock, NotebookText, Server, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DelaySelector } from '../settings/DelaySelector.jsx'
import { Dialog } from './Dialog.jsx'

const ttlOptions = [
  { value: 3600, label: '1 h' },
  { value: 86400, label: '24 h' },
  { value: 259200, label: '3 j' },
  { value: 604800, label: '7 j' },
]

const initialOptions = { ttlSeconds: 86400, includeUsername: true, includeUrl: true, includeNotes: false }

function formatExpiry(timestamp) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

function serverHost(server) {
  return server.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

function ShareField({ id, icon, label, value, checked, locked, onChange }) {
  const empty = !locked && !value
  return (
    <label className={`share-field${checked && !empty ? ' is-on' : ''}${empty ? ' is-empty' : ''}`}>
      <span className="share-field-icon" aria-hidden="true">{icon}</span>
      <span className="share-field-text">
        <strong>{label}</strong>
        <small>{locked ? 'Toujours inclus' : value || 'Non renseigné'}</small>
      </span>
      {locked
        ? <Lock className="share-field-lock" size={14} aria-label="Inclus" />
        : <input id={id} type="checkbox" role="switch" checked={checked && !empty} disabled={empty} onChange={onChange} />}
    </label>
  )
}

export function ShareDialog({ target, server, onShare, onCopy, onConfigure, onClose }) {
  const [options, setOptions] = useState(initialOptions)
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setOptions(initialOptions)
    setLink(null)
    setBusy(false)
    setError('')
    setCopied(false)
  }, [target])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  function toggle(name) {
    return (event) => setOptions((current) => ({ ...current, [name]: event.target.checked }))
  }

  async function create() {
    setBusy(true)
    setError('')
    try {
      const result = await onShare(target, options)
      if (result?.error) setError(result.error)
      else if (result) setLink(result)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    await onCopy(link.url)
    setCopied(true)
  }

  const configured = Boolean(server.trim())
  const title = target?.plateforme || 'cet accès'

  let description
  let body
  let actions

  if (link) {
    description = 'Envoyez ce lien à la personne concernée. Il ne pourra être ouvert qu’une seule fois.'
    body = (
      <div className="share-result">
        <div className="share-success" aria-hidden="true"><Check size={22} /></div>
        <div className="share-link">
          <code id="share-link-value">{link.url}</code>
          <button className={`share-copy${copied ? ' is-copied' : ''}`} id="copy-share-link" type="button" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
        <ul className="share-facts">
          <li><Eye size={14} aria-hidden="true" /> Détruit dès la première ouverture</li>
          <li><Clock3 size={14} aria-hidden="true" /> Expire le {formatExpiry(link.expiresAt)}</li>
          <li><Lock size={14} aria-hidden="true" /> Clave ne garde aucune copie de ce lien</li>
        </ul>
      </div>
    )
    actions = <button className="primary-button" id="close-share" type="button" onClick={onClose}>Terminé</button>
  } else if (!configured) {
    description = 'Les liens de partage passent par votre propre serveur Clave. Indiquez son adresse pour commencer.'
    body = (
      <div className="share-empty">
        <span className="share-empty-icon" aria-hidden="true"><Server size={22} /></span>
        <p>Aucun serveur de partage n’est configuré. Paramètres › Partage explique pas à pas comment héberger le vôtre (une dizaine de minutes), puis où saisir son adresse.</p>
      </div>
    )
    actions = <>
      <button className="secondary-button" id="cancel-share" type="button" onClick={onClose}>Annuler</button>
      <button className="primary-button" id="configure-share" type="button" onClick={onConfigure}>Configurer le serveur</button>
    </>
  } else {
    description = 'Choisissez ce que la personne verra. Tout est chiffré sur cet appareil avant l’envoi.'
    body = (
      <div className="share-options">
        <fieldset className="share-fields">
          <legend>Contenu du lien</legend>
          <ShareField icon={<KeyRound size={15} />} label="Mot de passe" checked locked />
          <ShareField id="share-include-username" icon={<UserRound size={15} />} label="Identifiant" value={target?.email?.trim()} checked={options.includeUsername} onChange={toggle('includeUsername')} />
          <ShareField id="share-include-url" icon={<Globe size={15} />} label="Site" value={target?.site?.trim()} checked={options.includeUrl} onChange={toggle('includeUrl')} />
          <ShareField id="share-include-notes" icon={<NotebookText size={15} />} label="Notes" value={target?.notes?.trim()} checked={options.includeNotes} onChange={toggle('includeNotes')} />
        </fieldset>
        <div className="dialog-field">
          <span>Expire après</span>
          <DelaySelector name="share-ttl" className="share-ttl-options" value={options.ttlSeconds} options={ttlOptions} onChange={(value) => setOptions((current) => ({ ...current, ttlSeconds: value }))} />
        </div>
        {error && <p className="share-error" id="share-error" role="alert"><AlertCircle size={15} aria-hidden="true" /> {error}</p>}
        <p className="share-server"><Server size={13} aria-hidden="true" /> {serverHost(server)}</p>
        <p className="share-server">Le lien n’est sûr que si ce serveur est de confiance : pour un secret sensible, le destinataire peut utiliser le déchiffreur hors ligne.</p>
      </div>
    )
    actions = <>
      <button className="secondary-button" id="cancel-share" type="button" onClick={onClose}>Annuler</button>
      <button className="primary-button" id="confirm-share" type="button" disabled={busy} onClick={create}><Link2 size={15} /> {busy ? 'Création…' : error ? 'Réessayer' : 'Créer le lien'}</button>
    </>
  }

  return (
    <Dialog
      open={Boolean(target)}
      className="share-dialog"
      title={link ? 'Lien prêt' : `Partager « ${title} »`}
      labelledBy="share-title"
      description={description}
      onClose={onClose}
      actions={actions}
    >
      {body}
    </Dialog>
  )
}
