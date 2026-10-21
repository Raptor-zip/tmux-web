/*
 * 画面まわりの考え方は Apple の HIG と「Designing Fluid Interfaces」に寄せてある。
 * - シートは掴んで下に引いて閉じられる。指の速度を引き継ぎ、飛ばした先を予測して決める
 * - 動きはバネ。途中で掴めば、そこから引き返せる（アニメの終了を待たせない）
 * - 取り返しがつく操作に確認ダイアログを出さない。出すのは本当に壊れるものだけ
 * - アイコンはすべて SVG。記号文字はフォント任せで形も太さも揃わない
 */

import { icon, spinner, KIND_ICON } from './icons.js'

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)')

const STATUS_LABEL = {
  working: '作業中',
  waiting_approval: '要対応',
  trust_prompt: '要対応',
  waiting_input: '入力待ち',
  unknown: '状態不明',
}

/** 上から順に振り分ける。電車で最初に知りたいのは「自分待ちのもの」なので先頭に置く。 */
const GROUPS = [
  { key: 'attention', label: 'あなたの操作待ち', match: (s) => s.status === 'waiting_approval' || s.status === 'trust_prompt' },
  { key: 'working', label: '作業中', match: (s) => s.status === 'working' },
  { key: 'idle', label: '待機中', match: () => true },
]

let currentTab = 'sessions'
let pollTimer = null
let firstSessionsLoad = true
let inFlight = 0
const filesState = { path: null, home: null, hidden: false }

// ── 共通ユーティリティ ───────────────────────────────────────────────────────
function toast(msg, bad = false) {
  const t = $('toast')
  t.replaceChildren(el('span', null, msg))
  t.classList.toggle('bad', bad)
  t.classList.remove('hidden')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => t.classList.add('hidden'), 2800)
}

async function api(path, options) {
  const res = await fetch(path, options)
  const ct = res.headers.get('content-type') ?? ''
  const body = ct.includes('json') ? await res.json() : await res.text()
  if (!res.ok) throw new Error(body?.error ?? String(body).slice(0, 200))
  return body
}

const postJson = (path, data) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })

function ago(ms) {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 45) return 'たった今'
  if (s < 3600) return `${Math.round(s / 60)}分前`
  if (s < 86400) return `${Math.round(s / 3600)}時間前`
  return `${Math.round(s / 86400)}日前`
}

function size(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

/** 更新ボタンは、読み込み中だけ回るスピナーに入れ替える（矢印を回転させるより素直） */
function setBusy(busy) {
  inFlight = Math.max(0, inFlight + (busy ? 1 : -1))
  const btn = $('refresh')
  const on = inFlight > 0
  btn.replaceChildren(on ? spinner() : icon('refresh'))
  btn.classList.toggle('busy', on)
}

// ── まとまったアクション一覧（iOS の inset grouped list に相当） ──────────────
function actionGroup(items) {
  const g = el('div', 'action-group')
  for (const it of items.filter(Boolean)) {
    const node = it.href ? el('a', 'action') : el('button', 'action')
    if (it.href) {
      node.href = it.href
      if (it.external) {
        node.target = '_blank'
        node.rel = 'noopener'
      }
    }
    if (it.kind) node.classList.add(it.kind)
    node.append(icon(it.icon ?? 'chevronRight', 'lead'))
    node.append(el('span', 'action-label', it.label))
    node.append(icon(it.trailing ?? 'chevronRight', 'trail'))
    if (it.onClick) node.addEventListener('click', () => it.onClick(node))
    if (it.setup) it.setup(node)
    g.append(node)
  }
  return g
}

function primaryLink(label, href) {
  const a = el('a', 'primary-action')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener'
  a.append(icon('external', 'lead'), el('span', null, label))
  return a
}

function primaryButton(label, iconName, onClick) {
  const b = el('button', 'primary-action')
  b.append(icon(iconName, 'lead'), el('span', null, label))
  b.addEventListener('click', () => onClick(b))
  return b
}

// ── シート ──────────────────────────────────────────────────────────────────
// 臨界減衰のバネ（response ≒ 0.35s）。行きすぎず、掴めば途中から追従する。
const SPRING = { k: 170, c: 26 }

const sheetEl = $('sheet')
const panel = $('sheet-panel')
const scrim = $('sheet-bg')
const handle = $('sheet-handle')

let y = 0
let vel = 0
let raf = 0
let springTarget = 0
let panelH = 0
let dragging = false
let dragStartY = 0
let dragStartTop = 0
let history = []

const panelHeight = () => panel.offsetHeight || window.innerHeight * 0.6

function paint() {
  panel.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`
  scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - y / (panelH || 1))))
}

function stopSpring() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

/**
 * 現在位置と現在速度からバネで target へ。途中で stopSpring すればそこから掴み直せる。
 * earlyAt を渡すと、そこまで来た時点で終わったことにする（見えなくなった後の余韻を待たない）。
 */
function springTo(target, v0, done, earlyAt = null) {
  stopSpring()
  springTarget = target
  if (v0 != null) vel = v0
  if (REDUCE.matches) {
    y = target
    vel = 0
    paint()
    done?.()
    return
  }
  let last = performance.now()
  const step = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now
    vel += (-SPRING.k * (y - springTarget) - SPRING.c * vel) * dt
    y += vel * dt
    paint()
    if (earlyAt != null && y >= earlyAt) {
      raf = 0
      done?.()
      return
    }
    if (Math.abs(y - springTarget) < 0.5 && Math.abs(vel) < 24) {
      y = springTarget
      vel = 0
      paint()
      raf = 0
      done?.()
      return
    }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

/** 指を離したあと、その速度でどこまで滑るか。Apple のサンプルと同じ指数減衰の形。 */
const project = (v, decel = 0.998) => ((v / 1000) * decel) / (1 - decel)

/** 上端より上へは、引くほど付いてこなくなる（硬い壁にしない）。 */
function rubberband(overshoot) {
  const d = panelH || window.innerHeight
  const c = 0.55
  return -(Math.abs(overshoot) * d * c) / (d + c * Math.abs(overshoot))
}

function openSheet(build) {
  const body = $('sheet-body')
  body.replaceChildren()
  build(body)

  sheetEl.classList.remove('hidden', 'closing')
  panelH = panelHeight()
  y = panelH
  vel = 0
  paint()
  springTo(0, 0)
}

function closeSheet(v0 = 0) {
  if (sheetEl.classList.contains('hidden')) return
  panelH = panelHeight() || panelH
  // 閉じ始めた時点で背景は入力を吸わなくなる。下のボタンをすぐ押せる
  // （パネル自体は生きているので、途中で掴んで引き戻せる）
  sheetEl.classList.add('closing')
  springTo(
    panelH,
    v0,
    () => {
      sheetEl.classList.add('hidden')
      sheetEl.classList.remove('closing')
      $('sheet-body').replaceChildren()
    },
    panelH - 2, // 見えなくなったら終わり。バネが完全に止まるまで待たない
  )
}

function velocityFromHistory() {
  if (history.length < 2) return 0
  const [t1, p1] = history[history.length - 1]
  let i = history.length - 2
  while (i > 0 && t1 - history[i][0] < 60) i--
  const [t0, p0] = history[i]
  const dt = (t1 - t0) / 1000
  return dt > 0 ? (p1 - p0) / dt : 0
}

handle.addEventListener('pointerdown', (e) => {
  handle.setPointerCapture(e.pointerId)
  stopSpring() // 動いている最中でも掴める
  sheetEl.classList.remove('closing')
  dragging = true
  panelH = panelHeight()
  dragStartY = e.clientY
  dragStartTop = y
  history = [[performance.now(), e.clientY]]
})

handle.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const next = dragStartTop + (e.clientY - dragStartY)
  y = next < 0 ? rubberband(next) : next
  paint()
  history.push([performance.now(), e.clientY])
  if (history.length > 8) history.shift()
})

function endDrag() {
  if (!dragging) return
  dragging = false
  const v = velocityFromHistory()
  // 離した点ではなく「投げた先」で判断する。軽く弾いただけでも閉じる
  const projected = y + project(v)
  if (projected > panelH * 0.35 || v > 700) closeSheet(v)
  else springTo(0, v)
}
handle.addEventListener('pointerup', endDrag)
handle.addEventListener('pointercancel', endDrag)

scrim.addEventListener('click', () => closeSheet())
$('sheet-close').addEventListener('click', () => closeSheet())
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet()
})

/** 2 回押しで確定する破壊的な項目。ネイティブの confirm を出さずに引き返せるようにする。 */
function armed(label, armedLabel, onConfirm) {
  let state = false
  let timer = null
  return {
    label,
    icon: 'close',
    kind: 'danger',
    trailing: 'chevronRight',
    onClick(node) {
      const text = node.querySelector('.action-label')
      if (!state) {
        state = true
        node.classList.add('armed')
        text.textContent = armedLabel
        timer = setTimeout(() => {
          state = false
          node.classList.remove('armed')
          text.textContent = label
        }, 4000)
        return
      }
      clearTimeout(timer)
      onConfirm(node)
    },
  }
}

// ── タブ ────────────────────────────────────────────────────────────────────
const TAB_TITLE = { sessions: 'セッション', new: '新規プロジェクト', files: 'ファイル' }

function switchTab(tab) {
  currentTab = tab
  $('title').textContent = TAB_TITLE[tab]
  for (const name of ['sessions', 'new', 'files']) {
    $(`view-${name}`).classList.toggle('hidden', name !== tab)
  }
  document.querySelectorAll('.tabbar button').forEach((b) => {
    const on = b.dataset.tab === tab
    b.classList.toggle('active', on)
    b.setAttribute('aria-current', on ? 'page' : 'false')
  })
  if (tab === 'sessions') loadSessions()
  if (tab === 'files' && !filesState.path) loadFiles('~')
}

// 中身が潜り込んだときだけヘッダに境界を出す（常時の 1px 罫線より静か）
addEventListener('scroll', () => $('topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true })

// ── セッション一覧 ───────────────────────────────────────────────────────────
function sessionCard(s, attention) {
  const card = el('button', attention ? 'card attention' : 'card')

  const main = el('div', 'card-main')
  const top = el('div', 'card-top')
  top.append(el('div', 'card-name', s.name), el('div', 'card-time', ago(s.lastActivity)))
  main.append(top, el('div', 'card-path', s.display))

  const badges = el('div', 'badges')
  const st = el('span', `badge ${s.status}`)
  st.append(el('span', 'dot'), document.createTextNode(STATUS_LABEL[s.status] ?? s.status))
  badges.append(st)
  if (s.rc) {
    const rc = el('span', 'badge rc')
    rc.append(icon('broadcast', 'tiny'), document.createTextNode('RC 接続中'))
    badges.append(rc)
  } else {
    badges.append(el('span', 'badge norc', 'RC なし'))
  }
  if (!s.controllable) badges.append(el('span', 'badge', 'tmux 外'))
  main.append(badges)

  const line = s.note || s.tail
  if (line) main.append(el('div', 'card-tail', line))

  card.append(main, icon('chevronRight', 'card-chevron'))
  card.addEventListener('click', () => openSessionSheet(s))
  return card
}

function sheetHeader(body, title, sub) {
  body.append(el('h2', null, title))
  body.append(el('div', 'sub', sub))
}

function openSessionSheet(s) {
  openSheet((body) => {
    sheetHeader(
      body,
      s.name,
      `${s.display}　/　${STATUS_LABEL[s.status] ?? s.status}` +
        (s.tmuxSession ? `　/　tmux: ${s.tmuxSession} ${s.window ?? ''}` : ''),
    )

    if (s.rcUrl) {
      body.append(primaryLink('Claude アプリで開く', s.rcUrl))
    } else if (s.rc) {
      body.append(primaryLink('Claude の Code 一覧を開く', 'https://claude.ai/code'))
      body.append(el('p', 'note', `一覧から「${s.name}」を選んでください`))
    } else if (s.controllable) {
      body.append(
        primaryButton('Remote Control を有効にする', 'broadcast', async (b) => {
          b.disabled = true
          try {
            await postJson('/projects/api/session/rc', { id: s.id })
            toast('/remote-control を送りました')
            closeSheet()
            setTimeout(loadSessions, 3000)
          } catch (e) {
            toast(e.message, true)
            b.disabled = false
          }
        }),
      )
    }

    body.append(
      actionGroup([
        s.controllable && {
          label: 'ターミナルの末尾を見る',
          icon: 'terminal',
          onClick: () => showPane(s),
        },
        {
          label: 'このプロジェクトのファイルを見る',
          icon: 'folder',
          onClick: () => {
            closeSheet()
            switchTab('files')
            loadFiles(s.cwd)
          },
        },
      ]),
    )

    if (s.controllable) {
      body.append(
        actionGroup([
          {
            // /exit は「停止中」に落ちるだけで再開できる。取り返しがつくので確認は挟まない
            label: '終了する（/exit を送る）',
            icon: 'power',
            async onClick(node) {
              node.classList.add('disabled')
              try {
                await postJson('/projects/api/session/exit', { id: s.id })
                toast(`${s.name} を終了しました。停止中から再開できます`)
                closeSheet()
                setTimeout(loadSessions, 2500)
              } catch (e) {
                toast(e.message, true)
                node.classList.remove('disabled')
              }
            },
          },
          // こちらは作業中でも問答無用で落ちるので、2 回押しで確定させる
          armed('強制終了（ペインごと落とす）', 'もう一度押すと落とします', async (node) => {
            node.classList.add('disabled')
            try {
              await postJson('/projects/api/session/kill', { id: s.id })
              toast('強制終了しました')
              closeSheet()
              loadSessions()
            } catch (e) {
              toast(e.message, true)
              node.classList.remove('disabled')
            }
          }),
        ]),
      )
    }
  })
}

async function showPane(s) {
  setBusy(true)
  try {
    const { text } = await api(`/projects/api/session/pane?id=${encodeURIComponent(s.id)}`)
    openSheet((body) => {
      sheetHeader(body, s.name, 'ターミナル末尾')
      body.append(el('pre', 'pane', text || '(空)'))
    })
  } catch (e) {
    toast(e.message, true)
  } finally {
    setBusy(false)
  }
}

function stoppedCard(s) {
  const card = el('button', 'card')
  const main = el('div', 'card-main')
  const top = el('div', 'card-top')
  top.append(el('div', 'card-name', s.name), el('div', 'card-time', ago(s.lastActivity)))
  main.append(top, el('div', 'card-path', s.display))
  card.append(main, icon('chevronRight', 'card-chevron'))
  card.addEventListener('click', () => openStoppedSheet(s))
  return card
}

function openStoppedSheet(s) {
  openSheet((body) => {
    sheetHeader(body, s.name, s.display)
    body.append(
      primaryButton('続きから再開して RC を張る', 'play', (b) =>
        start(b, { dir: s.cwd, title: s.name, resumeId: s.sessionId }),
      ),
    )
    body.append(
      actionGroup([
        {
          label: '新しいセッションで開く',
          icon: 'plus',
          onClick: (b) => start(b, { dir: s.cwd, title: s.name }),
        },
        {
          label: 'ファイルを見る',
          icon: 'folder',
          onClick: () => {
            closeSheet()
            switchTab('files')
            loadFiles(s.cwd)
          },
        },
      ]),
    )
  })
}

/**
 * 起動直後は Remote Control の URL がまだ出ていないので、
 * 出るまで裏で待って「Claude アプリで開く」を直リンクに差し替える。
 */
function renderStartResult(box, res) {
  box.replaceChildren()
  box.append(el('h2', null, `${res.title} を起動しました`))
  box.append(el('div', 'sub', `${res.display}　/　tmux: ${res.tmuxSession}`))

  const link = primaryLink('Claude の Code 一覧を開く', 'https://claude.ai/code')
  const status = el('p', 'note')
  status.append(spinner('inline'), el('span', null, 'Remote Control の準備中…'))
  box.append(link, status)
  box.classList.remove('hidden')

  let tries = 0
  const timer = setInterval(async () => {
    if (++tries > 20) {
      clearInterval(timer)
      status.replaceChildren(el('span', null, `Claude アプリの Code 一覧から「${res.title}」を選んでください`))
      return
    }
    try {
      const data = await api('/projects/api/sessions')
      const hit = data.live.find((s) => s.paneId === res.paneId && s.rcUrl)
      if (!hit) return
      clearInterval(timer)
      link.href = hit.rcUrl
      link.lastChild.textContent = 'Claude アプリでこのセッションを開く'
      status.replaceChildren(el('span', null, '準備できました'))
    } catch {
      /* ポーリング失敗は無視 */
    }
  }, 2000)
}

async function start(button, payload) {
  button.classList.add('disabled')
  try {
    await postJson('/projects/api/sessions', payload)
    toast('起動しました。RC が付くまで数秒かかります')
    closeSheet()
    switchTab('sessions')
    setTimeout(loadSessions, 3000)
  } catch (e) {
    toast(e.message, true)
    button.classList.remove('disabled')
  }
}

function skeletonCard() {
  const s = el('div', 'skeleton')
  s.append(el('span', 'sk sk-title'), el('span', 'sk sk-path'), el('span', 'sk sk-badge'))
  return s
}

function renderSessions(live) {
  const root = $('live-list')
  root.replaceChildren()

  let rest = live
  for (const g of GROUPS) {
    const mine = rest.filter(g.match)
    rest = rest.filter((s) => !g.match(s))
    if (mine.length === 0) continue

    const section = el('section')
    const title = el('h2', `group-title ${g.key}`)
    title.append(document.createTextNode(g.label), el('span', 'count', String(mine.length)))
    const list = el('div', 'list')
    list.append(...mine.map((s) => sessionCard(s, g.key === 'attention')))
    section.append(title, list)
    root.append(section)
  }
}

async function loadSessions() {
  if (firstSessionsLoad) $('live-list').replaceChildren(...[0, 1, 2].map(skeletonCard))
  setBusy(true)
  try {
    const data = await api('/projects/api/sessions')
    firstSessionsLoad = false
    renderSessions(data.live)
    $('live-empty').classList.toggle('hidden', data.live.length > 0)

    $('stopped-list').replaceChildren(...data.stopped.map(stoppedCard))
    $('stopped-count').textContent = String(data.stopped.length)
  } catch (e) {
    firstSessionsLoad = false
    $('live-list').replaceChildren()
    toast(e.message, true)
  } finally {
    setBusy(false)
  }
}

function schedulePoll() {
  clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (currentTab === 'sessions' && document.visibilityState === 'visible') loadSessions()
  }, 5000)
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentTab === 'sessions') loadSessions()
})

// ── 新規プロジェクト ─────────────────────────────────────────────────────────
let nameTimer = null
$('new-name').addEventListener('input', () => {
  clearTimeout(nameTimer)
  nameTimer = setTimeout(async () => {
    const name = $('new-name').value
    if (!name.trim()) return ($('new-path').textContent = '')
    try {
      const r = await api(`/projects/api/preview-name?name=${encodeURIComponent(name)}`)
      $('new-path').textContent = r.path ? `${r.path} に作ります` : ''
    } catch {
      /* 表示だけなので黙って諦める */
    }
  }, 250)
})

$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('new-submit')
  btn.disabled = true
  btn.textContent = '作成中…'
  setBusy(true)
  try {
    const res = await postJson('/projects/api/projects', {
      name: $('new-name').value,
      template: document.querySelector('input[name=tpl]:checked').value,
      initialPrompt: $('new-prompt').value,
    })
    renderStartResult($('new-result'), res)
    $('new-name').value = ''
    $('new-prompt').value = ''
    $('new-path').textContent = ''
    toast('起動しました')
  } catch (err) {
    toast(err.message, true)
  } finally {
    setBusy(false)
    btn.disabled = false
    btn.textContent = '作成して開始'
  }
})

// ── ファイル ────────────────────────────────────────────────────────────────
/** 「いまどこか」「どう戻るか」を常に出す。上へボタンより行き先が読める */
function renderCrumbs(abs, home) {
  const nav = $('crumbs')
  nav.replaceChildren()

  const rel = abs === home ? '' : abs.startsWith(`${home}/`) ? abs.slice(home.length + 1) : null
  const segments = rel === null ? abs.split('/').filter(Boolean) : ['~', ...(rel ? rel.split('/') : [])]

  let acc = rel === null ? '' : home
  segments.forEach((seg, i) => {
    if (i > 0) {
      acc = `${acc}/${seg}`
      nav.append(icon('chevronRight', 'sep'))
    }
    const path = acc
    const b = el('button', null, seg)
    if (i < segments.length - 1) b.addEventListener('click', () => loadFiles(path))
    else {
      b.disabled = true
      b.classList.add('here')
    }
    nav.append(b)
  })
}

async function loadFiles(p) {
  setBusy(true)
  try {
    const data = await api(`/projects/api/files?path=${encodeURIComponent(p)}&hidden=${filesState.hidden ? 1 : 0}`)
    filesState.path = data.path
    filesState.home = data.home
    renderCrumbs(data.path, data.home)
    $('file-zip').href = `/projects/api/zip?path=${encodeURIComponent(data.path)}`

    const rows = data.entries.map((entry) => {
      const row = el('button', 'row')
      row.append(icon(KIND_ICON[entry.kind] ?? 'doc', 'lead'))
      row.append(el('span', 'nm', entry.name))
      row.append(el('span', 'meta', entry.dir ? ago(entry.mtime) : `${size(entry.size)}・${ago(entry.mtime)}`))
      row.append(icon('chevronRight', 'trail'))
      const full = `${data.path.replace(/\/$/, '')}/${entry.name}`
      row.addEventListener('click', () => (entry.dir ? loadFiles(full) : openFile(full, entry)))
      return row
    })
    $('file-list').replaceChildren(...rows)
    if (rows.length === 0) $('file-list').append(emptyState('folder', '空のディレクトリです'))
  } catch (e) {
    toast(e.message, true)
  } finally {
    setBusy(false)
  }
}

function emptyState(iconName, text) {
  const box = el('div', 'empty')
  box.append(icon(iconName, 'big'), el('p', null, text))
  return box
}

function openFile(full, entry) {
  const url = `/projects/api/file?path=${encodeURIComponent(full)}`
  openSheet((body) => {
    sheetHeader(body, entry.name, `${size(entry.size)}　/　${ago(entry.mtime)}`)

    if (entry.kind === 'image') {
      const img = el('img', 'preview')
      img.src = url
      img.alt = entry.name
      img.loading = 'lazy'
      body.append(img)
    } else if (entry.kind === 'video') {
      const v = el('video', 'preview')
      v.src = url
      v.controls = true
      body.append(v)
    } else if (entry.kind === 'text' && entry.size < 512 * 1024) {
      const pre = el('pre', 'pane', '')
      const loading = el('p', 'note')
      loading.append(spinner('inline'), el('span', null, '読み込み中…'))
      body.append(loading, pre)
      fetch(url)
        .then((r) => r.text())
        .then((t) => {
          loading.remove()
          pre.textContent = t
        })
        .catch(() => {
          loading.remove()
          pre.textContent = '読めませんでした'
        })
    }

    body.append(
      actionGroup([
        { label: '別タブで開く', icon: 'external', href: url, external: true, trailing: 'chevronRight' },
        { label: 'ダウンロード', icon: 'download', href: `${url}&download=1`, trailing: 'chevronRight' },
      ]),
    )
  })
}

$('file-hidden').addEventListener('change', (e) => {
  filesState.hidden = e.target.checked
  loadFiles(filesState.path ?? '~')
})

$('file-upload').addEventListener('change', async (e) => {
  const files = [...e.target.files]
  if (files.length === 0) return
  const fd = new FormData()
  files.forEach((f, i) => fd.append(`f${i}`, f))
  toast(`${files.length} 件をアップロード中…`)
  setBusy(true)
  try {
    const r = await api(`/projects/api/upload?path=${encodeURIComponent(filesState.path)}`, { method: 'POST', body: fd })
    toast(`${r.saved.length} 件を置きました`)
    loadFiles(filesState.path)
  } catch (err) {
    toast(err.message, true)
  } finally {
    setBusy(false)
    e.target.value = ''
  }
})

async function loadJump() {
  try {
    const data = await api('/projects/api/sessions')
    const seen = new Set()
    const chips = [{ display: 'ホーム', cwd: null }]
    for (const s of [...data.live, ...data.stopped]) {
      if (seen.has(s.cwd)) continue
      seen.add(s.cwd)
      chips.push({ display: s.name, cwd: s.cwd })
      if (chips.length > 9) break
    }
    $('file-jump').replaceChildren(
      ...chips.map((c) => {
        const b = el('button', 'chip', c.display)
        b.addEventListener('click', () => loadFiles(c.cwd ?? '~'))
        return b
      }),
    )
  } catch {
    /* 補助機能なので失敗しても黙る */
  }
}

// ── sudo のパスワード ────────────────────────────────────────────────────────
// 勝手にシートを開かない。バナーを出すだけにして、開くのは必ず本人のタップから。
// 打鍵中に入力欄が割り込んで出てくる事故を無くすため。
let askpassId = null
let askpassSheetOpen = false

function renderAskpassBanner(pending) {
  const banner = $('askpass-banner')
  if (!pending) {
    askpassId = null
    banner.classList.add('hidden')
    if (askpassSheetOpen) {
      askpassSheetOpen = false
      closeSheet()
    }
    return
  }
  askpassId = pending.id
  $('askpass-banner-cmd').textContent = pending.cmd
  banner.classList.remove('hidden')
}

async function pollAskpass() {
  // ここはタブが裏でも回す。sudo が待っているのを取りこぼすと、
  // 向こう側は 150 秒で諦めてしまう（ブラウザ側のタイマー間引きは受け入れる）
  try {
    const { pending, secure } = await api('/projects/api/askpass/pending')
    renderAskpassBanner(pending)
    $('askpass-banner').classList.toggle('insecure', pending != null && !secure)
  } catch {
    /* 繋がらないときは黙る。次の周期で拾い直す */
  }
}

function openAskpassSheet(pending, secure) {
  askpassSheetOpen = true
  openSheet((body) => {
    body.append(el('h2', null, 'sudo のパスワードが要求されています'))
    body.append(el('div', 'sub', `${pending.cwd} で実行されます`))

    body.append(el('pre', 'pane cmd', pending.cmd))
    if (pending.detail.trim()) body.append(el('pre', 'pane', pending.detail.trim()))
    if (pending.attempt > 1) {
      body.append(el('p', 'note warn', `${pending.attempt} 回目です。前回のパスワードは違っていました`))
    }

    if (!secure) {
      body.append(
        el(
          'p',
          'note warn',
          'この接続は TLS ではありません。https:// の URL で開き直してください。パスワードは受け付けません。',
        ),
      )
      return
    }

    const field = el('input')
    field.type = 'password'
    field.autocomplete = 'current-password'
    field.name = 'sudo-password'
    field.placeholder = 'この PC のログインパスワード'
    field.className = 'password'
    body.append(field)

    const ok = el('button', 'primary-action disabled')
    ok.append(icon('power', 'lead'), el('span', null, '許可して実行'))
    body.append(ok)

    // 開いた直後の誤タップ避け。1 秒経ち、かつ何か入力されるまで押せない
    const armAt = Date.now() + 1000
    const sync = () => ok.classList.toggle('disabled', !field.value || Date.now() < armAt)
    field.addEventListener('input', sync)
    setTimeout(sync, 1050)

    const submit = async () => {
      if (ok.classList.contains('disabled')) return
      ok.classList.add('disabled')
      try {
        const res = await postJson('/projects/api/askpass/answer', { id: pending.id, password: field.value })
        field.value = ''
        if (!res.ok) throw new Error('この要求はもう有効ではありません')
        toast('送りました')
        askpassSheetOpen = false
        closeSheet()
        setTimeout(pollAskpass, 500)
      } catch (e) {
        toast(e.message, true)
        ok.classList.remove('disabled')
      }
    }
    ok.addEventListener('click', submit)
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
    })

    body.append(
      actionGroup([
        {
          label: '拒否する',
          icon: 'close',
          kind: 'danger',
          async onClick(node) {
            node.classList.add('disabled')
            await postJson('/projects/api/askpass/cancel', { id: pending.id }).catch(() => {})
            field.value = ''
            toast('拒否しました')
            askpassSheetOpen = false
            closeSheet()
            setTimeout(pollAskpass, 500)
          },
        },
      ]),
    )

    body.append(el('p', 'note', 'パスワードはこの PC のメモリ上だけを通り、記録されません。'))
  })
}

$('askpass-banner').addEventListener('click', async () => {
  try {
    const { pending, secure } = await api('/projects/api/askpass/pending')
    if (!pending) return renderAskpassBanner(null)
    openAskpassSheet(pending, secure)
  } catch (e) {
    toast(e.message, true)
  }
})

setInterval(pollAskpass, 3000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pollAskpass()
})

// ── 起動時のアイコン差し込み ─────────────────────────────────────────────────
$('refresh').replaceChildren(icon('refresh'))
$('refresh').addEventListener('click', () => {
  if (currentTab === 'sessions') loadSessions()
  else if (currentTab === 'files') loadFiles(filesState.path ?? '~')
})
$('sheet-close').replaceChildren(icon('close'))
$('live-empty').replaceChildren(icon('inbox', 'big'), el('p', null, '動いている Claude はありません'))
$('upload-label').prepend(icon('upload', 'lead'))
$('file-zip').prepend(icon('archive', 'lead'))
document.querySelector('.stopped .disclosure').replaceChildren(icon('chevronRight'))

document.querySelectorAll('.tabbar button').forEach((b) => {
  b.prepend(icon(b.dataset.icon))
  b.addEventListener('click', () => switchTab(b.dataset.tab))
})

switchTab('sessions')
schedulePoll()
loadJump()
pollAskpass()

// Embedded management retains the parent terminal connections and layout.
if (window.parent !== window) $('terminal-link').hidden = true
else { const token = new URLSearchParams(location.search).get('token'); if (token) $('terminal-link').href = '/?token=' + encodeURIComponent(token) }
