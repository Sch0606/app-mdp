import { ShieldCheck, Sparkles } from 'lucide-react'
import { auditEntries } from '../../lib/security.js'

export function SecurityTools({ entries, onGenerate }) {
  const audit = auditEntries(entries)
  const alerts = audit.weak + audit.reused + audit.stale

  return (
    <section className="security-strip" aria-label="État du coffre">
      <div>
        <span className="security-strip-icon"><ShieldCheck size={19} /></span>
        <span className="security-score-copy">
          <strong>Score de sécurité {audit.score}/100</strong>
          <small>{audit.label} - {alerts ? `${alerts} point${alerts > 1 ? 's' : ''} à vérifier` : 'Aucune alerte détectée'}</small>
        </span>
      </div>
      <div
        className="security-score-meter"
        aria-label={`Score de sécurité ${audit.score} sur 100`}
        role="meter"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={audit.score}
      >
        <span style={{ '--security-score': `${audit.score}%` }} />
      </div>
      <button className="secondary-button" type="button" onClick={onGenerate}><Sparkles size={16} /> Générer un mot de passe</button>
    </section>
  )
}
