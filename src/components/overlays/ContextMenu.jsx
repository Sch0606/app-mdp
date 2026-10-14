import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VIEWPORT_GAP = 8

function MenuSurface({ id, label, position, items, onClose, returnFocus }) {
  const reduced = useReducedMotion()
  const menuRef = useRef(null)
  const restoreFocus = useRef(false)
  const focusTarget = useRef(returnFocus || document.activeElement)
  const [resolvedPosition, setResolvedPosition] = useState(position)
  const theme = document.querySelector('.clave-app')?.dataset.theme || 'light'

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    setResolvedPosition({
      x: Math.max(VIEWPORT_GAP, Math.min(position.x, window.innerWidth - rect.width - VIEWPORT_GAP)),
      y: Math.max(VIEWPORT_GAP, Math.min(position.y, window.innerHeight - rect.height - VIEWPORT_GAP)),
    })
  }, [position.x, position.y, items.length])

  useEffect(() => {
    const menu = menuRef.current
    requestAnimationFrame(() => menu?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true }))

    function closeFromOutside(event) {
      if (!menu?.contains(event.target)) onClose()
    }

    document.addEventListener('pointerdown', closeFromOutside, true)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true)
      if (restoreFocus.current) {
        const target = focusTarget.current
        requestAnimationFrame(() => {
          if (target?.isConnected) target.focus?.({ preventScroll: true })
        })
      }
    }
  }, [])

  function onKeyDown(event) {
    const menuItems = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
    const currentIndex = menuItems.indexOf(document.activeElement)
    let nextIndex = currentIndex

    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + menuItems.length) % menuItems.length
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = menuItems.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      restoreFocus.current = true
      onClose()
      return
    } else if (event.key === 'Tab') {
      onClose()
      return
    } else return

    if (!menuItems.length) return
    event.preventDefault()
    menuItems[nextIndex]?.focus()
  }

  const motionProps = reduced
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: -4, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -2, scale: 0.995 },
        transition: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
      }

  return (
    <motion.div
      {...motionProps}
      ref={menuRef}
      id={id}
      className="context-menu visible"
      role="menu"
      aria-label={label}
      data-theme={theme}
      style={{ left: resolvedPosition.x, top: resolvedPosition.y, transformOrigin: 'top left' }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          id={item.id}
          className={item.danger ? 'danger' : undefined}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </motion.div>
  )
}

export function ContextMenu({ open, ...props }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && <MenuSurface key={props.id} {...props} />}
    </AnimatePresence>,
    document.body,
  )
}
