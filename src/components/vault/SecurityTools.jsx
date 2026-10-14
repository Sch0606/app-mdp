import { ShieldCheck } from 'lucide-react'
import { memo, useEffect, useState } from 'react'

const pendingAudit = { weak: 0, reused: 0, stale: 0, score: 100, label: 'Analyse', averageStrength: 100, total: 0 }

export const SecurityTools = memo(function SecurityTools({ entries, onOpen }) {
  const [audit, setAudit] = useState(pendingAudit)
  const alerts = audit.weak + audit.reused + audit.stale

  useEffect(() => {
    let active = true
    import('../../lib/passwordStrength.js').then(({ auditEntries }) => {
      if (active) setAudit(auditEntries(entries))
    })
    return () => { active = false }
  }, [entries])

  return (
    <button className="security-summary" type="button" onClick={onOpen} aria-label={`Santé du coffre, score ${audit.score} sur 100`}>
      <span className="security-summary-icon"><ShieldCheck size={17} /></span>
      <span className="security-summary-copy">
        <strong>{audit.score}/100</strong>
        <small>{alerts ? `${alerts} alerte${alerts > 1 ? 's' : ''}` : 'Coffre sain'}</small>
      </span>
    </button>
  )
})
