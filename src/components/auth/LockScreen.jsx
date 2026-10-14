import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Eye, EyeOff, KeyRound, LifeBuoy } from 'lucide-react'
import { useState } from 'react'
import { BiometricScanner } from './BiometricScanner.jsx'
import { motionProps } from '../../motion/presets.js'

export function LockScreen({ configured, recoveryAvailable, biometry, biometricState, busy, error, onPassword, onBiometry, onRecover }) {
  const reduced = useReducedMotion()
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [recovery, setRecovery] = useState({ key: '', next: '', confirm: '' })
  const [recoveryError, setRecoveryError] = useState('')
  const canUseBiometry = biometry?.isAvailable && biometry?.isEnabled
  const biometryType = biometry?.biometryType || ''
  const authMethod = /touch.?id/i.test(biometryType)
    ? 'Touch ID'
    : /windows|hello/i.test(biometryType)
      ? 'Windows Hello'
      : 'la biométrie'

  function submit(event) {
    event.preventDefault()
    if (!password || busy) return
    onPassword(password)
  }

  function submitRecovery(event) {
    event.preventDefault()
    if (busy) return
    if (recovery.next !== recovery.confirm) {
      setRecoveryError('Les deux mots de passe ne correspondent pas.')
      return
    }
    setRecoveryError('')
    onRecover(recovery.key, recovery.next)
  }

  if (recovering) {
    return (
      <main className="auth-shell">
        <motion.section className="auth-panel" {...motionProps(reduced)}>
          <div className="auth-heading">
            <p>Kit de secours</p>
            <h1>Récupérer le coffre</h1>
            <span>Saisissez la clé de récupération imprimée lors de la création du coffre, puis choisissez un nouveau mot de passe maître.</span>
          </div>
          <form className="auth-form" id="recovery-form" onSubmit={submitRecovery}>
            <label htmlFor="recovery-key">Clé de récupération</label>
            <div className="input-with-action">
              <LifeBuoy size={18} aria-hidden="true" />
              <input id="recovery-key" className="recovery-key-input" value={recovery.key} onChange={(event) => setRecovery((current) => ({ ...current, key: event.target.value }))} placeholder="XXXX-XXXX-XXXX-XXXX-…" autoComplete="off" spellCheck="false" autoFocus />
            </div>
            <label htmlFor="recovery-new-password">Nouveau mot de passe maître</label>
            <div className="input-with-action">
              <KeyRound size={18} aria-hidden="true" />
              <input id="recovery-new-password" type="password" value={recovery.next} onChange={(event) => setRecovery((current) => ({ ...current, next: event.target.value }))} minLength={8} autoComplete="new-password" />
            </div>
            <label htmlFor="recovery-confirm-password">Confirmer</label>
            <div className="input-with-action">
              <KeyRound size={18} aria-hidden="true" />
              <input id="recovery-confirm-password" type="password" value={recovery.confirm} onChange={(event) => setRecovery((current) => ({ ...current, confirm: event.target.value }))} minLength={8} autoComplete="new-password" />
            </div>
            {(recoveryError || error) && <p className="auth-error" role="alert">{recoveryError || error}</p>}
            <button className="primary-button auth-submit" type="submit" disabled={busy || recovery.key.trim().length < 16 || recovery.next.length < 8}>
              {busy ? 'Vérification...' : 'Récupérer le coffre'}
            </button>
            <button className="text-button auth-link" id="cancel-recovery" type="button" onClick={() => { setRecovering(false); setRecoveryError('') }}><ArrowLeft size={15} /> Retour au mot de passe</button>
          </form>
        </motion.section>
        <p className="auth-footnote">La clé de récupération reste valable après la réinitialisation.</p>
      </main>
    )
  }

  return (
    <main className="auth-shell">
      <motion.section className="auth-panel" {...motionProps(reduced)}>
        <div className="auth-heading">
          <p>Protection locale</p>
          <h1>{configured ? 'Déverrouiller Clave' : 'Créer votre coffre'}</h1>
          <span>{configured ? 'Vos données restent protégées tant que le coffre est fermé.' : 'Définissez le mot de passe qui protège ce coffre sur cet appareil.'}</span>
        </div>

        {canUseBiometry && (
          <BiometricScanner state={biometricState} onActivate={onBiometry} message={error} methodLabel={authMethod} />
        )}

        {canUseBiometry && <div className="auth-divider"><span>ou utiliser votre mot de passe</span></div>}

        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="master-password">Mot de passe maître</label>
          <div className="input-with-action">
            <KeyRound size={18} aria-hidden="true" />
            <input
              id="master-password"
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={8}
              autoFocus={!canUseBiometry}
            />
            <button
              type="button"
              className="icon-button password-eye-button"
              aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              title={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              onClick={() => setVisible((value) => !value)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={busy || password.length < 8}>
            {busy ? 'Vérification...' : configured ? 'Déverrouiller' : 'Créer le coffre'}
          </button>
          {configured && recoveryAvailable && (
            <button className="text-button auth-link" id="forgot-password" type="button" onClick={() => setRecovering(true)}>Mot de passe oublié ?</button>
          )}
        </form>
      </motion.section>
      <p className="auth-footnote">Protection locale · Rien n’est envoyé sans action de votre part</p>
    </main>
  )
}
