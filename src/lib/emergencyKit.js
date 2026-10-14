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

export function buildEmergencyKitPdf({ recoveryKey, createdAt = new Date() }) {
  if (!recoveryKey) throw new Error('Clé de récupération manquante.')
  const date = createdAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  const keyLines = formatRecoveryKeyLines(recoveryKey)
  const boxTop = 590
  const boxHeight = 40 + keyLines.length * 30
  const commands = [
    '0.11 0.37 0.29 rg',
    textLine('F2', 24, MARGIN, 760, 'Kit de secours Clave'),
    '0.33 0.38 0.36 rg',
    textLine('F1', 11, MARGIN, 738, `Créé le ${date}`),
    '0.1 0.12 0.11 rg',
    textLine('F1', 12, MARGIN, 700, 'Cette clé permet de rouvrir votre coffre si vous oubliez le mot de passe maître.'),
    textLine('F1', 12, MARGIN, 682, 'Elle est indépendante du mot de passe : la changer ne l’invalide pas.'),
    textLine('F2', 12, MARGIN, 640, 'Clé de récupération'),
    '0.93 0.97 0.95 rg',
    `${MARGIN} ${boxTop - boxHeight} ${PAGE_WIDTH - MARGIN * 2} ${boxHeight} re f`,
    '0.66 0.81 0.76 RG 1 w',
    `${MARGIN} ${boxTop - boxHeight} ${PAGE_WIDTH - MARGIN * 2} ${boxHeight} re S`,
    '0.05 0.2 0.15 rg',
    ...keyLines.map((line, index) => textLine('F3', 20, MARGIN + 24, boxTop - 36 - index * 30, line)),
    '0.1 0.12 0.11 rg',
    textLine('F2', 12, MARGIN, 460, 'Comment l’utiliser'),
    textLine('F1', 11, MARGIN, 438, '1. Sur l’écran de déverrouillage de Clave, choisissez « Mot de passe oublié ? ».'),
    textLine('F1', 11, MARGIN, 420, '2. Saisissez la clé ci-dessus (tirets et majuscules facultatifs).'),
    textLine('F1', 11, MARGIN, 402, '3. Définissez un nouveau mot de passe maître.'),
    textLine('F2', 12, MARGIN, 360, 'Où la conserver'),
    textLine('F1', 11, MARGIN, 338, '• Imprimez cette page et rangez-la dans un endroit sûr (coffre, dossier personnel).'),
    textLine('F1', 11, MARGIN, 320, '• Ne l’enregistrez pas dans Clave, ni dans un e-mail ou un service en ligne.'),
    textLine('F1', 11, MARGIN, 302, '• Supprimez ce fichier PDF de l’ordinateur une fois imprimé.'),
    '0.71 0.19 0.15 rg',
    textLine('F2', 11, MARGIN, 250, 'Toute personne possédant cette clé peut ouvrir votre coffre.'),
    '0.45 0.5 0.48 rg',
    textLine('F1', 9, MARGIN, 60, 'Clave · coffre local de mots de passe · générer un nouveau kit invalide celui-ci.'),
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
