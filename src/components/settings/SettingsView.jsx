import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, BookOpen, CloudDownload, Download, Fingerprint, FileText, Globe2, Info, Keyboard, LockKeyhole, MonitorCog, Shield, Upload } from 'lucide-react'
import { useState } from 'react'
import { motionProps, spring } from '../../motion/presets.js'
import { DelaySelector } from './DelaySelector.jsx'

const sections = [
  ['security', 'Sécurité', Shield],
  ['interface', 'Interface', MonitorCog],
  ['backup', 'Sauvegarde', CloudDownload],
  ['shortcuts', 'Raccourcis', Keyboard],
  ['about', 'À propos', Info],
]

const lockOptions = [
  { value: 0, label: 'Jamais' },
  { value: 60000, label: '1 min' },
  { value: 600000, label: '10 min' },
  { value: 1800000, label: '30 min' },
]

const clipboardOptions = [
  { value: 0, label: 'Jamais' },
  { value: 30000, label: '30 s' },
  { value: 60000, label: '1 min' },
  { value: 120000, label: '2 min' },
]

const importTypes = [
  {
    icon: Download,
    title: 'Exporter le coffre',
    text: 'Crée une sauvegarde Clave protégée par un mot de passe. À utiliser pour garder une copie ou changer d’appareil.',
  },
  {
    icon: Upload,
    title: 'Importer une sauvegarde Clave',
    text: 'Restaure un fichier de sauvegarde créé par Clave. Il faut le mot de passe choisi au moment de l’export.',
  },
  {
    icon: Globe2,
    title: 'Importer depuis un navigateur',
    text: 'Lit un fichier CSV/TSV exporté depuis Chrome, Edge, Firefox, Safari ou un gestionnaire compatible.',
  },
]

const browserImportSteps = [
  'Ouvrez le gestionnaire de mots de passe de votre navigateur.',
  'Exportez les mots de passe au format CSV quand cette option est proposée.',
  'Dans Clave, cliquez sur Depuis un navigateur et sélectionnez le fichier exporté.',
  'Vérifiez la prévisualisation, décochez ce que vous ne voulez pas importer, puis validez.',
  'Supprimez le fichier CSV après import : il contient vos mots de passe en clair.',
]

export function SettingsView({ preferences, biometry, version, updateStatus, updateAvailable, onClose, onPreference, onAction }) {
  const reduced = useReducedMotion()
  const [section, setSection] = useState('security')
  const [biometricPassword, setBiometricPassword] = useState('')
  const [passwords, setPasswords] = useState({ old: '', next: '', confirm: '' })
  const selectedIndex = sections.findIndex(([value]) => value === section)
  const authMethod = /windows|hello/i.test(biometry.biometryType || '') ? 'Windows Hello' : 'Déverrouillage natif'

  async function submitPassword(event) {
    event.preventDefault()
    if (passwords.next !== passwords.confirm) {
      onAction('feedback', 'Les deux nouveaux mots de passe ne correspondent pas.')
      return
    }
    await onAction('change-password', passwords)
    setPasswords({ old: '', next: '', confirm: '' })
  }

  return (
    <motion.main className="settings-page" id="settings-page" aria-label="Paramètres" {...motionProps(reduced)}>
      <header className="settings-page-header">
        <button className="secondary-button" id="close-settings" type="button" onClick={onClose}><ArrowLeft size={17} /> Retour au coffre</button>
        <div><p className="eyebrow">Préférences locales</p><h1>Paramètres</h1></div>
        <button className="primary-button settings-lock" id="settings-lock-now" type="button" onClick={() => onAction('lock')}><LockKeyhole size={16} /> Verrouiller</button>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Sections des paramètres" style={{ '--selected-index': selectedIndex }}>
          {sections.map(([value, label, Icon]) => {
            const active = value === section
            return (
              <button key={value} className={active ? 'active' : ''} type="button" data-settings-section={value} aria-selected={active} onClick={() => setSection(value)}>
                {active && <motion.span className="settings-nav-indicator" layoutId="settings-nav-indicator" transition={spring} />}
                <Icon size={17} /><span>{label}</span>
              </button>
            )
          })}
        </nav>

        <div className="settings-layout">
          <AnimatePresence mode="wait">
            <motion.section key={section} className="settings-panel" data-settings-panel={section} {...motionProps(reduced)}>
              {section === 'security' && (
                <>
                  <article className="settings-card">
                    <div><p className="section-label">Verrouillage</p><h2>Protection automatique</h2></div>
                    <fieldset className="settings-field" id="auto-lock-delay">
                      <legend>Verrouiller après une période d’inactivité</legend>
                      <DelaySelector name="auto-lock-delay" className="auto-lock-options" value={preferences.autoLockDelay} options={lockOptions} onChange={(value) => onPreference('autoLockDelay', value)} />
                    </fieldset>
                    <fieldset className="settings-field" id="clipboard-clear-delay">
                      <legend>Effacer le presse-papiers après une copie</legend>
                      <DelaySelector name="clipboard-clear-delay" className="clipboard-delay-options" value={preferences.clipboardDelay} options={clipboardOptions} onChange={(value) => onPreference('clipboardDelay', value)} />
                    </fieldset>
                  </article>

                  <article className="settings-card">
                    <div><p className="section-label">Accès rapide</p><h2>{authMethod}</h2></div>
                    <div className="biometry-setting">
                      <span className="settings-icon"><Fingerprint size={20} /></span>
                      <span><strong>{biometry.isEnabled ? `${authMethod} activé` : biometry.isAvailable ? `${authMethod} disponible` : 'Accès rapide indisponible'}</strong><small>{biometry.biometryType || 'Cet appareil'}</small></span>
                    </div>
                    {biometry.isAvailable && !biometry.isEnabled && (
                      <label className="settings-field"><span>Mot de passe maître</span><input type="password" value={biometricPassword} onChange={(event) => setBiometricPassword(event.target.value)} autoComplete="current-password" /></label>
                    )}
                    <div className="settings-actions">
                      {!biometry.isEnabled && biometry.isAvailable && <button className="primary-button" id="enable-biometry" type="button" disabled={biometricPassword.length < 8} onClick={() => onAction('enable-biometry', biometricPassword)}>Activer</button>}
                      {biometry.isEnabled && <button className="secondary-button" id="disable-biometry" type="button" onClick={() => onAction('disable-biometry')}>Désactiver</button>}
                    </div>
                  </article>

                  <form className="settings-card change-password-card" id="change-master-form" onSubmit={submitPassword}>
                    <div><p className="section-label">Mot de passe maître</p><h2>Changer le mot de passe</h2></div>
                    <label className="settings-field"><span>Mot de passe actuel</span><input type="password" value={passwords.old} onChange={(event) => setPasswords((current) => ({ ...current, old: event.target.value }))} autoComplete="current-password" /></label>
                    <label className="settings-field"><span>Nouveau mot de passe</span><input type="password" value={passwords.next} onChange={(event) => setPasswords((current) => ({ ...current, next: event.target.value }))} minLength={8} autoComplete="new-password" /></label>
                    <label className="settings-field"><span>Confirmer</span><input type="password" value={passwords.confirm} onChange={(event) => setPasswords((current) => ({ ...current, confirm: event.target.value }))} minLength={8} autoComplete="new-password" /></label>
                    <button className="secondary-button" type="submit" disabled={passwords.next.length < 8}>Enregistrer le mot de passe</button>
                  </form>
                </>
              )}

              {section === 'interface' && (
                <article className="settings-card settings-card-wide">
                  <div><p className="section-label">Interface</p><h2>Barre d’actions</h2></div>
                  <label className="settings-switch">
                    <span><strong>Bouton Verrouiller</strong><small>Afficher l’action dans la barre supérieure du coffre</small></span>
                    <input id="toggle-toolbar-lock" type="checkbox" checked={preferences.showToolbarLock} onChange={(event) => onPreference('showToolbarLock', event.target.checked)} />
                  </label>
                  <label className="settings-switch">
                    <span><strong>Mode sombre</strong><small>Utiliser une interface sombre avec des accents verts discrets</small></span>
                    <input id="toggle-dark-mode" type="checkbox" checked={preferences.darkMode} onChange={(event) => onPreference('darkMode', event.target.checked)} />
                  </label>
                </article>
              )}

              {section === 'backup' && (
                <article className="settings-card settings-card-wide">
                  <div><p className="section-label">Sauvegarde</p><h2>Import et export chiffrés</h2></div>
                  <p className="settings-copy">Les sauvegardes Clave sont protégées par un mot de passe distinct. Les fichiers importés depuis un navigateur doivent être supprimés après utilisation.</p>
                  <div className="settings-actions">
                    <button className="secondary-button" id="settings-export-vault" type="button" onClick={() => onAction('export')}><Download size={16} /> Exporter</button>
                    <button className="secondary-button" id="settings-import-vault" type="button" onClick={() => onAction('import')}><Upload size={16} /> Importer</button>
                    <button className="secondary-button" id="settings-import-browser" type="button" onClick={() => onAction('browser-import')}><Upload size={16} /> Depuis un navigateur</button>
                  </div>
                  <div className="import-tutorial" aria-labelledby="import-tutorial-title">
                    <div className="import-tutorial-header">
                      <span className="settings-icon"><BookOpen size={19} /></span>
                      <span>
                        <h3 id="import-tutorial-title">Tutoriel d’importation</h3>
                        <p>Choisissez le bon type d’import selon la provenance de vos données.</p>
                      </span>
                    </div>
                    <div className="import-type-grid">
                      {importTypes.map(({ icon: Icon, title, text }) => (
                        <section className="import-type-card" key={title}>
                          <Icon size={16} />
                          <strong>{title}</strong>
                          <p>{text}</p>
                        </section>
                      ))}
                    </div>
                    <div className="browser-import-guide">
                      <div>
                        <p className="section-label">Guide rapide</p>
                        <h4>Importer depuis un navigateur web</h4>
                      </div>
                      <ol>
                        {browserImportSteps.map((step) => <li key={step}>{step}</li>)}
                      </ol>
                      <p className="import-warning"><FileText size={15} /> Les fichiers CSV de navigateur ne sont généralement pas protégés. Gardez-les seulement le temps de l’import.</p>
                    </div>
                    <div className="import-help-links">
                      <a href="https://support.google.com/chrome/answer/95606" target="_blank" rel="noreferrer">Chrome</a>
                      <a href="https://support.microsoft.com/microsoft-edge/save-or-forget-passwords-in-microsoft-edge-b4beecb0-fc9a-4dd3-bae4-8f77a20c6bb0" target="_blank" rel="noreferrer">Edge</a>
                      <a href="https://support.mozilla.org/kb/export-login-data-firefox" target="_blank" rel="noreferrer">Firefox</a>
                      <a href="https://support.apple.com/guide/safari/passwords-sfri40599/mac" target="_blank" rel="noreferrer">Safari</a>
                      <a href="https://bitwarden.com/help/export-your-data/" target="_blank" rel="noreferrer">Bitwarden</a>
                      <a href="https://support.1password.com/export/" target="_blank" rel="noreferrer">1Password</a>
                      <a href="https://support.dashlane.com/hc/articles/202625092" target="_blank" rel="noreferrer">Dashlane</a>
                    </div>
                  </div>
                </article>
              )}

              {section === 'shortcuts' && (
                <article className="settings-card settings-card-wide">
                  <div><p className="section-label">Raccourcis</p><h2>Verrouillage rapide</h2></div>
                  <div className="shortcut-row"><span>Raccourci actuel</span><output id="lock-hotkey-display">{preferences.lockHotkey || 'Aucun'}</output><button className="secondary-button" id="record-lock-hotkey" type="button" onClick={() => onAction('record-hotkey')}>Définir</button><button className="text-button" id="clear-lock-hotkey" type="button" onClick={() => onPreference('lockHotkey', '')}>Retirer</button></div>
                </article>
              )}

              {section === 'about' && (
                <article className="settings-card settings-card-wide about-card">
                  <div><p className="section-label">À propos</p><h2>Clave <span id="app-version">{version ? `v${version}` : ''}</span></h2></div>
                  <p className="settings-copy" id="update-status">{updateStatus || 'Version installée.'}</p>
                  <div className="settings-actions">
                    <button className="secondary-button" id="check-update" type="button" onClick={() => onAction('check-update')}>Rechercher une mise à jour</button>
                    {updateAvailable && <button className="primary-button" id="install-update" type="button" onClick={() => onAction('install-update')}>Installer puis redémarrer</button>}
                  </div>
                </article>
              )}
            </motion.section>
          </AnimatePresence>
        </div>
      </div>
    </motion.main>
  )
}
