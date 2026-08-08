import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { softSpring } from '../../motion/presets.js'

export function Dialog({ open, title, description, children, onClose, actions, labelledBy }) {
  const reduced = useReducedMotion()
  const dialogRef = useRef(null)
  const previousFocus = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    previousFocus.current = document.activeElement

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKeyDown)
    requestAnimationFrame(() => {
      if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.querySelector('input, button')?.focus()
    })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus.current?.focus?.()
    }
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="dialog-backdrop visible" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.01 : 0.16 }} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
          <motion.section
            ref={dialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: .97, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -3, scale: .99 }}
            transition={reduced ? { duration: 0.01 } : softSpring}
          >
            <header><div><p className="section-label">Coffre</p><h2 id={labelledBy}>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button></header>
            {description && <p className="dialog-description">{description}</p>}
            <div className="dialog-content">{children}</div>
            {actions && <footer>{actions}</footer>}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
