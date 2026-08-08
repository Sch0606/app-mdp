import { LockKeyhole, Plus, Search, SlidersHorizontal, Star } from 'lucide-react'
import { filterEntries } from '../../lib/security.js'
import { EntryList } from './EntryList.jsx'
import { ActivityList } from './ActivityList.jsx'
import { SecurityTools } from './SecurityTools.jsx'
import { Sidebar } from './Sidebar.jsx'
import { VaultTabs } from './VaultTabs.jsx'

export function VaultWorkspace({ state, activityItems, showToolbarLock, onAction }) {
  const source = state.categories[state.activeCategory] || []
  const indexed = source.map((entry, index) => ({ ...entry, category: state.activeCategory, index }))
  const visible = filterEntries(indexed, state.query, state.filter)

  return (
    <div className="vault-shell" data-testid="vault-workspace">
      <Sidebar
        categories={state.categories}
        activeCategory={state.activeCategory}
        onSelect={(category) => onAction('select-category', category)}
        onCategoryMenu={(event, category, directRename = false) => onAction(directRename ? 'rename-category' : 'category-menu', { event, category })}
        onAdd={() => onAction('add-category')}
        onSettings={() => onAction('open-settings')}
        onLock={() => onAction('lock')}
      />

      <main className="main vault-main">
        <header className="vault-header">
          <div><p className="eyebrow">Coffre local chiffré</p><h1>{state.activeCategory}</h1></div>
          <div className="header-status"><span>{source.length} accès</span><span className="security-pill">Protection locale</span></div>
        </header>

        <section className="toolbar" aria-label="Actions du coffre">
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Recherche</span>
            <input id="search-input" type="search" value={state.query} onChange={(event) => onAction('query', event.target.value)} placeholder="Service, identifiant ou espace" />
          </label>
          <div className="toolbar-actions">
            <button className="primary-button" id="new-access" type="button" aria-label="Nouvel accès" onClick={() => onAction('new-entry')}><Plus size={17} /> Nouvel accès</button>
            {showToolbarLock && <button className="secondary-button" id="lock-now" type="button" onClick={() => onAction('lock')}><LockKeyhole size={16} /> Verrouiller</button>}
          </div>
        </section>

        <SecurityTools entries={Object.values(state.categories).flat()} onGenerate={() => onAction('new-entry', { generate: true })} />

        <section className="vault-content">
          <div className="vault-content-header">
            <VaultTabs view={state.view} onChange={(view) => onAction('view', view)} />
            {state.view === 'access' && (
              <div className="quick-filters" aria-label="Filtres rapides">
                <button id="filter-favorites" className={state.filter === 'favorites' ? 'active' : ''} type="button" onClick={() => onAction('filter', state.filter === 'favorites' ? 'all' : 'favorites')}><Star size={15} /> Favoris</button>
                <button id="filter-recent" className={state.filter === 'recent' ? 'active' : ''} type="button" onClick={() => onAction('filter', state.filter === 'recent' ? 'all' : 'recent')}><SlidersHorizontal size={15} /> Récents</button>
              </div>
            )}
          </div>

          {state.view === 'access' ? (
            <EntryList
              entries={visible}
              onEdit={(entry) => onAction('edit-entry', entry)}
              onCopy={(value, message) => onAction('copy', { value, message })}
              onFavorite={(entry) => onAction('favorite', entry)}
              onTotp={(entry) => onAction('totp', entry)}
              onMenu={(event, entry) => onAction('entry-menu', { event, entry })}
              onNew={() => onAction('new-entry')}
            />
          ) : <ActivityList mode={state.view} items={activityItems} onAction={onAction} />}
        </section>
      </main>
    </div>
  )
}
