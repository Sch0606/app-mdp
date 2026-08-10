import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ScanFace, X } from 'lucide-react'
import { softSpring } from '../../motion/presets.js'

const labels = {
  idle: 'Authentification biométrique prête',
  scanning: 'Analyse en cours',
  success: 'Identité confirmée',
  failure: 'Authentification non confirmée',
}

export function BiometricScanner({ state, onActivate, message, methodLabel = 'la biométrie' }) {
  const reduced = useReducedMotion()
  const active = state === 'scanning'

  return (
    <div className="biometric-control">
      <motion.button
        type="button"
        className="biometric-scanner"
        data-testid="biometric-scanner"
        data-state={state}
        aria-label={`Déverrouiller avec ${methodLabel}`}
        onClick={onActivate}
        disabled={active || state === 'success'}
        whileTap={reduced ? undefined : { scale: 0.98 }}
      >
        <span className="scan-corner scan-corner-tl" aria-hidden="true" />
        <span className="scan-corner scan-corner-tr" aria-hidden="true" />
        <span className="scan-corner scan-corner-bl" aria-hidden="true" />
        <span className="scan-corner scan-corner-br" aria-hidden="true" />

        <AnimatePresence mode="wait" initial={false}>
          {state === 'success' ? (
            <motion.span
              key="success"
              className="scan-icon scan-icon-success"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.88, filter: 'blur(3px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0.01 } : softSpring}
            >
              <Check size={40} strokeWidth={2.2} />
            </motion.span>
          ) : state === 'failure' ? (
            <motion.span
              key="failure"
              className="scan-icon scan-icon-failure"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: [0.94, 1.04, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.01 : 0.22 }}
            >
              <X size={38} strokeWidth={2.1} />
            </motion.span>
          ) : (
            <motion.span
              key="scan"
              className="scan-icon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ScanFace size={43} strokeWidth={1.65} />
            </motion.span>
          )}
        </AnimatePresence>

        {active && !reduced && (
          <motion.span
            className="scan-beam"
            aria-hidden="true"
            initial={{ y: -34, opacity: 0 }}
            animate={{ y: [-34, 34, -34], opacity: [0, 1, 1] }}
            transition={{ duration: 1.25, repeat: Infinity, ease: [0.45, 0, 0.55, 1] }}
          />
        )}
      </motion.button>

      <div className="biometric-copy" aria-live="polite">
        <strong>{labels[state]}</strong>
        <span>{message || (state === 'idle' ? `Utilisez ${methodLabel}` : 'Gardez votre attention sur l’appareil')}</span>
      </div>
    </div>
  )
}
