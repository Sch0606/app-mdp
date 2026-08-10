export const initialVaultState = Object.freeze({
  categories: { Perso: [] },
  activeCategory: 'Perso',
  query: '',
  filter: 'all',
  view: 'access',
})

export function vaultReducer(state, action) {
  switch (action.type) {
    case 'load': {
      const categories = action.categories && Object.keys(action.categories).length
        ? action.categories
        : { Perso: [] }
      const activeCategory = Object.hasOwn(categories, state.activeCategory)
        ? state.activeCategory
        : Object.keys(categories)[0]
      return { ...state, categories, activeCategory }
    }
    case 'select-category':
      return Object.hasOwn(state.categories, action.category)
        ? { ...state, activeCategory: action.category, view: 'access', query: '', filter: 'all' }
        : state
    case 'set-query':
      return { ...state, query: action.query }
    case 'set-filter':
      return { ...state, filter: action.filter }
    case 'set-view':
      return { ...state, view: action.view }
    case 'reset':
      return initialVaultState
    default:
      return state
  }
}
