export async function refreshVaultFromExternalChange({ phase, invoke, dispatch }) {
  if (phase !== 'unlocked') return false

  const categories = await invoke('charger')
  dispatch({ type: 'load', categories })
  return true
}
