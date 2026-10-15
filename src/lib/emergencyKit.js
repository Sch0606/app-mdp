// Génère le kit de secours au format PDF, sans dépendance : une page A4,
// polices standard PDF (Helvetica, Courier) en encodage WinAnsi.

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 56

const WIN_ANSI_EXTRAS = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, ' ': 0x20, ' ': 0x20,
}

function toWinAnsi(text) {
  let output = ''
  for (const character of String(text)) {
    const code = character.codePointAt(0)
    if (WIN_ANSI_EXTRAS[character] != null) output += String.fromCharCode(WIN_ANSI_EXTRAS[character])
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) output += character
    else output += '?'
  }
  return output
}

function pdfString(text) {
  return `(${toWinAnsi(text).replace(/[\\()]/g, (match) => `\\${match}`)})`
}

function textLine(font, size, x, y, text) {
  return `BT /${font} ${size} Tf ${x} ${y} Td ${pdfString(text)} Tj ET`
}

export function formatRecoveryKeyLines(recoveryKey) {
  const groups = String(recoveryKey).split('-').filter(Boolean)
  const half = Math.ceil(groups.length / 2)
  return [groups.slice(0, half).join('-'), groups.slice(half).join('-')].filter(Boolean)
}

// Rectangle aux coins arrondis (courbes de Bézier), à remplir (f) ou tracer (S).
function roundedRect(x, y, width, height, radius, operator) {
  const k = radius * 0.5523
  return [
    `${x + radius} ${y} m`,
    `${x + width - radius} ${y} l`,
    `${x + width - radius + k} ${y} ${x + width} ${y + radius - k} ${x + width} ${y + radius} c`,
    `${x + width} ${y + height - radius} l`,
    `${x + width} ${y + height - radius + k} ${x + width - radius + k} ${y + height} ${x + width - radius} ${y + height} c`,
    `${x + radius} ${y + height} l`,
    `${x + radius - k} ${y + height} ${x} ${y + height - radius + k} ${x} ${y + height - radius} c`,
    `${x} ${y + radius} l`,
    `${x} ${y + radius - k} ${x + radius - k} ${y} ${x + radius} ${y} c`,
    operator,
  ].join(' ')
}

const COLORS = {
  accent: '0.086 0.298 0.243',
  accentSoft: '0.93 0.97 0.95',
  accentLine: '0.66 0.81 0.76',
  mint: '0.45 0.88 0.75',
  ink: '0.1 0.12 0.11',
  muted: '0.4 0.45 0.43',
  danger: '0.71 0.19 0.15',
  dangerSoft: '0.99 0.94 0.93',
  white: '1 1 1',
}

export function buildEmergencyKitPdf({ recoveryKey, createdAt = new Date() }) {
  if (!recoveryKey) throw new Error('Clé de récupération manquante.')
  const date = createdAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const keyLines = formatRecoveryKeyLines(recoveryKey)
  const contentWidth = PAGE_WIDTH - MARGIN * 2

  const keyBoxHeight = 56 + keyLines.length * 30
  const keyBoxTop = 628
  const keyBoxBottom = keyBoxTop - keyBoxHeight

  const steps = [
    'Sur l’écran de déverrouillage de Clave, cliquez sur « Mot de passe oublié ? ».',
    'Saisissez la clé ci-dessus. Les tirets et les majuscules sont facultatifs.',
    'Choisissez un nouveau mot de passe maître : vos données restent intactes.',
  ]
  const stepsTop = keyBoxBottom - 46
  const tips = [
    'Imprimez cette page et rangez-la avec vos documents importants.',
    'Ne la conservez ni dans Clave, ni dans un e-mail, ni dans un cloud.',
    'Une fois imprimé, supprimez ce PDF de votre ordinateur.',
  ]
  const tipsTop = stepsTop - steps.length * 30 - 40
  const warningTop = tipsTop - tips.length * 20 - 24
  const warningHeight = 52

  const commands = [
    // En-tête
    `${COLORS.accent} rg`,
    `0 ${PAGE_HEIGHT - 128} ${PAGE_WIDTH} 128 re f`,
    `${COLORS.mint} rg`,
    `0 ${PAGE_HEIGHT - 132} ${PAGE_WIDTH} 4 re f`,
    textLine('F2', 10, MARGIN, PAGE_HEIGHT - 52, 'CLAVE'),
    `${COLORS.white} rg`,
    textLine('F2', 26, MARGIN, PAGE_HEIGHT - 86, 'Kit de secours'),
    `${COLORS.mint} rg`,
    textLine('F1', 11, MARGIN, PAGE_HEIGHT - 108, `Créé le ${date} · Document confidentiel`),

    // Introduction
    `${COLORS.ink} rg`,
    textLine('F1', 12, MARGIN, 670, 'Mot de passe maître oublié ? Cette clé vous permet de rouvrir votre coffre.'),
    `${COLORS.muted} rg`,
    textLine('F1', 11, MARGIN, 652, 'Elle ne dépend pas de votre mot de passe : le changer ne la rend pas invalide.'),

    // Clé de récupération
    `${COLORS.accentSoft} rg`,
    roundedRect(MARGIN, keyBoxBottom, contentWidth, keyBoxHeight, 10, 'f'),
    `${COLORS.accentLine} RG 1 w`,
    roundedRect(MARGIN, keyBoxBottom, contentWidth, keyBoxHeight, 10, 'S'),
    `${COLORS.accent} rg`,
    roundedRect(MARGIN, keyBoxBottom, 6, keyBoxHeight, 3, 'f'),
    textLine('F2', 9, MARGIN + 26, keyBoxTop - 24, 'CLÉ DE RÉCUPÉRATION'),
    `${COLORS.ink} rg`,
    ...keyLines.map((line, index) => textLine('F3', 21, MARGIN + 26, keyBoxTop - 56 - index * 30, line)),

    // Étapes
    `${COLORS.accent} rg`,
    textLine('F2', 13, MARGIN, stepsTop, 'Retrouver l’accès à votre coffre'),
    ...steps.flatMap((step, index) => {
      const y = stepsTop - 30 - index * 30
      return [
        `${COLORS.accent} rg`,
        roundedRect(MARGIN, y - 6, 20, 20, 10, 'f'),
        `${COLORS.white} rg`,
        textLine('F2', 11, MARGIN + 7, y, String(index + 1)),
        `${COLORS.ink} rg`,
        textLine('F1', 11, MARGIN + 32, y, step),
      ]
    }),

    // Conseils de conservation
    `${COLORS.accent} rg`,
    textLine('F2', 13, MARGIN, tipsTop, 'Bien la conserver'),
    ...tips.flatMap((tip, index) => {
      const y = tipsTop - 24 - index * 20
      return [
        `${COLORS.mint} rg`,
        `${MARGIN + 6} ${y + 2} 5 5 re f`,
        `${COLORS.ink} rg`,
        textLine('F1', 11, MARGIN + 22, y, tip),
      ]
    }),

    // Avertissement
    `${COLORS.dangerSoft} rg`,
    roundedRect(MARGIN, warningTop - warningHeight, contentWidth, warningHeight, 8, 'f'),
    `${COLORS.danger} rg`,
    roundedRect(MARGIN, warningTop - warningHeight, 6, warningHeight, 3, 'f'),
    textLine('F2', 11, MARGIN + 22, warningTop - 22, 'Gardez cette clé secrète.'),
    textLine('F1', 10, MARGIN + 22, warningTop - 38, 'Toute personne qui la possède peut ouvrir votre coffre et lire vos mots de passe.'),

    // Pied de page
    `${COLORS.accentLine} RG 0.5 w`,
    `${MARGIN} 78 m ${PAGE_WIDTH - MARGIN} 78 l S`,
    `${COLORS.muted} rg`,
    textLine('F1', 9, MARGIN, 60, 'Clave · gestionnaire de mots de passe local'),
    textLine('F1', 9, PAGE_WIDTH - MARGIN - 181, 60, 'Générer un nouveau kit rend celui-ci invalide.'),
  ]
  const stream = commands.join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]

  // Chaque caractère vaut un octet (WinAnsi) : la longueur de la chaîne est la position en octets.
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  const bytes = new Uint8Array(pdf.length)
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff
  return bytes
}

export function downloadEmergencyKit(recoveryKey) {
  const blob = new Blob([buildEmergencyKitPdf({ recoveryKey })], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `clave-kit-de-secours-${new Date().toISOString().slice(0, 10)}.pdf`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
