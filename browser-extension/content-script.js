(async () => {
  if (globalThis.__claveAutofillLoaded) return
  globalThis.__claveAutofillLoaded = true

  const { buildSuggestionModel, detectLoginFields, detectUsernameField, fillCredential, isLoginAction, shouldOfferSuggestion, suggestionAnchor, watchLoginCompletion } = await import(chrome.runtime.getURL('autofill-core.js'))
  let current = null
  let overlay = null
  let saveOverlay = null
  let requestId = 0
  let stopLoginWatcher = () => {}
  let lastStagedCandidate = { signature: '', createdAt: 0, promise: null }
  let pendingCandidateCheck = null

  function visible(input) {
    if (input.disabled || input.readOnly || input.type === 'hidden') return false
    if (input.closest('[aria-hidden="true"],[hidden],[inert]')) return false
    const style = getComputedStyle(input)
    const rect = input.getBoundingClientRect()
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false
    // Champs leurres (ex. « hiddenPassword » de Google) : minuscules ou hors écran.
    if (rect.width <= 2 || rect.height <= 2) return false
    return rect.right + scrollX > 0 && rect.bottom + scrollY > 0
  }

  function eventInput(event) {
    const target = event.composedPath?.()[0] || event.target
    return target instanceof HTMLInputElement ? target : null
  }

  function fieldsAround(input) {
    const scope = input.closest('form') || document
    const inputs = [...scope.querySelectorAll('input')]
    const fields = inputs.map((field) => ({
      type: field.type,
      name: field.name,
      id: field.id,
      autocomplete: field.autocomplete,
      placeholder: field.placeholder,
      visible: visible(field),
    }))
    const result = detectLoginFields(fields)
    const usernameIndex = result.usernameIndex >= 0 ? result.usernameIndex : detectUsernameField(fields)
    const username = usernameIndex >= 0 ? inputs[usernameIndex] : null
    const password = result.passwordIndex >= 0 ? inputs[result.passwordIndex] : null
    if (input !== username && input !== password) return null
    return { username, password, anchor: suggestionAnchor(username, password) }
  }

  function loginFieldsIn(scope) {
    const inputs = [...scope.querySelectorAll('input')]
    const descriptors = inputs.map((field) => ({
      type: field.type,
      name: field.name,
      id: field.id,
      autocomplete: field.autocomplete,
      placeholder: field.placeholder,
      visible: visible(field),
    }))
    const result = detectLoginFields(descriptors)
    const usernameIndex = result.usernameIndex >= 0 ? result.usernameIndex : detectUsernameField(descriptors)
    if (usernameIndex < 0 && result.passwordIndex < 0) return null
    return {
      username: usernameIndex >= 0 ? inputs[usernameIndex] : null,
      password: result.passwordIndex >= 0 ? inputs[result.passwordIndex] : null,
    }
  }

  // Un formulaire de connexion reste affiché tant qu’un mot de passe est visible ;
  // un simple champ e-mail (newsletter, recherche) ne doit pas bloquer la proposition.
  function pageHasVisibleLogin() {
    const fields = loginFieldsIn(document)
    return Boolean(fields?.password && visible(fields.password))
  }

  function watchForLoginCompletion() {
    stopLoginWatcher()
    stopLoginWatcher = watchLoginCompletion({
      hasVisibleLogin: pageHasVisibleLogin,
      onComplete: checkPendingCandidate,
      subscribe: (check) => {
        let frame = 0
        const observer = new MutationObserver(() => {
          if (frame) return
          frame = requestAnimationFrame(() => {
            frame = 0
            check()
          })
        })
        observer.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true,
        })
        return () => {
          cancelAnimationFrame(frame)
          observer.disconnect()
        }
      },
    })
  }

  async function stageLoginStep(scope, { offerSave = false } = {}) {
    const fields = loginFieldsIn(scope)
    const username = fields?.username?.value?.trim() || ''
    const password = fields?.password?.value || ''
    if (username && !password) {
      await chrome.runtime.sendMessage({
        type: 'stage-username',
        payload: { origin: location.origin, username, createdAt: Date.now() },
      }).catch(() => {})
      watchForLoginCompletion()
      return
    }
    if (location.protocol !== 'https:' || !password) return
    const signature = `${location.origin}\n${username}\n${password}`
    const now = Date.now()
    if (lastStagedCandidate.signature !== signature || now - lastStagedCandidate.createdAt > 1_000) {
      lastStagedCandidate = {
        signature,
        createdAt: now,
        promise: chrome.runtime.sendMessage({
          type: 'stage-candidate',
          payload: { origin: location.origin, username, password, createdAt: now },
        }).catch(() => null),
      }
    }
    const response = await lastStagedCandidate.promise
    if (offerSave && response?.ok) await checkPendingCandidate({ allowWhileLogin: true })
    watchForLoginCompletion()
  }

  function ensureOverlay() {
    if (overlay) return overlay.shadowRoot
    overlay = document.createElement('div')
    overlay.dataset.claveAutofill = 'true'
    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '2147483647',
      width: 'min(360px, calc(100vw - 24px))',
      height: '0',
    })
    const shadow = overlay.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = `
      :host{all:initial;color-scheme:light dark}
      *{box-sizing:border-box}
      .sheet{overflow:hidden;border-radius:14px;background:#fbfcfb;color:#17211c;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 0 0 1px rgba(20,38,29,.10),0 10px 30px rgba(15,35,25,.16),0 2px 8px rgba(15,35,25,.08);transform-origin:top center;opacity:1;transform:translateY(0);filter:blur(0);transition:opacity 120ms cubic-bezier(.22,1,.36,1),transform 160ms cubic-bezier(.22,1,.36,1),filter 160ms cubic-bezier(.22,1,.36,1)}
      .sheet.entering{opacity:0;transform:translateY(-5px);filter:blur(2px)}
      .header{display:flex;align-items:center;gap:9px;padding:11px 12px 9px;border-bottom:1px solid rgba(20,38,29,.07)}
      .mark{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:#e8f4ed;color:#12663f}
      .mark svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      .identity{display:grid;gap:1px;min-width:0}.identity strong{font-size:13px;letter-spacing:-.01em}.identity span{overflow:hidden;color:#657269;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      .count{margin-left:auto;color:#7c8881;font-size:11px}
      .accounts{padding:5px}
      .account{display:grid;grid-template-columns:32px minmax(0,1fr) 18px;align-items:center;gap:9px;width:100%;padding:8px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;transition:background-color 120ms cubic-bezier(.22,1,.36,1),transform 120ms cubic-bezier(.22,1,.36,1)}
      .account:hover,.account:focus-visible{background:#edf6f1;outline:none}.account:active{transform:scale(.985)}
      .avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#18231e;color:#fff;font-size:11px;font-weight:750;letter-spacing:.02em}
      .copy{display:grid;gap:2px;min-width:0}.copy strong,.copy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.copy strong{font-size:12.5px}.copy span{color:#657269;font-size:11px}
      .arrow{color:#7b8780;font-size:17px;text-align:center}
      .state{display:grid;gap:9px;padding:14px}.state strong{font-size:13px}.state span{color:#657269;font-size:12px}
      .unlock{justify-self:start;border:0;border-radius:9px;background:#176d46;color:#fff;padding:8px 11px;font:700 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.unlock:active{transform:scale(.98)}
      @media(prefers-color-scheme:dark){.sheet{background:#141a17;color:#f1f5f2;box-shadow:0 0 0 1px rgba(255,255,255,.11),0 14px 36px rgba(0,0,0,.42)}.header{border-bottom-color:rgba(255,255,255,.08)}.mark{background:#173c2b;color:#7fdaa9}.identity span,.count,.copy span,.state span,.arrow{color:#98a69e}.account:hover,.account:focus-visible{background:#1f2a25}.avatar{background:#e9f3ed;color:#152019}}
      @media(prefers-reduced-motion:reduce){.sheet,.account{transition-duration:.01ms!important}.sheet.entering{opacity:1;transform:none;filter:none}}
    `
    shadow.appendChild(style)
    document.documentElement.appendChild(overlay)
    return shadow
  }

  function position() {
    if (!overlay || !current?.anchor?.isConnected) return
    const rect = current.anchor.getBoundingClientRect()
    const width = Math.min(360, Math.max(280, rect.width))
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
    const estimatedHeight = overlay.shadowRoot.querySelector('.sheet')?.getBoundingClientRect().height || 170
    const fitsBelow = rect.bottom + estimatedHeight + 10 < window.innerHeight
    overlay.style.width = `${width}px`
    overlay.style.left = `${left}px`
    overlay.style.top = `${fitsBelow ? rect.bottom + 8 : Math.max(12, rect.top - estimatedHeight - 8)}px`
    const sheet = overlay.shadowRoot.querySelector('.sheet')
    if (sheet) sheet.style.transformOrigin = fitsBelow ? 'top center' : 'bottom center'
  }

  function showSheet(content) {
    const shadow = ensureOverlay()
    shadow.querySelector('.sheet')?.remove()
    const sheet = document.createElement('section')
    sheet.className = 'sheet entering'
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-label', 'Comptes Clave')
    sheet.appendChild(content)
    shadow.appendChild(sheet)
    position()
    requestAnimationFrame(() => sheet.classList.remove('entering'))
  }

  function closeSheet() {
    requestId += 1
    overlay?.remove()
    overlay = null
  }

  function keyIcon() {
    const wrapper = document.createElement('span')
    wrapper.className = 'mark'
    wrapper.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.5" cy="15.5" r="3.5"></circle><path d="m10 13 8.5-8.5M15 8l2 2m-5-5 2 2"></path></svg>'
    return wrapper
  }

  function removeSavePrompt() {
    saveOverlay?.remove()
    saveOverlay = null
  }

  function armUnlockButton(button, message) {
    button.textContent = 'Ouvrir Clave'
    button.disabled = false
    button.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'focus' }).catch(() => {})
      const retry = button.cloneNode(true)
      retry.textContent = 'Réessayer'
      retry.addEventListener('click', savePendingCandidate)
      button.replaceWith(retry)
      message.textContent = 'Une fois le coffre déverrouillé, cliquez sur Réessayer.'
    }, { once: true })
  }

  function showSavePrompt(candidate) {
    removeSavePrompt()
    saveOverlay = document.createElement('div')
    saveOverlay.dataset.claveSave = 'true'
    Object.assign(saveOverlay.style, {
      position: 'fixed',
      zIndex: '2147483647',
      top: '16px',
      right: '16px',
      width: 'min(390px, calc(100vw - 32px))',
    })
    const shadow = saveOverlay.attachShadow({ mode: 'open' })
    const host = (() => {
      try { return new URL(candidate.origin).hostname }
      catch (_) { return location.hostname }
    })()
    shadow.innerHTML = `
      <style>
        :host{all:initial;color-scheme:light dark}
        *{box-sizing:border-box}
        .notice{display:grid;grid-template-columns:34px minmax(0,1fr);gap:11px;padding:13px;border-radius:15px;background:#fbfcfb;color:#17211c;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 0 0 1px rgba(20,38,29,.10),0 14px 38px rgba(15,35,25,.18);opacity:1;transform:translateY(0);filter:blur(0);transition:opacity 140ms cubic-bezier(.22,1,.36,1),transform 180ms cubic-bezier(.22,1,.36,1),filter 180ms cubic-bezier(.22,1,.36,1)}
        .notice.entering{opacity:0;transform:translateY(-8px);filter:blur(2px)}
        .mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#e8f4ed;color:#12663f}.mark svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        .body{display:grid;gap:3px;min-width:0}.body strong{font-size:13.5px;letter-spacing:-.01em}.meta{overflow:hidden;color:#66736b;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}.message{margin-top:2px;color:#536159;font-size:12px}
        .actions{display:flex;align-items:center;gap:7px;margin-top:9px}.actions button{border:0;border-radius:9px;padding:8px 11px;font:700 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:transform 120ms cubic-bezier(.22,1,.36,1),background-color 120ms}.actions button:active{transform:scale(.98)}
        .primary{background:#176d46;color:#fff}.primary:hover{background:#125c3a}.later{background:transparent;color:#617067}.later:hover{background:#eef3f0}.status{color:#176d46;font-weight:650}
        @media(prefers-color-scheme:dark){.notice{background:#141a17;color:#f1f5f2;box-shadow:0 0 0 1px rgba(255,255,255,.11),0 16px 40px rgba(0,0,0,.45)}.mark{background:#173c2b;color:#7fdaa9}.meta,.message{color:#9aa79f}.later{color:#aab6af}.later:hover{background:#202a25}.status{color:#7fdaa9}}
        @media(prefers-reduced-motion:reduce){.notice,.actions button{transition-duration:.01ms!important}.notice.entering{opacity:1;transform:none;filter:none}}
      </style>
      <section class="notice entering" role="dialog" aria-label="Proposition d’enregistrement Clave" aria-live="polite">
        <span class="mark"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.5" cy="15.5" r="3.5"></circle><path d="m10 13 8.5-8.5M15 8l2 2m-5-5 2 2"></path></svg></span>
        <div class="body">
          <strong>${candidate.action === 'update' ? 'Mettre à jour dans Clave ?' : 'Enregistrer dans Clave ?'}</strong>
          <span class="meta"></span>
          <span class="message">${candidate.locked ? 'Déverrouillez votre coffre avant de continuer.' : candidate.action === 'update' ? 'Le mot de passe enregistré est différent.' : 'Ce compte n’est pas encore dans votre coffre.'}</span>
          <div class="actions"><button class="primary" type="button">${candidate.locked ? 'Ouvrir Clave' : candidate.action === 'update' ? 'Mettre à jour' : 'Enregistrer'}</button><button class="later" type="button">Plus tard</button></div>
        </div>
      </section>`
    shadow.querySelector('.meta').textContent = `${candidate.username} · ${host}`
    shadow.querySelector('.later').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'dismiss-pending-candidate' }).catch(() => {})
      removeSavePrompt()
    })
    const primary = shadow.querySelector('.primary')
    if (candidate.locked) {
      armUnlockButton(primary, shadow.querySelector('.message'))
    } else {
      primary.addEventListener('click', savePendingCandidate)
    }
    document.documentElement.appendChild(saveOverlay)
    requestAnimationFrame(() => shadow.querySelector('.notice')?.classList.remove('entering'))
  }

  async function savePendingCandidate() {
    if (!saveOverlay) return
    const shadow = saveOverlay.shadowRoot
    const primary = shadow.querySelector('.primary')
    const message = shadow.querySelector('.message')
    primary.disabled = true
    const response = await chrome.runtime.sendMessage({ type: 'save-pending-candidate' })
    if (response?.ok) {
      shadow.querySelector('.actions').remove()
      message.className = 'message status'
      message.textContent = 'Enregistré dans Clave.'
      setTimeout(removeSavePrompt, 1_200)
      return
    }
    primary.disabled = false
    if (response?.error?.code === 'locked') {
      const unlock = primary.cloneNode(true)
      primary.replaceWith(unlock)
      armUnlockButton(unlock, message)
      message.textContent = 'Déverrouillez votre coffre, puis réessayez.'
      return
    }
    message.textContent = response?.error?.message || 'Impossible d’enregistrer ce compte.'
  }

  async function checkPendingCandidate({ allowWhileLogin = false } = {}) {
    if ((!allowWhileLogin && pageHasVisibleLogin()) || saveOverlay) return
    if (pendingCandidateCheck) return pendingCandidateCheck
    pendingCandidateCheck = chrome.runtime.sendMessage({ type: 'pending-candidate' })
      .then((response) => {
        if (response?.ok && response.data?.pending && !saveOverlay) showSavePrompt(response.data.candidate)
      })
      .catch(() => {})
      .finally(() => { pendingCandidateCheck = null })
    return pendingCandidateCheck
  }

  function initials(account) {
    const source = account.label || account.username || 'Clave'
    return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }

  function accountSheet(accounts) {
    const model = buildSuggestionModel(accounts)
    const fragment = document.createDocumentFragment()
    const header = document.createElement('header')
    header.className = 'header'
    const identity = document.createElement('span')
    identity.className = 'identity'
    const title = document.createElement('strong')
    title.textContent = model.title
    const host = document.createElement('span')
    host.textContent = location.hostname
    identity.append(title, host)
    const count = document.createElement('span')
    count.className = 'count'
    count.textContent = model.countLabel
    header.append(keyIcon(), identity, count)
    fragment.appendChild(header)

    const list = document.createElement('div')
    list.className = 'accounts'
    for (const account of model.items) {
      const button = document.createElement('button')
      button.className = 'account'
      button.type = 'button'
      const avatar = document.createElement('span')
      avatar.className = 'avatar'
      avatar.textContent = initials(account)
      const copy = document.createElement('span')
      copy.className = 'copy'
      const label = document.createElement('strong')
      label.textContent = account.label || 'Compte Clave'
      const username = document.createElement('span')
      username.textContent = account.username || 'Sans identifiant'
      copy.append(label, username)
      const arrow = document.createElement('span')
      arrow.className = 'arrow'
      arrow.textContent = '›'
      button.append(avatar, copy, arrow)
      button.addEventListener('click', () => useAccount(account))
      list.appendChild(button)
    }
    fragment.appendChild(list)
    return fragment
  }

  function lockedSheet(message) {
    const state = document.createElement('div')
    state.className = 'state'
    const title = document.createElement('strong')
    title.textContent = 'Coffre verrouillé'
    const copy = document.createElement('span')
    copy.textContent = message
    const button = document.createElement('button')
    button.className = 'unlock'
    button.type = 'button'
    button.textContent = 'Ouvrir Clave'
    button.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'focus' }))
    state.append(title, copy, button)
    return state
  }

  async function offerFor(fields, interaction = 'click') {
    current = fields
    const thisRequest = ++requestId
    const response = await chrome.runtime.sendMessage({ type: 'matches', payload: { origin: location.origin } })
    if (thisRequest !== requestId || !current?.anchor?.isConnected) return
    if (!response?.ok || !shouldOfferSuggestion(interaction, response.data)) return
    showSheet(accountSheet(response.data))
  }

  async function useAccount(account) {
    const fields = current
    if (!fields || (!fields.username?.isConnected && !fields.password?.isConnected)) {
      closeSheet()
      return
    }
    const response = await chrome.runtime.sendMessage({
      type: 'credential',
      payload: { origin: location.origin, category: account.category, index: account.index },
    })
    if (!response?.ok) {
      if (response?.error?.code === 'locked') showSheet(lockedSheet(response.error.message || 'Déverrouillez Clave pour continuer.'))
      return
    }
    fillCredential(fields.username, fields.password, response.data)
    closeSheet()
    ;(fields.password || fields.username)?.focus()
  }

  document.addEventListener('click', (event) => {
    const input = eventInput(event)
    if (!input) return
    const fields = fieldsAround(input)
    if (!fields) return
    closeSheet()
    offerFor(fields, 'click')
  }, true)

  document.addEventListener('input', (event) => {
    const input = eventInput(event)
    if (input && fieldsAround(input)) closeSheet()
  })

  document.addEventListener('submit', (event) => {
    if (event.target instanceof HTMLFormElement) stageLoginStep(event.target, { offerSave: true })
  }, true)

  document.addEventListener('click', (event) => {
    const action = event.target instanceof Element
      ? event.target.closest('button,input[type="submit"],input[type="button"],input[type="image"],[role="button"],a[href]')
      : null
    if (!action) return
    const scope = action.form || action.closest('form') || document
    if (!isLoginAction({
      tagName: action.tagName,
      type: action.type,
      role: action.getAttribute('role'),
      text: action.textContent,
      ariaLabel: action.getAttribute('aria-label'),
      id: action.id,
      name: action.getAttribute('name'),
    })) return
    stageLoginStep(scope, { offerSave: true })
  }, true)

  document.addEventListener('keydown', (event) => {
    const input = event.key === 'Enter' ? eventInput(event) : null
    if (!input) return
    const scope = input.closest('form') || input.getRootNode()
    const fields = loginFieldsIn(scope)
    if (input === fields?.username || input === fields?.password) {
      stageLoginStep(scope, { offerSave: true })
    }
  }, true)

  document.addEventListener('pointerdown', (event) => {
    if (overlay && event.target !== overlay && !overlay.contains(event.target)) closeSheet()
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet()
  })

  addEventListener('resize', position, { passive: true })
  addEventListener('scroll', position, { passive: true, capture: true })
  // Seule la page principale propose l’enregistrement après navigation : sinon
  // chaque iframe (publicités, widgets de Gmail…) afficherait sa propre bannière.
  if (window === window.top) setTimeout(checkPendingCandidate, 800)
})()
