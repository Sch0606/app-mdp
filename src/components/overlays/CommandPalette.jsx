import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeText } from '../../lib/security.js'

export function CommandPalette({ open, entries, onClose, onSelect }) {
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const previousFocus = useRef(null)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(0)
  const results = useMemo(() => {
    const normalized = normalizeText(query)
    if (!normalized) return entries.slice(0, 8)
    return entries.filter((entry) => normalizeText(`${entry.plateforme} ${entry.email} ${entry.category}`).includes(normalized)).slice(0, 8)
  }, [entries, query])

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement
    setQuery('')
    setSelection(0)
    requestAnimationFrame(() => inputRef.current?.focus())

    function keepFocusInside(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...(panelRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInside)
    return () => {
      document.removeEventListener('keydown', keepFocusInside)
      previousFocus.current?.focus?.()
    }
  }, [open])

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelection((value) => Math.min(value + 1, Math.max(results.length - 1, 0)))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelection((value) => Math.max(value - 1, 0))
    }
    if (event.key === 'Enter' && results[selection]) onSelect(results[selection])
  }

  return (
    <div
      id="command-palette"
      className={`command-backdrop${open ? ' visible' : ''}`}
      aria-hidden={!open}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <AnimatePresence>
        {open && (
          <motion.section
            ref={panelRef}
            className="command-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Trouver un accès"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.01 }}
            onKeyDown={onKeyDown}
          >
            <header><div><p className="section-label">Recherche rapide</p><h2>Trouver un accès</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button></header>
            <label className="command-search"><Search size={18} /><span className="sr-only">Rechercher</span><input ref={inputRef} id="command-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelection(0) }} placeholder="Service, identifiant ou espace" /></label>
            <div className="command-results" id="command-results">
              {results.map((entry, index) => (
                <button key={`${entry.category}-${entry.index}`} className={`command-result${index === selection ? ' active' : ''}`} type="button" onMouseEnter={() => setSelection(index)} onClick={() => onSelect(entry)}>
                  <span className="command-result-icon"><KeyRound size={16} /></span>
                  <span><strong>{entry.plateforme}</strong><small>{entry.email || entry.category}</small></span>
                  <kbd>{entry.category}</kbd>
                </button>
              ))}
              {!results.length && <p className="command-empty">Aucun accès ne correspond à cette recherche.</p>}
            </div>
            <footer><span>↑ ↓ naviguer</span><span>Entrée ouvrir</span><span>Échap fermer</span></footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
