import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const root = 'D:/Codex/workspace/SOE analysis'
function findSourceWorkbook() {
  if (process.env.IFRS17_SOURCE_WORKBOOK) return process.env.IFRS17_SOURCE_WORKBOOK
  const materialDir = path.join(root, '素材')
  const stack = [materialDir]
  const candidates = []
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(fullPath)
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.xlsx')) {
        candidates.push({ path: fullPath, size: fs.statSync(fullPath).size })
      }
    }
  }
  if (candidates.length) {
    return candidates.sort((left, right) => right.size - left.size)[0].path
  }
  throw new Error('No source workbook found under 素材. Set IFRS17_SOURCE_WORKBOOK to override.')
}

const workbookPath = findSourceWorkbook()
const snapshotPath = path.join(root, 'public/data/lukang-workbook-snapshot.json')

function displayValue(value, formatted) {
  if (formatted !== undefined && formatted !== null && formatted !== '') return String(formatted)
  if (value === undefined || value === null) return ''
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    if (Math.abs(value) >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    return `${(value * 100).toFixed(2)}%`
  }
  return String(value)
}

const workbook = XLSX.readFile(workbookPath, {
  cellDates: true,
  cellFormula: true,
  cellNF: false,
  cellStyles: false,
})
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))

let updated = 0
for (const sheet of snapshot.sheets) {
  const workbookSheet = workbook.Sheets[sheet.name]
  if (!workbookSheet) continue
  for (const row of sheet.cells) {
    for (const cell of row) {
      const cached = workbookSheet[cell.address]
      if (!cached || !Object.prototype.hasOwnProperty.call(cached, 'v')) continue
      const value = cached.t === 'e' ? cached.w || `#${cached.v}` : cached.v
      const display = displayValue(value, cached.t === 'e' ? cached.w : cached.w)
      if (cell.value !== value || cell.display !== display) {
        cell.value = value
        cell.display = display
        updated += 1
      }
    }
  }
}

snapshot.cachedValuesHydratedAt = new Date().toISOString()
fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 0), 'utf8')
console.log(JSON.stringify({ snapshotPath, updated }, null, 2))
