import { motion } from 'framer-motion'
import { spring } from '../../motion/presets.js'

const tabs = [
  ['access', 'Accès'],
  ['history', 'Historique'],
  ['trash', 'Poubelle'],
]

export function VaultTabs({ view, onChange }) {
  const selectedIndex = Math.max(0, tabs.findIndex(([value]) => value === view))

  return (
    <div className="vault-tabs" role="tablist" style={{ '--selected-index': selectedIndex }}>
      {tabs.map(([value, label]) => {
        const active = value === view
        return (
          <button
            key={value}
            className={`vault-tab${active ? ' active' : ''}`}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(value)}
          >
            {active && <motion.span className="vault-tab-selection" layoutId="vault-tab-selection" transition={spring} />}
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
