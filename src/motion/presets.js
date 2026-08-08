export const spring = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.72,
}

export const softSpring = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.8,
}

export const microSpring = {
  type: 'spring',
  stiffness: 520,
  damping: 36,
  mass: 0.62,
}

export const fadeSlide = {
  initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -4, filter: 'blur(2px)' },
}

export function motionProps(reduced, variants = fadeSlide) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.01 },
    }
  }

  return { ...variants, transition: softSpring }
}
