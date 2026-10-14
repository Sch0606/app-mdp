import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Eye, EyeOff, Hash, KeyRound, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { normalizeSiteUrl, normalizeTags, normalizeTotpSecret, siteIconFallback } from '../../lib/security.js'
import { tauri } from '../../lib/tauri.js'
import { softSpring } from '../../motion/presets.js'

const blankEntry = { plateforme: '', email: '', mdp: '', site: '', notes: '', totp_secret: '', icon_url: '', tags: [] }
const defaultGenerator = { length: 20, numbers: true, symbols: true, readable: false }
const pendingStrength = { level: 'medium', label: 'Analyse', score: 0, suggestions: [] }

export function EntryDrawer({ open, entry, onClose, onSave, onGenerate }) {
  const reduced = useReducedMotion()
  const [form, setForm] = useState(blankEntry)
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generator, setGenerator] = useState(defaultGenerator)
  const [iconPreview, setIconPreview] = useState(siteIconFallback('', ''))
  const [strength, setStrength] = useState(pendingStrength)
  const [tagDraft, setTagDraft] = useState('')
  const iconRequest = useRef(0)

  useEffect(() => {
    setForm(entry ? { ...blankEntry, ...entry, tags: entry.tags || [] } : blankEntry)
    setVisible(false)
    setTagDraft('')
  }, [entry, open])

  useEffect(() => {
    setIconPreview(form.icon_url
      ? { iconUrl: form.icon_url, source: 'stored', fallbackLabel: siteIconFallback(form.site, form.plateforme).fallbackLabel }
      : siteIconFallback(form.site, form.plateforme))
  }, [form.icon_url, form.plateforme, form.site])

  useEffect(() => {
    const normalizedSite = normalizeSiteUrl(form.site)
    if (!open || !normalizedSite) return undefined
    const requestId = iconRequest.current + 1
    iconRequest.current = requestId
    const timer = setTimeout(async () => {
      try {
        const result = await tauri.invoke('resoudre_icone_site', { site: normalizedSite, service: form.plateforme })
        if (iconRequest.current !== requestId) return
        const fallback = siteIconFallback(normalizedSite, form.plateforme)
        update('icon_url', result?.iconUrl || '')
        setIconPreview({
          iconUrl: result?.iconUrl || '',
          source: result?.source || fallback.source,
          fallbackLabel: result?.fallbackLabel || fallback.fallbackLabel,
        })
      } catch (_) {
        if (iconRequest.current === requestId) setIconPreview(siteIconFallback(form.site, form.plateforme))
      }
    }, 260)
    return () => clearTimeout(timer)
  }, [form.site, form.plateforme, open])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function commitTagDraft(value = tagDraft) {
    const additions = value.split(/[,;]/)
    setForm((current) => ({ ...current, tags: normalizeTags([...current.tags, ...additions]) }))
    setTagDraft('')
  }

  function removeTag(tag) {
    setForm((current) => ({ ...current, tags: current.tags.filter((value) => value !== tag) }))
  }

  function onTagKeyDown(event) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (tagDraft.trim()) commitTagDraft()
    } else if (event.key === 'Backspace' && !tagDraft && form.tags.length) {
      removeTag(form.tags[form.tags.length - 1])
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (!form.plateforme.trim() || !form.mdp || saving) return
    setSaving(true)
    try {
      await onSave({ ...form, tags: normalizeTags([...form.tags, ...tagDraft.split(/[,;]/)]), totp_secret: normalizeTotpSecret(form.totp_secret) })
    } finally {
      setSaving(false)
    }
  }

  async function generate() {
    const password = await onGenerate(generator)
    if (password) update('mdp', password)
  }

  useEffect(() => {
    let active = true
    if (!open) return undefined
    import('../../lib/passwordStrength.js').then(({ passwordStrength }) => {
      if (active) setStrength(passwordStrength(form.mdp, [form.plateforme, form.email, form.site]))
    })
    return () => { active = false }
  }, [form.mdp, form.plateforme, form.email, form.site, open])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="drawer-backdrop"
            aria-label="Fermer l’éditeur"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.16 }}
          />
          <motion.aside
            className="entry-panel entry-drawer"
            aria-label={entry ? 'Modifier l’accès' : 'Nouvel accès'}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
            transition={reduced ? { duration: 0.01 } : softSpring}
          >
            <header className="drawer-heading">
              <div><p className="section-label">Coffre</p><h2>{entry ? 'Modifier l’accès' : 'Nouvel accès'}</h2></div>
              <button className="icon-button" id="close-entry-drawer" type="button" onClick={onClose} aria-label="Fermer" title="Fermer">
                <X size={19} />
              </button>
            </header>

            <form onSubmit={submit}>
              <label><span>Service</span><input id="plateforme" value={form.plateforme} onChange={(event) => update('plateforme', event.target.value)} placeholder="Gmail" autoFocus /></label>
              <label><span>Identifiant</span><input id="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="nom@exemple.com" /></label>
              <label>
                <span>Mot de passe</span>
                <div className="drawer-secret">
                  <KeyRound size={17} />
                  <input id="mdp" type={visible ? 'text' : 'password'} value={form.mdp} onChange={(event) => update('mdp', event.target.value)} placeholder="Mot de passe" />
                  <button type="button" className="icon-button" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
              <button id="generer" className="secondary-button generator-button" type="button" onClick={generate}>
                <Sparkles size={16} /> Générer un mot de passe
              </button>
              <fieldset className="generator-options">
                <legend className="sr-only">Options du generateur</legend>
                <label className="generator-length-row" htmlFor="generator-length">
                  <span>Longueur</span><output id="generator-length-value">{generator.length}</output>
                </label>
                <input id="generator-length" type="range" min="8" max="64" value={generator.length} onChange={(event) => setGenerator((current) => ({ ...current, length: Number(event.target.value) }))} />
                <div className="generator-toggles">
                  <label><input id="generator-numbers" type="checkbox" checked={generator.numbers} onChange={(event) => setGenerator((current) => ({ ...current, numbers: event.target.checked }))} /> Chiffres</label>
                  <label><input id="generator-symbols" type="checkbox" checked={generator.symbols} onChange={(event) => setGenerator((current) => ({ ...current, symbols: event.target.checked }))} /> Symboles</label>
                  <label><input id="generator-readable" type="checkbox" checked={generator.readable} onChange={(event) => setGenerator((current) => ({ ...current, readable: event.target.checked }))} /> Lisible</label>
                </div>
              </fieldset>
              <div className="strength-line"><span>Force : {strength.label}</span><span className={`strength-dot ${strength.level}`} style={{ '--strength-score': `${strength.score}%` }} /></div>
              {strength.suggestions.length > 0 && <p className="strength-advice">{strength.suggestions[0]}</p>}
              <label><span>Site web</span><input id="entry-site" type="text" inputMode="url" value={form.site} onChange={(event) => update('site', event.target.value)} placeholder="exemple.com ou https://exemple.com" /></label>
              <div className="site-icon-preview" aria-live="polite">
                {iconPreview.iconUrl ? <img src={iconPreview.iconUrl} alt="" onError={() => update('icon_url', '')} /> : <span>{iconPreview.fallbackLabel}</span>}
                <small>{iconPreview.iconUrl ? 'Icône du site détectée' : 'Icône par défaut'}</small>
              </div>
              <label><span>Code 2FA / OTP</span><input id="entry-totp" value={form.totp_secret} onChange={(event) => update('totp_secret', event.target.value)} placeholder="Clé Base32 ou otpauth://" /></label>
              <div className="tag-field">
                <label htmlFor="entry-tags">Étiquettes</label>
                <div className="tag-input">
                  <Hash size={15} aria-hidden="true" />
                  {form.tags.map((tag) => (
                    <span className="tag-chip" key={tag}>
                      #{tag}
                      <button type="button" onClick={() => removeTag(tag)} aria-label={`Retirer l’étiquette ${tag}`}><X size={12} /></button>
                    </span>
                  ))}
                  <input id="entry-tags" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={onTagKeyDown} onBlur={() => { if (tagDraft.trim()) commitTagDraft() }} placeholder={form.tags.length ? '' : 'travail, banque…'} />
                </div>
              </div>
              <label><span>Notes</span><textarea id="entry-notes" rows="4" value={form.notes} onChange={(event) => update('notes', event.target.value)} /></label>
              <div className="drawer-actions">
                <button type="button" className="secondary-button" onClick={onClose}>Annuler</button>
                <button type="submit" className="primary-button btn-ajouter" disabled={!form.plateforme.trim() || !form.mdp || saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
