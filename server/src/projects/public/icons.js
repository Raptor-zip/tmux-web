/*
 * 24x24 のグリッドに、線幅 1.75・端と角は丸で描いたアイコン。
 * 記号文字（⟳ ▤ ▸ など）はフォント任せで環境ごとに形も太さも変わり、
 * 出ない端末では豆腐になるので、すべて SVG に置き換えている。
 */

const P = {
  // ナビゲーション
  sessions: [
    'M3.25 6.5A2.25 2.25 0 0 1 5.5 4.25h13A2.25 2.25 0 0 1 20.75 6.5v11a2.25 2.25 0 0 1-2.25 2.25h-13A2.25 2.25 0 0 1 3.25 17.5z',
    'M7.5 9.75 10.25 12 7.5 14.25',
    'M12.75 15h4',
  ],
  plus: ['M12 5.25v13.5', 'M5.25 12h13.5'],
  folder: [
    'M3.25 7.25A2 2 0 0 1 5.25 5.25h3.19a2 2 0 0 1 1.53.71l1.28 1.54h7.5a2 2 0 0 1 2 2v8.25a2 2 0 0 1-2 2H5.25a2 2 0 0 1-2-2z',
  ],

  // 操作
  close: ['M6.75 6.75 17.25 17.25', 'M17.25 6.75 6.75 17.25'],
  // 円弧の終点にちょうど矢じりが乗るよう、頂点を弧の端点 (17.66, 6.34) に合わせてある
  refresh: ['M20 12a8 8 0 1 1-2.34-5.66', 'M17.1 3.2 17.66 6.34 14.5 5.8'],
  chevronRight: ['M9.75 5.75 16 12l-6.25 6.25'],
  chevronDown: ['M5.75 9.75 12 16l6.25-6.25'],
  upload: ['M12 15.75V4.5', 'M8.25 8.25 12 4.5l3.75 3.75', 'M4.75 14.75v3.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2v-3.5'],
  download: ['M12 4.5v11.25', 'M8.25 12 12 15.75 15.75 12', 'M4.75 14.75v3.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2v-3.5'],
  external: ['M14 4.75h5.25V10', 'M19.25 4.75 11.5 12.5', 'M18 13.75v4.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5'],
  terminal: [
    'M3.25 6.5A2.25 2.25 0 0 1 5.5 4.25h13A2.25 2.25 0 0 1 20.75 6.5v11a2.25 2.25 0 0 1-2.25 2.25h-13A2.25 2.25 0 0 1 3.25 17.5z',
    'M7.5 9.75 10.25 12 7.5 14.25',
    'M12.75 15h4',
  ],
  power: ['M12 3.75v8', 'M7.4 7a7 7 0 1 0 9.2 0'],
  bolt: ['M13.25 3.5 5.75 13.25h5L10.75 20.5l7.5-9.75h-5z'],
  broadcast: ['M8.6 15.4a4.8 4.8 0 0 1 0-6.8', 'M15.4 8.6a4.8 4.8 0 0 1 0 6.8', 'M5.6 18.4a9 9 0 0 1 0-12.8', 'M18.4 5.6a9 9 0 0 1 0 12.8'],
  play: [{ d: 'M8.5 5.6a.9.9 0 0 1 1.36-.78l8.4 5.4a.9.9 0 0 1 0 1.56l-8.4 5.4a.9.9 0 0 1-1.36-.78z', fill: true }],

  // ファイルの種類
  doc: ['M6.25 4.25h7L18 9v10.75H6.25z', 'M12.75 4.25V9.5h5'],
  docText: ['M6.25 4.25h7L18 9v10.75H6.25z', 'M12.75 4.25V9.5h5', 'M9 13h6', 'M9 16h4'],
  photo: [
    'M3.75 6.25A2 2 0 0 1 5.75 4.25h12.5a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z',
    'M8.75 11a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
    'M3.75 16.25 9 11.75l3.75 3.25 3-2.5 4.5 4',
  ],
  film: [
    'M3.75 6.25A2 2 0 0 1 5.75 4.25h12.5a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z',
    'M8.25 4.25v15.5',
    'M15.75 4.25v15.5',
    'M3.75 12h16.5',
  ],
  wave: ['M4 11v2', 'M7.5 8.5v7', 'M11 5.5v13', 'M14.5 9v6', 'M18 7v10', 'M21 11v2'],
  archive: ['M3.5 7.75h17v10.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z', 'M2.75 4.25h18.5v3.5H2.75z', 'M10 11.5h4'],

  // 状態
  spinner: ['M20.5 12a8.5 8.5 0 0 0-8.5-8.5'],
  inbox: [
    'M3.5 12.5 6 5.75a2 2 0 0 1 1.87-1.3h8.26A2 2 0 0 1 18 5.75l2.5 6.75',
    'M3.5 12.5h4.25l1.25 2.5h6l1.25-2.5h4.25v5.25a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z',
  ],
}

/** 名前から SVG 要素を作る。色は currentColor に従うので、親の color だけ変えればよい。 */
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('icon')
  if (cls) svg.classList.add(...cls.split(' '))
  for (const item of P[name] ?? P.doc) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    if (typeof item === 'string') {
      path.setAttribute('d', item)
    } else {
      path.setAttribute('d', item.d)
      if (item.fill) {
        path.setAttribute('fill', 'currentColor')
        path.setAttribute('stroke', 'none')
      }
    }
    svg.append(path)
  }
  return svg
}

/** 回り続ける読み込み表示。薄い輪と、その上を走る弧の 2 枚重ね。 */
export function spinner(cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('icon', 'spinner')
  if (cls) svg.classList.add(...cls.split(' '))

  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  ring.setAttribute('cx', '12')
  ring.setAttribute('cy', '12')
  ring.setAttribute('r', '8.5')
  ring.setAttribute('opacity', '0.22')

  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  arc.setAttribute('d', P.spinner[0])

  svg.append(ring, arc)
  return svg
}

/** ファイルの種類 → アイコン名 */
export const KIND_ICON = {
  dir: 'folder',
  text: 'docText',
  image: 'photo',
  pdf: 'docText',
  video: 'film',
  audio: 'wave',
  archive: 'archive',
  binary: 'doc',
}
