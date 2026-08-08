import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Clock3, Copy, Ellipsis, KeyRound, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { passwordStrength } from '../../lib/security.js'
import { tauri } from '../../lib/tauri.js'

function initials(value = '') {
  return value.trim().slice(0, 2).toUpperCase() || '--'
}

function formatTotp(code = '') {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

function EntryAvatar({ entry }) {
  const [failed, setFailed] = useState(false)
  if (entry.icon_url && !failed) {
    return (
      <span className="entry-avatar entry-avatar-with-image">
        <img className="entry-avatar-image" src={entry.icon_url} alt="" onError={() => setFailed(true)} />
      </span>
    )
  }
  return <span className="entry-avatar">{initials(entry.plateforme)}</span>
}

export function EntryList({ entries, onEdit, onCopy, onFavorite, onTotp, onMenu, onNew }) {
  const reduced = useReducedMotion()
  const [totpCodes, setTotpCodes] = useState({})

  useEffect(() => {
    let active = true
    const targets = entries.filter((entry) => entry.totp_secret)
    if (!targets.length) {
      setTotpCodes({})
      return undefined
    }

    async function refreshCodes() {
      const next = {}
      await Promise.all(targets.map(async (entry) => {
        const key = `${entry.category}-${entry.index}`
        try {
          next[key] = await tauri.invoke('generer_totp', { secret: entry.totp_secret })
        } catch (_) {
          next[key] = { code: '', remaining: 0 }
        }
      }))
      if (active) setTotpCodes(next)
    }

    refreshCodes()
    const interval = setInterval(refreshCodes, 1000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [entries])

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
          const strength = passwordStrength(entry.mdp, [entry.plateforme, entry.email, entry.site])
          const totpKey = `${entry.category}-${entry.index}`
          const totp = totpCodes[totpKey]
          return (
            <motion.article
              className="entry-row"
              key={totpKey}
              data-category={entry.category}
              data-index={entry.index}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(2px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -3, filter: 'blur(1px)' }}
              transition={{ duration: reduced ? 0.01 : 0.18, delay: reduced ? 0 : Math.min(visibleIndex, 9) * 0.018 }}
              onContextMenu={(event) => { event.preventDefault(); onMenu(event, entry) }}
              onDoubleClick={() => onEdit(entry)}
            >
              <EntryAvatar entry={entry} />
              <div className="entry-summary"><strong>{entry.plateforme}</strong><span>{entry.email || 'Sans identifiant'}</span></div>
              <span className="entry-space">{entry.category}</span>
              <span className={`strength-badge ${strength.level}`}>{strength.label}</span>
              {entry.totp_secret ? (
                <button className="entry-totp-code" type="button" onClick={() => onTotp(entry)} aria-label={`Copier le code temporaire de ${entry.plateforme}`} title="Copier le code temporaire">
                  <Clock3 size={15} />
                  <span>{formatTotp(totp?.code) || '2FA'}</span>
                  <small>{totp?.remaining || 0} s</small>
                </button>
              ) : <span className="entry-totp-spacer" />}
              <button className={`entry-favorite${entry.favorite ? ' active' : ''}`} type="button" onClick={() => onFavorite(entry)} aria-label={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} title={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
                <Star size={17} fill={entry.favorite ? 'currentColor' : 'none'} />
              </button>
              <button className="entry-copy icon-button" type="button" onClick={() => onCopy(entry.mdp, 'Mot de passe copié.')} aria-label={`Copier le mot de passe de ${entry.plateforme}`} title="Copier le mot de passe">
                <Copy size={17} />
              </button>
              <button className="entry-more icon-button" type="button" onClick={(event) => onMenu(event, entry)} aria-label={`Actions pour ${entry.plateforme}`} title="Actions">
                <Ellipsis size={19} />
              </button>
            </motion.article>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
