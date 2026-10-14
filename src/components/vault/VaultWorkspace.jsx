import { Hash, LockKeyhole, Plus, Search, SlidersHorizontal, Star } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import { collectTags, filterEntries } from '../../lib/security.js'
import { EntryList } from './EntryList.jsx'
import { ActivityList } from './ActivityList.jsx'
import { HealthView } from './HealthView.jsx'
import { SecurityTools } from './SecurityTools.jsx'
import { Sidebar } from './Sidebar.jsx'
import { VaultTabs } from './VaultTabs.jsx'

export const VaultWorkspace = memo(function VaultWorkspace({ state, activityItems, showToolbarLock, onAction }) {
  const source = state.categories[state.activeCategory] || []
  const indexed = useMemo(
    () => source.map((entry, index) => ({ ...entry, category: state.activeCategory, index })),
    [source, state.activeCategory],
  )
  const visible = useMemo(
    () => filterEntries(indexed, state.query, state.filter),
    [indexed, state.query, state.filter],
  )
  const tags = useMemo(() => collectTags(indexed), [indexed])
  const securityEntries = useMemo(
    () => Object.entries(state.categories).flatMap(([category, entries]) =>
      entries.map((entry, index) => ({ ...entry, category, index })),
    ),
    [state.categories],
  )
  const selectCategory = useCallback((category) => onAction('select-category', category), [onAction])
  const openCategoryMenu = useCallback((event, category, directRename = false) => {
    onAction(directRename ? 'rename-category' : 'category-menu', { event, category })
  }, [onAction])
  const addCategory = useCallback(() => onAction('add-category'), [onAction])
  const openSettings = useCallback(() => onAction('open-settings'), [onAction])
  const lock = useCallback(() => onAction('lock'), [onAction])
  const openHealth = useCallback(() => onAction('view', 'health'), [onAction])
  const editEntry = useCallback((entry) => onAction('edit-entry', entry), [onAction])
  const copyEntry = useCallback((value, message) => onAction('copy', { value, message }), [onAction])
  const favoriteEntry = useCallback((entry) => onAction('favorite', entry), [onAction])
  const copyTotp = useCallback((entry) => onAction('totp', entry), [onAction])
  const openEntryMenu = useCallback((event, entry) => onAction('entry-menu', { event, entry }), [onAction])
  const newEntry = useCallback(() => onAction('new-entry'), [onAction])

  return (
    <div className="vault-shell" data-testid="vault-workspace">
      <Sidebar
        categories={state.categories}
        activeCategory={state.activeCategory}
        onSelect={selectCategory}
        onCategoryMenu={openCategoryMenu}
        onAdd={addCategory}
        onSettings={openSettings}
        onLock={lock}
      />

      <main className="main vault-main">
        <header className="vault-header">
          <div><p className="eyebrow">{source.length} accès</p><h1>{state.activeCategory}</h1></div>
          <SecurityTools entries={securityEntries} onOpen={openHealth} />
        </header>

        <section className="toolbar" aria-label="Actions du coffre">
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Recherche</span>
            <input id="search-input" type="search" value={state.query} onChange={(event) => onAction('query', event.target.value)} placeholder="Service, identifiant ou #étiquette" />
          </label>
          <div className="toolbar-actions">
            <button className="primary-button" id="new-access" type="button" aria-label="Nouvel accès" onClick={() => onAction('new-entry')}><Plus size={17} /> Nouvel accès</button>
            {showToolbarLock && <button className="secondary-button toolbar-lock" id="lock-now" type="button" onClick={() => onAction('lock')} aria-label="Verrouiller le coffre" title="Verrouiller"><LockKeyhole size={16} /></button>}
          </div>
        </section>

        <section className="vault-content">
          <div className="vault-content-header">
            <VaultTabs view={state.view} onChange={(view) => onAction('view', view)} />
            {state.view === 'access' && (
              <div className="quick-filters" aria-label="Filtres rapides">
                <button id="filter-favorites" className={state.filter === 'favorites' ? 'active' : ''} type="button" onClick={() => onAction('filter', state.filter === 'favorites' ? 'all' : 'favorites')}><Star size={15} /> Favoris</button>
                <button id="filter-recent" className={state.filter === 'recent' ? 'active' : ''} type="button" onClick={() => onAction('filter', state.filter === 'recent' ? 'all' : 'recent')}><SlidersHorizontal size={15} /> Récents</button>
                {tags.slice(0, 8).map((tag) => {
                  const value = `tag:${tag}`
                  return <button key={tag} className={`tag-filter${state.filter === value ? ' active' : ''}`} type="button" data-tag={tag} onClick={() => onAction('filter', state.filter === value ? 'all' : value)}><Hash size={14} /> {tag}</button>
                })}
              </div>
            )}
          </div>

          {state.view === 'access' ? (
            <EntryList
              entries={visible}
              strengthEntries={indexed}
              onEdit={editEntry}
              onCopy={copyEntry}
              onFavorite={favoriteEntry}
              onTotp={copyTotp}
              onMenu={openEntryMenu}
              onNew={newEntry}
            />
          ) : state.view === 'health' ? (
            <HealthView entries={securityEntries} onAction={onAction} />
          ) : <ActivityList mode={state.view} items={activityItems} onAction={onAction} />}
        </section>
      </main>
    </div>
  )
})
