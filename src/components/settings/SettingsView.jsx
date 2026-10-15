import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, BookOpen, CloudDownload, Copy, Download, Fingerprint, FileText, Globe2, Info, Keyboard, LifeBuoy, Link2, LockKeyhole, MonitorCog, RefreshCw, Shield, Sparkles, Upload } from 'lucide-react'
import { useState } from 'react'
import { motionProps, spring } from '../../motion/presets.js'
import { DelaySelector } from './DelaySelector.jsx'
import { displayHotkey, isMac } from '../../lib/hotkeys.js'

const sections = [
  ['security', 'Sécurité', Shield],
  ['interface', 'Interface', MonitorCog],
  ['autofill', 'Remplissage', Sparkles],
  ['backup', 'Sauvegarde', CloudDownload],
  ['sharing', 'Partage', Link2],
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
    title: 'Importer depuis un navigateur ou un gestionnaire',
    text: 'Lit un export CSV de Chrome, Edge, Firefox, Safari, 1Password ou LastPass, un JSON Bitwarden ou un XML KeePass. Les dossiers deviennent des espaces.',
  },
]

const browserImportSteps = [
  'Ouvrez le gestionnaire de mots de passe de votre navigateur.',
  'Exportez les mots de passe au format CSV quand cette option est proposée.',
  'Dans Clave, cliquez sur Depuis un navigateur ou un gestionnaire et sélectionnez le fichier exporté.',
  'Vérifiez la prévisualisation, décochez ce que vous ne voulez pas importer, puis validez.',
  'Supprimez le fichier après import : il contient vos mots de passe en clair.',
]

const managerFormats = [
  ['Bitwarden', 'Outils › Exporter › format .json (non chiffré) ou .csv'],
  ['KeePass / KeePassXC', 'Fichier › Exporter › KeePass XML (2.x)'],
  ['1Password', 'Fichier › Exporter › format CSV'],
  ['LastPass', 'Options avancées › Exporter › fichier CSV'],
]

export function SettingsView({ initialSection = 'security', preferences, biometry, autofill, systemLock, screenProtection, recoveryConfigured, version, updateStatus, updateAvailable, onClose, onPreference, onAction }) {
  const reduced = useReducedMotion()
  const [section, setSection] = useState(initialSection)
  const [biometricPassword, setBiometricPassword] = useState('')
  const [passwords, setPasswords] = useState({ old: '', next: '', confirm: '' })
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [shareServer, setShareServer] = useState(preferences.shareServer)
  const selectedIndex = sections.findIndex(([value]) => value === section)
  const authMethod = /windows|hello/i.test(biometry.biometryType || '') ? 'Windows Hello' : /touch.?id/i.test(biometry.biometryType || '') ? 'Touch ID' : 'Déverrouillage natif'

  async function submitPassword(event) {
    event.preventDefault()
    if (passwords.next !== passwords.confirm) {
      onAction('feedback', 'Les deux nouveaux mots de passe ne correspondent pas.')
      return
    }
    await onAction('change-password', passwords)
    setPasswords({ old: '', next: '', confirm: '' })
  }

  async function submitRecoveryKit(event) {
    event.preventDefault()
    if (recoveryPassword.length < 8) return
    const created = await onAction('create-recovery-kit', recoveryPassword)
    if (created) setRecoveryPassword('')
  }

  function submitShareServer(event) {
    event.preventDefault()
    const value = shareServer.trim().replace(/\/+$/, '')
    if (value && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value)) {
      onAction('feedback', 'Utilisez une adresse HTTPS (ou un serveur local).')
      return
    }
    setShareServer(value)
    onPreference('shareServer', value)
    onAction('feedback', value ? 'Serveur de partage enregistré.' : 'Partage par lien désactivé.')
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
                    <label className="settings-switch">
                      <span><strong>Au verrouillage de la session</strong><small>{systemLock.supported ? `Fermer le coffre quand l’ordinateur est verrouillé (${isMac ? '⌃⌘Q' : 'Win+L'}, écran de verrouillage)` : 'Non disponible sur ce système'}</small></span>
                      <input id="toggle-lock-on-session" type="checkbox" checked={systemLock.onSessionLock} disabled={!systemLock.supported} onChange={(event) => onAction('set-system-lock', { ...systemLock, onSessionLock: event.target.checked })} />
                    </label>
                    <label className="settings-switch">
                      <span><strong>À la mise en veille</strong><small>{systemLock.supported ? isMac ? 'Fermer le coffre en cas de veille, de mise en veille de l’écran ou de fermeture de l’écran' : 'Fermer le coffre en cas de veille ou de fermeture du capot' : 'Non disponible sur ce système'}</small></span>
                      <input id="toggle-lock-on-sleep" type="checkbox" checked={systemLock.onSleep} disabled={!systemLock.supported} onChange={(event) => onAction('set-system-lock', { ...systemLock, onSleep: event.target.checked })} />
                    </label>
                    <label className="settings-switch">
                      <span><strong>Masquer Clave des captures d’écran</strong><small>{screenProtection?.supported ? 'Les partages d’écran (Discord, Teams, Zoom) et les captures affichent un rectangle noir. Désactivez pour enregistrer un tutoriel.' : 'Non disponible sur ce système'}</small></span>
                      <input id="toggle-screen-protection" type="checkbox" checked={Boolean(screenProtection?.enabled)} disabled={!screenProtection?.supported} onChange={(event) => onAction('set-screen-protection', event.target.checked)} />
                    </label>
                  </article>

                  <form className="settings-card" id="recovery-kit-form" onSubmit={submitRecoveryKit}>
                    <div><p className="section-label">Récupération</p><h2>Kit de secours</h2></div>
                    <div className="biometry-setting">
                      <span className="settings-icon"><LifeBuoy size={20} /></span>
                      <span>
                        <strong id="recovery-kit-status">{recoveryConfigured ? 'Clé de récupération active' : 'Aucune clé de récupération'}</strong>
                        <small>{recoveryConfigured ? 'Générer un nouveau kit invalide l’ancien.' : 'Sans elle, un mot de passe oublié rend le coffre inaccessible.'}</small>
                      </span>
                    </div>
                    <label className="settings-field"><span>Mot de passe maître</span><input id="recovery-kit-password" type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} autoComplete="current-password" /></label>
                    <button className={recoveryConfigured ? 'secondary-button' : 'primary-button'} id="create-recovery-kit" type="submit" disabled={recoveryPassword.length < 8}>
                      {recoveryConfigured ? 'Générer un nouveau kit' : 'Créer le kit de secours'}
                    </button>
                  </form>

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

              {section === 'autofill' && (
                <article className="settings-card settings-card-wide autofill-settings">
                  <div className="autofill-heading">
                    <div><p className="section-label">Navigateurs et applications</p><h2>Remplissage automatique</h2></div>
                    <span className={`service-status ${autofill.running ? 'ready' : 'offline'}`}>
                      {autofill.running ? 'Extension navigateur prête' : 'Service local indisponible'}
                    </span>
                  </div>
                  <p className="settings-copy">L’extension Chrome et Edge peut proposer les comptes enregistrés dans les pages de connexion.</p>
                  <label className="settings-switch">
                    <span><strong>Autoriser l’extension Clave</strong><small>Chrome et Edge peuvent interroger ce coffre sur cet appareil</small></span>
                    <input id="toggle-autofill" type="checkbox" checked={autofill.enabled} disabled={!autofill.running} onChange={(event) => onAction('set-autofill-enabled', event.target.checked)} />
                  </label>
                  <div className="pairing-panel">
                    <div>
                      <span>Code d’appairage</span>
                      <code>{autofill.token ? `${autofill.token.slice(0, 6)}••••••••${autofill.token.slice(-4)}` : 'Indisponible'}</code>
                      <small>Ce code donne accès au service local. Ne le partagez pas.</small>
                    </div>
                    <div className="settings-actions">
                      <button className="secondary-button" id="copy-autofill-token" type="button" disabled={!autofill.token} onClick={() => onAction('copy-autofill-token')}><Copy size={15} /> Copier</button>
                      <button className="text-button" id="rotate-autofill-token" type="button" disabled={!autofill.token} onClick={() => onAction('rotate-autofill-token')}><RefreshCw size={15} /> Renouveler</button>
                    </div>
                  </div>
                  <ol className="autofill-steps">
                    <li>Ouvrez <strong>chrome://extensions</strong> ou <strong>edge://extensions</strong>.</li>
                    <li>Activez le mode développeur puis chargez le dossier <strong>browser-extension</strong>.</li>
                    <li>Ouvrez les options de l’extension et collez le code d’appairage.</li>
                  </ol>
                </article>
              )}

              {section === 'backup' && (
                <article className="settings-card settings-card-wide">
                  <div><p className="section-label">Sauvegarde</p><h2>Import et export chiffrés</h2></div>
                  <p className="settings-copy">Les sauvegardes Clave sont protégées par un mot de passe distinct. Les fichiers importés depuis un navigateur doivent être supprimés après utilisation.</p>
                  <div className="settings-actions">
                    <button className="secondary-button" id="settings-export-vault" type="button" onClick={() => onAction('export')}><Download size={16} /> Exporter</button>
                    <button className="secondary-button" id="settings-import-vault" type="button" onClick={() => onAction('import')}><Upload size={16} /> Importer</button>
                    <button className="secondary-button" id="settings-import-browser" type="button" onClick={() => onAction('browser-import')}><Upload size={16} /> Depuis un navigateur ou un gestionnaire</button>
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
                      <p className="import-warning"><FileText size={15} /> Les fichiers exportés ne sont généralement pas protégés. Gardez-les seulement le temps de l’import.</p>
                    </div>
                    <div className="browser-import-guide">
                      <div>
                        <p className="section-label">Autres gestionnaires</p>
                        <h4>Formats reconnus</h4>
                      </div>
                      <dl className="manager-formats">
                        {managerFormats.map(([name, path]) => <div key={name}><dt>{name}</dt><dd>{path}</dd></div>)}
                      </dl>
                      <p className="settings-copy">Les dossiers Bitwarden, KeePass et LastPass deviennent des espaces ; les codes 2FA et les étiquettes sont conservés.</p>
                    </div>
                    <div className="import-help-links">
                      <a href="https://support.google.com/chrome/answer/95606" target="_blank" rel="noreferrer">Chrome</a>
                      <a href="https://support.microsoft.com/microsoft-edge/save-or-forget-passwords-in-microsoft-edge-b4beecb0-fc9a-4dd3-bae4-8f77a20c6bb0" target="_blank" rel="noreferrer">Edge</a>
                      <a href="https://support.mozilla.org/kb/export-login-data-firefox" target="_blank" rel="noreferrer">Firefox</a>
                      <a href="https://support.apple.com/guide/safari/passwords-sfri40599/mac" target="_blank" rel="noreferrer">Safari</a>
                      <a href="https://bitwarden.com/help/export-your-data/" target="_blank" rel="noreferrer">Bitwarden</a>
                      <a href="https://support.1password.com/export/" target="_blank" rel="noreferrer">1Password</a>
                      <a href="https://keepassxc.org/docs/KeePassXC_UserGuide" target="_blank" rel="noreferrer">KeePassXC</a>
                      <a href="https://support.dashlane.com/hc/articles/202625092" target="_blank" rel="noreferrer">Dashlane</a>
                    </div>
                  </div>
                </article>
              )}

              {section === 'sharing' && (
                <article className="settings-card settings-card-wide">
                  <div><p className="section-label">Liens à usage unique</p><h2>Serveur de partage</h2></div>
                  <p className="settings-copy">Les accès partagés sont chiffrés sur cet appareil, puis déposés sur votre serveur Clave auto-hébergé (dossier share-server). Le serveur ne reçoit jamais la clé, placée après le # du lien, et détruit le contenu dès la première ouverture ou à expiration.</p>
                  <form className="settings-form" onSubmit={submitShareServer}>
                    <label className="dialog-field"><span>Adresse du serveur</span><input id="share-server-input" type="url" inputMode="url" placeholder="https://partage.exemple.fr" value={shareServer} onChange={(event) => setShareServer(event.target.value)} /></label>
                    <button className="secondary-button" id="save-share-server" type="submit">Enregistrer</button>
                  </form>
                </article>
              )}

              {section === 'sharing' && (
                <article className="settings-card settings-card-wide" id="share-hosting-guide">
                  <div><p className="section-label">Pas encore de serveur ?</p><h2>Héberger votre serveur</h2></div>
                  <p className="settings-copy">Le serveur tient dans le dossier share-server du projet. Il consomme très peu : la plus petite offre d’un hébergeur suffit. Comptez une dizaine de minutes.</p>
                  <ol className="share-guide">
                    <li>
                      <strong>Un serveur et un nom de domaine</strong>
                      <span>Louez un petit VPS (environ 4 €/mois chez OVH, Hetzner, Scaleway…) ou utilisez un Raspberry Pi ou un NAS allumé en permanence. Chez votre registrar, ajoutez un enregistrement DNS de type A, par exemple partage.mondomaine.fr, qui pointe vers l’adresse IP du serveur.</span>
                    </li>
                    <li>
                      <strong>Copier le dossier sur le serveur</strong>
                      <span>Depuis votre PC, à la racine du projet :</span>
                      <code>scp -r share-server root@IP_DU_SERVEUR:/opt/clave-share</code>
                    </li>
                    <li>
                      <strong>Lancer avec Docker</strong>
                      <span>Connecté au serveur (ssh root@IP_DU_SERVEUR), installez Docker puis démarrez. Le certificat HTTPS est obtenu et renouvelé automatiquement.</span>
                      <code>curl -fsSL https://get.docker.com | sh</code>
                      <code>cd /opt/clave-share && echo "DOMAIN=partage.mondomaine.fr" &gt; .env && docker compose up -d</code>
                    </li>
                    <li>
                      <strong>Vérifier et brancher Clave</strong>
                      <span>Ouvrez https://partage.mondomaine.fr/healthz dans un navigateur : la page doit afficher {'{"ok":true}'}. Saisissez ensuite cette adresse (sans /healthz) dans le champ ci-dessus.</span>
                    </li>
                  </ol>
                  <p className="settings-copy share-guide-note">Juste pour essayer, sans serveur ni domaine : lancez node share-server/server.js sur votre PC, puis cloudflared tunnel --url http://localhost:8787, et collez l’adresse https://….trycloudflare.com obtenue. Installation sans Docker, nginx et dépannage : voir share-server/README.md.</p>
                </article>
              )}

              {section === 'shortcuts' && (
                <article className="settings-card settings-card-wide">
                  <div><p className="section-label">Raccourcis</p><h2>Verrouillage rapide</h2></div>
                  <div className="shortcut-row"><span>Raccourci actuel</span><output id="lock-hotkey-display">{displayHotkey(preferences.lockHotkey) || 'Aucun'}</output><button className="secondary-button" id="record-lock-hotkey" type="button" onClick={() => onAction('record-hotkey')}>Définir</button><button className="text-button" id="clear-lock-hotkey" type="button" onClick={() => onPreference('lockHotkey', '')}>Retirer</button></div>
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
