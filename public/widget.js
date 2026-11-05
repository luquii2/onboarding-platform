(() => {
  const editorOrigin = document.currentScript?.dataset.editorOrigin

  if (
    !editorOrigin ||
    window.parent === window ||
    window.__onboardingPrototype
  ) return

  window.__onboardingPrototype = true

  const CHANNEL = 'onboarding-prototype/v1'

  let session = ''
  let picking = false
  let hovered = null
  let run = null
  let raf = 0
  let lastFocus = null

  let host, shadow, ring, card, block
  let title, text, progress, back, next, skip

  function post(type, payload = {}) {
    if (!session) return

    window.parent.postMessage({
      channel: CHANNEL,
      session,
      type,
      ...payload,
    }, editorOrigin)
  }

  function event(name, message) {
    if (!run) return

    post('event', {
      name,
      runId: run.id,
      stepId: run.steps[run.index].id,
      index: run.index,
      message,
    })
  }

  function ui() {
    if (host) return

    host = document.createElement('div')
    shadow = host.attachShadow({ mode: 'open' })

    shadow.innerHTML = [
      '<style>',
      ':host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:light}',
      '[hidden]{display:none!important}*{box-sizing:border-box}',
      '#block{position:fixed;inset:0;pointer-events:auto}',
      '#ring{position:fixed;border-radius:7px;outline:3px solid #4f46e5;box-shadow:0 0 0 9999px #0f172a66;pointer-events:none}',
      '#card{position:fixed;width:320px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;background:#fff;color:#20243a;padding:18px;border-radius:12px;box-shadow:0 12px 40px #0003;font:15px/1.5 system-ui,sans-serif;pointer-events:auto}',
      'h2{font-size:18px;margin:8px 0}p{white-space:pre-wrap;margin:8px 0 16px}small{color:#626b80}',
      'nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #d4d9e7;border-radius:7px;padding:7px 10px;background:white;color:#20243a;cursor:pointer}button:focus-visible{outline:3px solid #818cf8;outline-offset:2px}',
      '</style>',
      '<div id="block" hidden></div><div id="ring" hidden></div>',
      '<section id="card" role="dialog" aria-modal="true" aria-labelledby="ob-title" aria-describedby="ob-text" hidden>',
      '<small id="progress"></small><h2 id="ob-title"></h2><p id="ob-text"></p>',
      '<nav aria-label="Управление туром"><button id="back">Назад</button><button id="next">Далее</button><button id="skip">Пропустить</button></nav></section>',
    ].join('')

    const get = id => shadow.getElementById(id)

    ring = get('ring')
    card = get('card')
    block = get('block')
    title = get('ob-title')
    text = get('ob-text')
    progress = get('progress')
    back = get('back')
    next = get('next')
    skip = get('skip')

    back.onclick = () => {
      if (run && run.index > 0) {
        run.index--
        show()
      }
    }

    next.onclick = () => {
      if (!run) return

      const step = run.steps[run.index]

      if (!run.completed.has(step.id)) {
        run.completed.add(step.id)
        event('step_completed')
      }

      if (run.index === run.steps.length - 1) {
        finish('tour_completed')
      } else {
        run.index++
        show()
      }
    }

    skip.onclick = () => finish('tour_skipped')
    document.documentElement.append(host)
  }

  function clear() {
    cancelAnimationFrame(raf)
    raf = 0
    picking = false
    hovered = null

    if (host) {
      ring.hidden = card.hidden = block.hidden = true
    }
  }

  function finish(name, message) {
    if (!run) return

    event(name, message)
    run = null
    clear()

    if (lastFocus?.isConnected) {
      lastFocus.focus({ preventScroll: true })
    }
  }

  function selector(element) {
    if (element === document.documentElement) return 'html'

    for (const attr of ['data-onboarding', 'id']) {
      const value = element.getAttribute(attr)
      if (!value) continue

      const candidate =
        '[' + attr + '="' + CSS.escape(value) + '"]'

      if (document.querySelectorAll(candidate).length === 1) {
        return candidate
      }
    }

    const parts = []
    let node = element

    while (node && node !== document.documentElement) {
      const siblings = [
        ...(node.parentElement?.children || []),
      ].filter(item => item.localName === node.localName)

      parts.unshift(
        CSS.escape(node.localName) +
        ':nth-of-type(' +
        (siblings.indexOf(node) + 1) +
        ')',
      )

      node = node.parentElement
    }

    return 'html > ' + parts.join(' > ')
  }

  function visible(element) {
    if (!element?.isConnected) return false

    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)

    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
  }

  function layout(element) {
    const rect = element.getBoundingClientRect()

    ring.hidden = false

    Object.assign(ring.style, {
      left: (rect.left - 4) + 'px',
      top: (rect.top - 4) + 'px',
      width: (rect.width + 8) + 'px',
      height: (rect.height + 8) + 'px',
    })

    if (!run) return

    const width = card.offsetWidth
    const height = card.offsetHeight
    const left = Math.max(
      12,
      Math.min(rect.left, innerWidth - width - 12),
    )

    let top = rect.bottom + 12

    if (top + height > innerHeight - 12) {
      top = rect.top - height - 12
    }

    top = Math.max(
      12,
      Math.min(top, innerHeight - height - 12),
    )

    Object.assign(card.style, {
      left: left + 'px',
      top: top + 'px',
    })
  }

  function tick() {
    raf = 0

    if (run) {
      if (!visible(run.target)) {
        finish(
          'tour_error',
          'Элемент исчез или скрыт. Выбери другую цель.',
        )
        return
      }

      layout(run.target)
    } else if (picking && visible(hovered)) {
      layout(hovered)
    } else if (ring) {
      ring.hidden = true
    }

    if (run || picking) {
      raf = requestAnimationFrame(tick)
    }
  }

  function animate() {
    if (!raf) raf = requestAnimationFrame(tick)
  }

  function show() {
    if (!run) return

    const step = run.steps[run.index]
    let matches

    try {
      matches = document.querySelectorAll(step.selector)
    } catch {
      finish('tour_error', 'Некорректный селектор элемента.')
      return
    }

    if (matches.length !== 1 || !visible(matches[0])) {
      finish(
        'tour_error',
        'Цель шага ' + (run.index + 1) +
        ' отсутствует, скрыта или не уникальна.',
      )
      return
    }

    run.target = matches[0]

    run.target.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'instant',
    })

    title.textContent = step.title || 'Подсказка'
    text.textContent = step.text
    progress.textContent =
      'Шаг ' + (run.index + 1) + ' из ' + run.steps.length

    back.hidden = run.index === 0
    next.textContent =
      run.index === run.steps.length - 1
        ? 'Завершить'
        : 'Далее'

    card.hidden = block.hidden = false
    layout(run.target)
    next.focus({ preventScroll: true })
    event('step_shown')
    animate()
  }

  function validSteps(steps) {
    return Array.isArray(steps) &&
      steps.length > 0 &&
      steps.length <= 50 &&
      steps.every(step =>
        step &&
        typeof step.id === 'string' &&
        step.id.length > 0 &&
        typeof step.selector === 'string' &&
        step.selector.length > 0 &&
        step.selector.length <= 2000 &&
        typeof step.title === 'string' &&
        step.title.length <= 120 &&
        typeof step.text === 'string' &&
        step.text.length <= 2000,
      ) &&
      new Set(steps.map(step => step.id)).size === steps.length
  }

  window.addEventListener('message', message => {
    if (
      message.origin !== editorOrigin ||
      message.source !== window.parent
    ) return

    const data = message.data

    if (
      !data ||
      data.channel !== CHANNEL ||
      typeof data.session !== 'string' ||
      data.session.length < 10 ||
      data.session.length > 100
    ) return

    if (data.type === 'hello') {
      if (run) finish('tour_stopped')

      clear()
      session = data.session
      ui()
      post('ready')
      return
    }

    if (!session || data.session !== session) return

    if (data.type === 'pick') {
      if (run) finish('tour_stopped')

      clear()
      picking = true
      animate()
    } else if (data.type === 'cancel-pick') {
      if (!picking) return

      clear()
      post('pick-cancelled')
    } else if (data.type === 'stop') {
      if (run) finish('tour_stopped')
      else clear()
    } else if (data.type === 'preview') {
      if (
        !validSteps(data.steps) ||
        typeof data.color !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(data.color)
      ) {
        post('error', {
          message: 'Некорректные данные тура.',
        })
        return
      }

      if (run) finish('tour_stopped')

      clear()
      lastFocus = document.activeElement

      run = {
        id: crypto.randomUUID(),
        steps: data.steps,
        index: 0,
        completed: new Set(),
        target: null,
      }

      next.style.background = data.color

      const rgb = [1, 3, 5].map(index =>
        parseInt(data.color.slice(index, index + 2), 16),
      )

      const brightness =
        (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000

      next.style.color =
        brightness > 145 ? '#111827' : '#ffffff'

      event('tour_started')
      show()
    }
  })

  document.addEventListener('pointermove', event => {
    if (
      !picking ||
      event.composedPath().includes(host)
    ) return

    hovered =
      event.target instanceof Element ? event.target : null
  }, true)

  document.addEventListener('pointerdown', event => {
    if (
      !picking ||
      event.composedPath().includes(host)
    ) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)

  document.addEventListener('click', event => {
    if (
      !picking ||
      event.composedPath().includes(host) ||
      !(event.target instanceof Element)
    ) return

    event.preventDefault()
    event.stopImmediatePropagation()

    const result = selector(event.target)
    clear()

    if (result.length > 2000) {
      post('error', {
        message: 'Слишком сложная цель. Выбери другой элемент.',
      })
    } else {
      post('selected', { selector: result })
    }
  }, true)

  document.addEventListener('keydown', event => {
    if (picking && event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      clear()
      post('pick-cancelled')
    } else if (run && event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      finish('tour_skipped')
    } else if (run && event.key === 'Tab') {
      const buttons = [back, next, skip].filter(
        button => !button.hidden,
      )

      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      const active = shadow.activeElement

      if (
        !buttons.includes(active) ||
        (!event.shiftKey && active === last) ||
        (event.shiftKey && active === first)
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
  }, true)
})()
