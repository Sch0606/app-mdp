const tabs = [
  ['access', 'Accès'],
  ['health', 'Santé'],
  ['history', 'Historique'],
  ['trash', 'Poubelle'],
]

export function VaultTabs({ view, onChange }) {
  const selectedIndex = Math.max(0, tabs.findIndex(([value]) => value === view))

  return (
    <div className="vault-tabs" role="tablist" style={{ '--selected-index': selectedIndex }}>
      <span
        aria-hidden="true"
        className="vault-tab-selection"
        style={{ transform: `translate3d(calc(${selectedIndex * 100}% + ${selectedIndex * 3}px), 0, 0)` }}
      />
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
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
