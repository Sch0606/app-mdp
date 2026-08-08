import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'

export function Toast({ message }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          id="toast"
          className="toast visible"
          role="status"
          aria-live="polite"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: reduced ? 0.01 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <CheckCircle2 size={17} /> {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
