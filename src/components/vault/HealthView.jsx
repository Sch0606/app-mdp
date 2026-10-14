import { AlertTriangle, CalendarClock, Copy, ExternalLink, Globe2, KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, tauri } from '../../lib/tauri.js'

const STALE_WINDOW_SECONDS = 90 * 24 * 60 * 60
const pendingAudit = { weak: 0, reused: 0, stale: 0, score: 100, label: 'Analyse', total: 0 }

const CHANGE_ON_SITE_ISSUES = new Set(['breached', 'weak', 'reused', 'stale'])
const idleBreach = { status: 'idle', counts: new Map(), checked: 0, error: '' }

const DISMISSED_DUPLICATES_KEY = 'clave-dismissed-duplicates'
const COMPARED_FIELDS = [
  ['plateforme', 'Nom'],
  ['email', 'Identifiant'],
  ['site', 'Site'],
  ['category', 'Catégorie'],
  ['mdp', 'Mot de passe'],
  ['totp_secret', '2FA'],
  ['notes', 'Notes'],
  ['updated_at', 'Modifié le'],
]

// Seules des empreintes SHA-256 sont stockées : aucun domaine ni identifiant en clair.
async function hashPairKey(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readDismissedDuplicates() {
  try {
    const value = JSON.parse(localStorage.getItem(DISMISSED_DUPLICATES_KEY) || '[]')
    return new Set(Array.isArray(value) ? value : [])
  } catch {
    return new Set()
  }
}

function comparedValue(entry, field) {
  const value = entry[field]
  if (field === 'mdp') return value ? '••••••••' : '—'
  if (field === 'totp_secret') return value ? 'Configurée' : '—'
  if (field === 'updated_at') return Number(value) ? new Date(Number(value) * 1000).toLocaleDateString('fr-FR') : '—'
  return value || '—'
}

function DuplicateCard({ pairs, onAction, onDismiss }) {
  const [compared, setCompared] = useState('')
  return (
    <section className="health-card duplicate-card" id="duplicate-card">
      <header>
        <span><Copy size={18} /></span>
        <div>
          <h3>Doublons possibles</h3>
          <p>Même site et même identifiant. Fusionner garde le mot de passe le plus récent et place l’autre entrée dans la corbeille.</p>
        </div>
        <strong>{pairs.length}</strong>
      </header>
      {pairs.length ? (
        <div className="duplicate-list">
          {pairs.slice(0, 5).map((pair) => {
            const open = compared === pair.key
            return (
              <div className="duplicate-pair" key={pair.key}>
                <div className="duplicate-pair-summary">
                  <span>
                    <strong>{pair.keep.plateforme || pair.domain}</strong>
                    <small>{pair.keep.email} · {pair.keep.category}{pair.drop.category !== pair.keep.category ? ` / ${pair.drop.category}` : ''}</small>
                  </span>
                  <div className="duplicate-actions">
                    <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setCompared(open ? '' : pair.key)}>{open ? 'Masquer' : 'Comparer'}</button>
                    <button type="button" className="secondary-button" onClick={() => onAction('merge-duplicates', { keep: pair.keep, drop: pair.drop })}>Fusionner</button>
                    <button type="button" className="secondary-button" onClick={() => onDismiss(pair.key)}>Pas des doublons</button>
                  </div>
                </div>
                {open && (
                  <table className="duplicate-compare">
                    <thead>
                      <tr><th scope="col"><span className="sr-only">Champ</span></th><th scope="col">Conservée</th><th scope="col">Corbeille</th></tr>
                    </thead>
                    <tbody>
                      {COMPARED_FIELDS.map(([field, label]) => {
                        const differs = String(pair.keep[field] || '') !== String(pair.drop[field] || '')
                        return (
                          <tr key={field} className={differs ? 'differs' : undefined}>
                            <th scope="row">{label}</th>
                            <td>{comparedValue(pair.keep, field)}</td>
                            <td>{comparedValue(pair.drop, field)}{differs && field === 'mdp' && <em> (différent)</em>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
          {pairs.length > 5 && <small>{pairs.length - 5} autre{pairs.length - 5 > 1 ? 's' : ''} paire{pairs.length - 5 > 1 ? 's' : ''}</small>}
        </div>
      ) : (
        <p className="health-empty">Aucun doublon détecté.</p>
      )}
    </section>
  )
}

function formatCount(count) {
  return new Intl.NumberFormat('fr-FR').format(count)
}

function issueCount(issues) {
  return issues.reduce((total, issue) => total + issue.entries.length, 0)
}

export function HealthView({ entries, onAction }) {
  const [strengths, setStrengths] = useState(new Map())
  const [audit, setAudit] = useState(pendingAudit)
  const [breach, setBreach] = useState(idleBreach)
  const [duplicates, setDuplicates] = useState([])
  const [dismissed, setDismissed] = useState(readDismissedDuplicates)
  const breachRequest = useRef(0)
  const now = Math.floor(Date.now() / 1000)
  const signature = useMemo(
    () => entries.map((entry) => `${entry.category}:${entry.index}:${entry.mdp}:${entry.updated_at}:${entry.site}:${entry.totp_secret}`).join('|'),
    [entries],
  )

  useEffect(() => {
    let active = true
    import('../../lib/passwordStrength.js').then(async ({ auditEntries, findDuplicateEntries, passwordStrength }) => {
      const next = new Map()
      entries.forEach((entry) => {
        next.set(`${entry.category}-${entry.index}`, passwordStrength(entry.mdp, [entry.plateforme, entry.email, entry.site]))
      })
      if (active) {
        setStrengths(next)
        setAudit(auditEntries(entries, now))
      }
      const pairs = await Promise.all(findDuplicateEntries(entries).map(async (pair) => ({ ...pair, key: await hashPairKey(pair.key) })))
      if (active) setDuplicates(pairs)
    })
    return () => { active = false }
  }, [entries, signature])

  function dismissDuplicate(key) {
    setDismissed((current) => {
      const next = new Set(current).add(key)
      try { localStorage.setItem(DISMISSED_DUPLICATES_KEY, JSON.stringify([...next])) } catch { /* stockage indisponible */ }
      return next
    })
  }

  const visibleDuplicates = useMemo(() => duplicates.filter((pair) => !dismissed.has(pair.key)), [dismissed, duplicates])

  async function checkBreaches() {
    const request = breachRequest.current + 1
    breachRequest.current = request
    setBreach((current) => ({ ...current, status: 'checking', error: '' }))
    try {
      const report = await tauri.invoke('verifier_fuites')
      if (breachRequest.current !== request) return
      const counts = new Map((report?.compromised || []).map((item) => [`${item.categorie}-${item.index}`, item.count]))
      setBreach({ status: 'done', counts, checked: report?.checked || 0, error: '' })
    } catch (cause) {
      if (breachRequest.current === request) {
        setBreach({ ...idleBreach, status: 'error', error: errorMessage(cause, 'La vérification des fuites a échoué.') })
      }
    }
  }

  // Après une correction, relance la vérification si elle avait déjà été faite.
  const checkedOnce = breach.status === 'done'
  useEffect(() => {
    if (checkedOnce) checkBreaches()
  }, [signature])

  useEffect(() => () => { breachRequest.current += 1 }, [])

  const passwordCounts = useMemo(() => {
    const counts = new Map()
    entries.forEach((entry) => {
      if (entry.mdp) counts.set(entry.mdp, (counts.get(entry.mdp) || 0) + 1)
    })
    return counts
  }, [entries])

  const issues = useMemo(() => [
    {
      id: 'breached',
      title: 'Mots de passe compromis',
      icon: <ShieldAlert size={18} />,
      advice: 'Présents dans des fuites de données connues : changez-les en priorité.',
      breach: true,
      entries: entries.filter((entry) => breach.counts.has(`${entry.category}-${entry.index}`)),
    },
    {
      id: 'weak',
      title: 'Mots de passe faibles',
      icon: <AlertTriangle size={18} />,
      advice: 'Remplacez-les par des mots de passe longs et uniques.',
      entries: entries.filter((entry) => strengths.get(`${entry.category}-${entry.index}`)?.level === 'weak'),
    },
    {
      id: 'reused',
      title: 'Mots de passe réutilisés',
      icon: <KeyRound size={18} />,
      advice: 'Chaque service devrait avoir son propre mot de passe.',
      entries: entries.filter((entry) => entry.mdp && passwordCounts.get(entry.mdp) > 1),
    },
    {
      id: 'stale',
      title: 'Anciens mots de passe',
      icon: <CalendarClock size={18} />,
      advice: 'Vérifiez les accès importants qui n’ont pas été mis à jour récemment.',
      entries: entries.filter((entry) => Number(entry.updated_at || 0) > 0 && Number(entry.updated_at || 0) < now - STALE_WINDOW_SECONDS),
    },
    {
      id: 'totp',
      title: 'Entrées sans 2FA',
      icon: <ShieldQuestion size={18} />,
      advice: 'Activez un code 2FA quand le service le propose.',
      entries: entries.filter((entry) => !entry.totp_secret),
    },
    {
      id: 'site',
      title: 'Entrées sans site web',
      icon: <Globe2 size={18} />,
      advice: 'Ajouter le site améliore la recherche et l’icône associée.',
      entries: entries.filter((entry) => !entry.site),
    },
  ], [breach.counts, entries, now, passwordCounts, strengths])

  const totalIssues = issueCount(issues) + visibleDuplicates.length

  return (
    <div className="health-view" id="health-view">
      <section className="health-hero" aria-label="Santé du coffre">
        <span className="health-hero-icon"><ShieldCheck size={24} /></span>
        <div>
          <p className="section-label">Santé du coffre</p>
          <h2>{audit.score}/100</h2>
          <span>{audit.label} · {totalIssues ? `${totalIssues} point${totalIssues > 1 ? 's' : ''} à vérifier` : 'Aucune action urgente'}</span>
        </div>
      </section>

      <div className="health-grid">
        <DuplicateCard pairs={visibleDuplicates} onAction={onAction} onDismiss={dismissDuplicate} />
        {issues.map((issue) => (
          <section className="health-card" key={issue.id}>
            <header>
              <span>{issue.icon}</span>
              <div>
                <h3>{issue.title}</h3>
                <p>{issue.advice}</p>
              </div>
              <strong>{issue.breach && breach.status !== 'done' ? '–' : issue.entries.length}</strong>
            </header>
            {issue.breach && breach.status !== 'done' ? (
              <div className="breach-check" id="breach-check">
                <p>
                  {breach.status === 'error'
                    ? breach.error
                    : 'Clave compare l’empreinte de vos mots de passe à la base Have I Been Pwned. Seuls 5 caractères d’un hachage SHA-1 sont envoyés : les mots de passe ne quittent jamais l’appareil.'}
                </p>
                <button className="secondary-button" id="check-breaches" type="button" disabled={breach.status === 'checking'} onClick={checkBreaches}>
                  <RefreshCw size={15} className={breach.status === 'checking' ? 'spin' : ''} /> {breach.status === 'checking' ? 'Vérification…' : breach.status === 'error' ? 'Réessayer' : 'Vérifier les fuites'}
                </button>
              </div>
            ) : issue.entries.length ? (
              <div className="health-entry-list">
                {issue.entries.slice(0, 5).map((entry) => (
                  <div className="health-entry" key={`${issue.id}-${entry.category}-${entry.index}`}>
                    <button type="button" onClick={() => onAction('edit-entry', entry)}>
                      <span><strong>{entry.plateforme || 'Accès sans nom'}</strong><small>{issue.breach ? `Vu ${formatCount(breach.counts.get(`${entry.category}-${entry.index}`))} fois dans des fuites` : entry.email || entry.category}</small></span>
                      <em>Corriger</em>
                    </button>
                    {CHANGE_ON_SITE_ISSUES.has(issue.id) && entry.site && (
                      <button type="button" className="health-change-site" title={`Ouvrir la page de changement de mot de passe de ${entry.plateforme || entry.site}`} onClick={() => onAction('change-password-on-site', entry)}>
                        <ExternalLink size={14} /> <em>Changer sur le site</em>
                      </button>
                    )}
                  </div>
                ))}
                {issue.entries.length > 5 && <small>{issue.entries.length - 5} autre{issue.entries.length - 5 > 1 ? 's' : ''} entrée{issue.entries.length - 5 > 1 ? 's' : ''}</small>}
              </div>
            ) : (
              <p className="health-empty">{issue.breach ? `Aucune fuite connue parmi ${breach.checked} mot${breach.checked > 1 ? 's' : ''} de passe vérifié${breach.checked > 1 ? 's' : ''}.` : 'Aucun problème détecté.'}</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
