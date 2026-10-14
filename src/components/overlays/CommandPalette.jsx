import { Copy, Edit3, ExternalLink, KeyRound, Search, ShieldCheck, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeText } from '../../lib/security.js'
import { ModalLayer } from './ModalLayer.jsx'

function fuzzyScore(normalized, haystack) {
  if (!normalized) return 1
  if (haystack.includes(normalized)) return 100 - haystack.indexOf(normalized)

  let score = 0
  let offset = 0
  for (const char of normalized) {
    const index = haystack.indexOf(char, offset)
    if (index === -1) return 0
    score += Math.max(1, 12 - (index - offset))
    offset = index + 1
  }
  return score
}

const actions = [
  { id: 'copy-password', label: 'Mot de passe', icon: Copy, shortcut: 'Ctrl+P' },
  { id: 'copy-email', label: 'Identifiant', icon: UserRound, shortcut: 'Ctrl+U' },
  { id: 'edit', label: 'Modifier', icon: Edit3, shortcut: 'Entrée' },
  { id: 'open-site', label: 'Site', icon: ExternalLink, shortcut: 'Ctrl+O', needs: (entry) => entry.site },
  { id: 'totp', label: '2FA', icon: ShieldCheck, shortcut: 'Ctrl+T', needs: (entry) => entry.totp_secret },
]

export function CommandPalette({ open, entries, onClose, onAction }) {
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(0)
  const searchIndex = useMemo(() => entries.map((entry) => ({
    entry,
    haystack: normalizeText(`${entry.plateforme || ''} ${entry.email || ''} ${entry.category || ''} ${entry.site || ''}`),
  })), [entries])
  const results = useMemo(() => {
    const normalized = normalizeText(query)
    const ranked = searchIndex
      .map(({ entry, haystack }) => ({ entry, score: fuzzyScore(normalized, haystack) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
    return ranked.slice(0, 8).map((result) => result.entry)
  }, [query, searchIndex])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelection(0)
  }, [open])

  function runAction(action, entry = results[selection]) {
    if (!entry) return
    onAction(action, entry)
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelection((value) => Math.min(value + 1, Math.max(results.length - 1, 0)))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelection((value) => Math.max(value - 1, 0))
    }
    if (event.key === 'Enter') runAction('edit')
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase()
      if (key === 'p') { event.preventDefault(); runAction('copy-password') }
      if (key === 'u') { event.preventDefault(); runAction('copy-email') }
      if (key === 'o') { event.preventDefault(); runAction('open-site') }
      if (key === 't') { event.preventDefault(); runAction('totp') }
    }
  }

  return (
    <>
      {!open && <div id="command-palette" className="command-backdrop" aria-hidden="true" />}
      <ModalLayer
        id="command-palette"
        open={open}
        ariaLabel="Trouver un accès"
        onClose={onClose}
        closeOnBackdrop
        closeOnEscape
        initialFocusRef={inputRef}
        layerClassName="command-backdrop visible"
        contentClassName="command-modal"
        instant
        onContentKeyDown={onKeyDown}
      >
        <header><div><p className="section-label">Recherche rapide</p><h2>Trouver un accès</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button></header>
        <label className="command-search"><Search size={18} /><span className="sr-only">Rechercher</span><input ref={inputRef} id="command-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelection(0) }} placeholder="Service, identifiant, espace ou site" /></label>
        <div className="command-results" id="command-results">
          {results.map((entry, index) => (
            <article key={`${entry.category}-${entry.index}`} className={`command-result${index === selection ? ' active' : ''}`} onMouseEnter={() => setSelection(index)}>
              <button className="command-result-main" type="button" onClick={() => runAction('edit', entry)}>
                <span className="command-result-icon"><KeyRound size={16} /></span>
                <span><strong>{entry.plateforme}</strong><small>{entry.email || entry.site || entry.category}</small></span>
                <kbd>{entry.category}</kbd>
              </button>
              <span className="command-actions">
                {actions.filter((action) => !action.needs || action.needs(entry)).map((action) => {
                  const Icon = action.icon
                  return <button key={action.id} type="button" title={`${action.label} · ${action.shortcut}`} aria-label={`${action.label} ${entry.plateforme}`} onClick={() => runAction(action.id, entry)}><Icon size={14} /></button>
                })}
              </span>
            </article>
          ))}
          {!results.length && <p className="command-empty">Aucun accès ne correspond à cette recherche.</p>}
        </div>
        <footer><span>↑ ↓ naviguer</span><span>Entrée modifier</span><span>Ctrl+P copier</span><span>Ctrl+O ouvrir</span></footer>
      </ModalLayer>
    </>
  )
}
