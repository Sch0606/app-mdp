import { motion } from 'framer-motion'
import { FolderKey, LockKeyhole, Plus, Settings } from 'lucide-react'
import { memo } from 'react'
import { spring } from '../../motion/presets.js'

export const Sidebar = memo(function Sidebar({ categories, activeCategory, onSelect, onCategoryMenu, onAdd, onSettings, onLock }) {
  return (
    <aside className="sidebar">
      <nav className="categories" aria-label="Espaces">
        <p className="section-label">Espaces</p>
        <ul>
          {Object.keys(categories).map((category) => {
            const active = category === activeCategory
            return (
              <li key={category} className={active ? 'active' : ''} onContextMenu={(event) => { event.preventDefault(); onCategoryMenu(event, category) }} onDoubleClick={() => onCategoryMenu(null, category, true)}>
                <button type="button" onClick={() => onSelect(category)} aria-label={`${category}, ${categories[category].length} accès`} title={category} aria-current={active ? 'page' : undefined}>
                  {active && <motion.span className="sidebar-selection" layoutId="sidebar-selection" transition={spring} />}
                  <FolderKey size={17} aria-hidden="true" />
                  <span>{category}</span>
                  <small>{categories[category].length}</small>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <button id="add-categorie" className="sidebar-create" type="button" onClick={onAdd} title="Créer un espace">
        <Plus size={17} />
        <span>Créer</span>
      </button>

      <div className="sidebar-footer">
        <button id="settings-button" type="button" onClick={onSettings} aria-label="Paramètres" title="Paramètres">
          <Settings size={18} />
          <span>Paramètres</span>
        </button>
        <button type="button" onClick={onLock} aria-label="Verrouiller le coffre" title="Verrouiller le coffre">
          <LockKeyhole size={18} />
          <span>Verrouiller</span>
        </button>
      </div>
    </aside>
  )
})
