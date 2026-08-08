import { motion, useReducedMotion } from 'framer-motion'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { BiometricScanner } from './BiometricScanner.jsx'
import { motionProps } from '../../motion/presets.js'

export function LockScreen({ configured, biometry, biometricState, busy, error, onPassword, onBiometry }) {
  const reduced = useReducedMotion()
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const canUseBiometry = biometry?.isAvailable && biometry?.isEnabled
  const authMethod = /windows|hello/i.test(biometry?.biometryType || '') ? 'Windows Hello' : 'la biométrie'

  function submit(event) {
    event.preventDefault()
    if (!password || busy) return
    onPassword(password)
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
        </form>
      </motion.section>
      <p className="auth-footnote">Protection locale · Rien n’est envoyé sans action de votre part</p>
    </main>
  )
}
