import test from 'node:test'
import assert from 'node:assert/strict'
import { collectTags, filterEntries, normalizeTags } from '../../src/lib/security.js'
import { buildEmergencyKitPdf, formatRecoveryKeyLines } from '../../src/lib/emergencyKit.js'

const entries = [
  { plateforme: 'Banque Pop', email: 'moi', site: '', tags: ['banque', 'finances'], favorite: false },
  { plateforme: 'GitLab', email: 'dev', site: 'https://gitlab.com', tags: ['travail'], favorite: true },
  { plateforme: 'Impots', email: 'moi', site: '', tags: ['finances'], favorite: false },
]

test('normalizeTags suit les règles du coffre Rust', () => {
  assert.deepEqual(normalizeTags(['#Banque', ' travail ', 'banque', '  ', 'carte bleue']), ['banque', 'travail', 'carte-bleue'])
  assert.equal(normalizeTags(['x'.repeat(50)])[0].length, 32)
  assert.equal(normalizeTags(Array.from({ length: 20 }, (_, index) => `t${index}`)).length, 12)
})

test('collectTags trie par fréquence puis par nom', () => {
  assert.deepEqual(collectTags(entries), ['finances', 'banque', 'travail'])
})

test('filterEntries gère #étiquette, le texte et le filtre rapide tag:', () => {
  assert.deepEqual(filterEntries(entries, '#fin').map((entry) => entry.plateforme), ['Banque Pop', 'Impots'])
  assert.deepEqual(filterEntries(entries, '#fin banque').map((entry) => entry.plateforme), ['Banque Pop'])
  assert.deepEqual(filterEntries(entries, 'travail').map((entry) => entry.plateforme), ['GitLab'])
  assert.deepEqual(filterEntries(entries, '', 'tag:banque').map((entry) => entry.plateforme), ['Banque Pop'])
  assert.deepEqual(filterEntries([{ plateforme: 'Sans tags' }], '#x'), [])
})

test('le kit de secours est un PDF valide contenant la clé', () => {
  const key = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567'
  assert.deepEqual(formatRecoveryKeyLines(key), ['ABCD-EFGH-IJKL-MNOP', 'QRST-UVWX-YZ23-4567'])

  const bytes = buildEmergencyKitPdf({ recoveryKey: key, createdAt: new Date('2026-10-14T10:00:00Z') })
  const text = Buffer.from(bytes).toString('latin1')
  assert.ok(text.startsWith('%PDF-1.4'))
  assert.ok(text.trimEnd().endsWith('%%EOF'))
  assert.ok(text.includes('(ABCD-EFGH-IJKL-MNOP)'))
  assert.ok(text.includes('(QRST-UVWX-YZ23-4567)'))
  // Accents encodés en WinAnsi sur un octet.
  assert.ok(text.includes('Cr\xe9\xe9 le'))

  // Table xref : chaque décalage pointe bien sur « N 0 obj ».
  const startxref = Number(text.match(/startxref\n(\d+)/)[1])
  assert.equal(text.slice(startxref, startxref + 4), 'xref')
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]))
  assert.equal(offsets.length, 7)
  offsets.forEach((offset, index) => assert.equal(text.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`))

  const length = Number(text.match(/\/Length (\d+) >>\nstream\n/)[1])
  const streamStart = text.indexOf('stream\n') + 'stream\n'.length
  assert.equal(text.slice(streamStart + length, streamStart + length + '\nendstream'.length), '\nendstream')
})

test('le kit refuse une clé vide', () => {
  assert.throws(() => buildEmergencyKitPdf({ recoveryKey: '' }))
})
