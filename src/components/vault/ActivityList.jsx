import { History, RotateCcw, Trash2, XCircle } from 'lucide-react'

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

function formatDate(timestamp) {
  if (!timestamp) return 'Date inconnue'
  return dateFormatter.format(new Date(timestamp * 1000))
}

export function ActivityList({ mode, items, onAction }) {
  if (!items.length) {
    return (
      <div id="liste-mdp" className="entry-list">
        <div className="empty-vault">
          <span>{mode === 'history' ? <History size={25} /> : <Trash2 size={25} />}</span>
          <h3>{mode === 'history' ? 'Aucun historique' : 'Poubelle vide'}</h3>
          <p>{mode === 'history' ? 'Les modifications importantes apparaîtront ici.' : 'Les accès supprimés restent récupérables pendant 30 jours.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div id="liste-mdp" className="entry-list activity-list">
      {items.map((record, index) => ({ record, index })).reverse().map(({ record, index }) => {
        const entry = record.entry || {}
        return (
          <article className="activity-row" key={`${record.timestamp}-${index}`}>
            <span className="entry-avatar">{entry.plateforme?.slice(0, 2).toUpperCase() || '—'}</span>
            <div><strong>{entry.plateforme || 'Accès sans nom'}</strong><span>{record.categorie} · {formatDate(record.timestamp)}</span></div>
            {mode === 'history' ? (
              <button className="secondary-button restore-history" data-index={index} type="button" aria-label="Restaurer la version" onClick={() => onAction('restore-history', index)}><RotateCcw size={15} /> Restaurer</button>
            ) : (
              <div className="activity-actions">
                <button className="secondary-button restore-entry" data-index={index} type="button" aria-label="Restaurer l’accès" onClick={() => onAction('restore-trash', index)}><RotateCcw size={15} /> Restaurer</button>
                <button className="icon-button delete-trash" data-index={index} type="button" aria-label="Supprimer définitivement" onClick={() => onAction('delete-trash', index)}><XCircle size={18} /></button>
              </div>
            )}
          </article>
        )
      })}
      {mode === 'trash' && <button className="text-button empty-trash-button" id="empty-trash" type="button" onClick={() => onAction('empty-trash')}>Vider définitivement la poubelle</button>}
    </div>
  )
}
