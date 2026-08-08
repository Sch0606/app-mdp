import { motion, useReducedMotion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { motionProps } from '../../motion/presets.js'

export function LaunchScreen() {
  const reduced = useReducedMotion()

  return (
    <motion.section
      id="launch-screen"
      className="launch-screen"
      role="status"
      aria-label="Ouverture de Clave"
      {...motionProps(reduced)}
    >
      <div className="launch-emblem" aria-hidden="true">
        <ShieldCheck size={28} strokeWidth={1.8} />
      </div>
      <strong>Clave</strong>
      <span>Ouverture du coffre chiffré</span>
      <div className="launch-track" aria-hidden="true">
        <motion.span
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={reduced ? { duration: 0.01 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </motion.section>
  )
}
