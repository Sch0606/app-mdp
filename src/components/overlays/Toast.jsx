import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'

export function Toast({ message }) {
  const reduced = useReducedMotion()
  return (
    <div id="toast" className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      <AnimatePresence mode="wait">
        {message && (
          <motion.div
            key={message}
            className="toast visible"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, y: 3 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <CheckCircle2 size={17} aria-hidden="true" /> {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
