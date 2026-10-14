import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Clock3, Copy, Ellipsis, KeyRound, Star } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { tauri } from '../../lib/tauri.js'

const iconCache = new Map()

function initials(value = '') {
  return value.trim().slice(0, 2).toUpperCase() || '--'
}

function formatTotp(code = '') {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

function EntryAvatar({ entry }) {
  const [failed, setFailed] = useState(false)
  const [resolvedIcon, setResolvedIcon] = useState('')

  useEffect(() => {
    setFailed(false)
    setResolvedIcon('')
    if (entry.icon_url || !entry.site) return undefined
    let active = true
    const cacheKey = `${entry.site}\u0000${entry.plateforme}`
    let request = iconCache.get(cacheKey)
    if (!request) {
      request = tauri.invoke('resoudre_icone_site', { site: entry.site, service: entry.plateforme })
        .then((result) => result?.iconUrl || '')
        .catch(() => '')
      iconCache.set(cacheKey, request)
    }
    request
      .then((result) => {
        if (active) setResolvedIcon(result)
      })
    return () => { active = false }
  }, [entry.icon_url, entry.plateforme, entry.site])

  const iconUrl = entry.icon_url || resolvedIcon
  if (iconUrl && !failed) {
    return (
      <span className="entry-avatar entry-avatar-with-image">
        <img className="entry-avatar-image" src={iconUrl} alt="" onError={() => setFailed(true)} />
      </span>
    )
  }
  return <span className="entry-avatar">{initials(entry.plateforme)}</span>
}

function TotpCode({ entry, onCopy }) {
  const [totp, setTotp] = useState(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    let active = true
    let refreshTimer
    let tickTimer

    async function refresh() {
      try {
        const result = await tauri.invoke('generer_totp', { secret: entry.totp_secret })
        if (!active) return
        const current = Math.floor(Date.now() / 1000)
        setNow(current)
        setTotp({ ...result, expiresAt: current + Math.max(Number(result?.remaining) || 0, 1) })
        refreshTimer = setTimeout(refresh, Math.max(Number(result?.remaining) || 30, 1) * 1000)
      } catch (_) {
        if (active) refreshTimer = setTimeout(refresh, 30000)
      }
    }

    refresh()
    tickTimer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => {
      active = false
      clearTimeout(refreshTimer)
      clearInterval(tickTimer)
    }
  }, [entry.totp_secret])

  const remaining = Math.max(0, (totp?.expiresAt || now) - now)
  return (
    <button className="entry-totp-code" type="button" onClick={() => onCopy(entry)} aria-label={`Copier le code temporaire de ${entry.plateforme}`} title="Copier le code temporaire">
      <Clock3 size={15} />
      <span>{formatTotp(totp?.code) || '2FA'}</span>
      <small>{remaining} s</small>
    </button>
  )
}

const EntryRow = memo(function EntryRow({ entry, strength, reduced, animationIndex, onEdit, onCopy, onFavorite, onTotp, onMenu }) {
  const entryKey = `${entry.category}-${entry.index}`
  return (
    <motion.article
      className="entry-row"
      data-category={entry.category}
      data-index={entry.index}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -3 }}
      transition={{ duration: reduced ? 0.01 : 0.18, delay: reduced ? 0 : Math.min(animationIndex, 9) * 0.018 }}
      onContextMenu={(event) => { event.preventDefault(); onMenu(event, entry) }}
      onDoubleClick={() => onEdit(entry)}
    >
      <EntryAvatar entry={entry} />
      <div className="entry-summary">
        <strong>{entry.plateforme}</strong>
        <span className="entry-meta">
          <span>{entry.email || 'Sans identifiant'}</span>
          <span className={`strength-badge ${strength?.level || 'medium'}`}>{strength?.label || 'Analyse'}</span>
          {entry.tags?.slice(0, 3).map((tag) => <span className="entry-tag" key={tag}>#{tag}</span>)}
          {entry.tags?.length > 3 && <span className="entry-tag">+{entry.tags.length - 3}</span>}
        </span>
      </div>
      {entry.totp_secret ? <TotpCode entry={entry} onCopy={onTotp} /> : <span className="entry-totp-spacer" />}
      <div className="entry-actions">
        <button className={`entry-favorite${entry.favorite ? ' active' : ''}`} type="button" onClick={() => onFavorite(entry)} aria-label={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} title={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
          <Star size={17} fill={entry.favorite ? 'currentColor' : 'none'} />
        </button>
        <button className="entry-copy icon-button" type="button" onClick={() => onCopy(entry.mdp, 'Mot de passe copié.')} aria-label={`Copier le mot de passe de ${entry.plateforme}`} title="Copier le mot de passe">
          <Copy size={17} />
        </button>
        <button className="entry-more icon-button" type="button" onClick={(event) => onMenu(event, entry)} aria-label={`Actions pour ${entry.plateforme}`} title="Actions">
          <Ellipsis size={19} />
        </button>
      </div>
    </motion.article>
  )
})

export function EntryList({ entries, strengthEntries = entries, onEdit, onCopy, onFavorite, onTotp, onMenu, onNew }) {
  const reduced = useReducedMotion()
  const [strengths, setStrengths] = useState(new Map())

  useEffect(() => {
    let active = true
    import('../../lib/passwordStrength.js').then(({ passwordStrength }) => {
      const next = new Map()
      strengthEntries.forEach((entry) => {
        const key = `${entry.category}-${entry.index}`
        next.set(key, passwordStrength(entry.mdp, [entry.plateforme, entry.email, entry.site]))
      })
      if (active) setStrengths(next)
    })
    return () => { active = false }
  }, [strengthEntries])

  if (!entries.length) {
    return (
      <div id="liste-mdp" className="entry-list">
        <div className="empty-vault">
          <span><KeyRound size={26} /></span>
          <h3>Aucun accès ici</h3>
          <p>Ajoutez votre premier accès ou changez le filtre actif.</p>
          <button className="primary-button" id="empty-new-access" type="button" onClick={onNew}>Ajouter un accès</button>
        </div>
      </div>
    )
  }

  return (
    <div id="liste-mdp" className="entry-list">
      <AnimatePresence initial={false}>
        {entries.map((entry, visibleIndex) => {
          const totpKey = `${entry.category}-${entry.index}`
          const strength = strengths.get(totpKey)
          return (
            <EntryRow
              key={totpKey}
              entry={entry}
              strength={strength}
              reduced={reduced}
              animationIndex={visibleIndex}
              onEdit={onEdit}
              onCopy={onCopy}
              onFavorite={onFavorite}
              onTotp={onTotp}
              onMenu={onMenu}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
}
