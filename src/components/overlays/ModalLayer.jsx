import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = [
  '[autofocus]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function assignRef(ref, value) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

function ModalSurface({
  id,
  ariaLabel,
  labelledBy,
  describedBy,
  children,
  onClose,
  closeOnBackdrop,
  closeOnEscape,
  initialFocusRef,
  contentRef,
  layerClassName,
  contentClassName,
  instant,
  onContentKeyDown,
}) {
  const reduced = useReducedMotion()
  const dialogRef = useRef(null)
  const panelRef = useRef(null)
  const previousFocus = useRef(null)
  const closing = useRef(false)
  const onCloseRef = useRef(onClose)
  const theme = document.querySelector('.clave-app')?.dataset.theme || 'light'
  onCloseRef.current = onClose

  function requestClose() {
    if (closing.current) return
    closing.current = true
    onCloseRef.current?.()
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    previousFocus.current = document.activeElement

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')

    const focusTarget = initialFocusRef?.current
      || panelRef.current?.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')
      || panelRef.current?.querySelector(FOCUSABLE)
      || panelRef.current
    requestAnimationFrame(() => focusTarget?.focus?.({ preventScroll: true }))

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      const target = previousFocus.current
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus?.({ preventScroll: true })
      })
    }
  }, [])

  const withoutMotion = reduced || instant
  const backdropMotion = withoutMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } }
  const panelMotion = withoutMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 8, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -3, scale: 0.995 },
        transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
      }

  return (
    <motion.dialog
      {...backdropMotion}
      ref={dialogRef}
      id={id}
      data-theme={theme}
      className={`popup-layer ${layerClassName || ''}`.trim()}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault()
        if (closeOnEscape) requestClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !closeOnEscape) return
        event.preventDefault()
        event.stopPropagation()
        requestClose()
      }}
      onPointerDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) requestClose()
      }}
    >
      <motion.section
        {...panelMotion}
        ref={(node) => {
          panelRef.current = node
          assignRef(contentRef, node)
        }}
        className={`popup-panel ${contentClassName || ''}`.trim()}
        tabIndex={-1}
        onKeyDown={onContentKeyDown}
      >
        {children}
      </motion.section>
    </motion.dialog>
  )
}

export function ModalLayer({ open, ...props }) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && <ModalSurface key={props.id || 'modal-layer'} {...props} />}
    </AnimatePresence>,
    document.body,
  )
}
