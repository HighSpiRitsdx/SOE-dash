import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { HyperFormula } from 'hyperformula'

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
const outputPath = path.join(root, 'public/data/formula-validation-report.json')

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
const workbook = XLSX.readFile(workbookPath, {
  cellDates: true,
  cellFormula: true,
  cellNF: false,
  cellStyles: false,
})

function sheetToArray(sheet) {
  const decoded = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
  const rows = []
  for (let rowIndex = 0; rowIndex <= decoded.e.r; rowIndex += 1) {
    const row = []
    for (let colIndex = 0; colIndex <= decoded.e.c; colIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
      row.push(sheet[address]?.v ?? '')
    }
    rows.push(row)
  }
  return rows
}

function sheetOrder() {
  return snapshot.sheets.map((sheet) => sheet.name)
}

function expandThreeDSum(formula, order) {
  return formula.replace(/'([^']+):([^']+)'!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)/gi, (_match, startSheet, endSheet, addr) => {
    const start = order.indexOf(startSheet)
    const end = order.indexOf(endSheet)
    if (start < 0 || end < 0 || end < start) return 'SUM(0)'
    return order.slice(start, end + 1).map((sheet) => `'${sheet}'!${addr}`).join(',')
  })
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function quoteSheetRefs(formula, sheetNames) {
  let output = formula
  sheetNames
    .filter((name) => name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .sort((left, right) => right.length - left.length)
    .forEach((name) => {
      output = output.replace(new RegExp(`(?<!')${escapeRegExp(name)}!`, 'g'), `'${name}'!`)
    })
  return output
}

function sanitizeFormula(formula, order) {
  if (!formula || formula.includes('#REF!')) return ''
  if (formula.includes('[')) return ''
  let next = formula.replace(/\r?\n/g, '').replace(/\[[^\]]+\]/g, '')
  next = expandThreeDSum(next, order)
  next = quoteSheetRefs(next, order)
  return next
}

function templateArray(sheet, order) {
  return sheet.cells.map((row) =>
    row.map((cell) => {
      if (cell.formula) return sanitizeFormula(cell.formula, order) || cell.value || ''
      return cell.value ?? ''
    }),
  )
}

const outputSheetNames = new Set(
  snapshot.sheetGroups
    .filter((group) => !['source', 'reference'].includes(group.id))
    .flatMap((group) => group.sheets),
)

const engineSheets = {}
for (const sheet of snapshot.sheets) {
  engineSheets[sheet.name] = templateArray(sheet, sheetOrder())
}

for (const sheetName of workbook.SheetNames) {
  if (!outputSheetNames.has(sheetName)) {
    engineSheets[sheetName] = sheetToArray(workbook.Sheets[sheetName])
  }
}

function plain(value) {
  if (value && typeof value === 'object' && 'type' in value) return `#${value.type}`
  if (value && typeof value === 'object' && 'value' in value) return value.value
  return value ?? ''
}

function expectedValue(sheetName, address) {
  const sheet = workbook.Sheets[sheetName]
  const cell = sheet?.[address]
  if (!cell) return ''
  if (cell.t === 'e') return cell.w || `#${cell.v}`
  return cell.v ?? ''
}

function closeEnough(actual, expected) {
  if (actual === '' && expected === '') return true
  const a = Number(actual)
  const e = Number(expected)
  if (Number.isFinite(a) && Number.isFinite(e)) {
    const tolerance = Math.max(0.01, Math.abs(e) * 1e-8)
    return Math.abs(a - e) <= tolerance
  }
  return String(actual ?? '') === String(expected ?? '')
}

function isExpectedError(sheetName, address) {
  return workbook.Sheets[sheetName]?.[address]?.t === 'e'
}

const report = {
  workbook: workbookPath,
  generatedAt: new Date().toISOString(),
  comparedCells: 0,
  matchedCells: 0,
  mismatchedCells: 0,
  skippedCells: 0,
  bySheet: [],
  mismatches: [],
}

let engine
try {
  engine = HyperFormula.buildFromSheets(engineSheets, {
    licenseKey: 'gpl-v3',
    useStats: false,
    maxRows: 200000,
    maxColumns: 2000,
  })
} catch (error) {
  console.error('Failed to build HyperFormula engine:', error)
  process.exit(1)
}

for (const sheet of snapshot.sheets.filter((item) => outputSheetNames.has(item.name))) {
  const sheetId = engine.getSheetId(sheet.name)
  const sheetStats = {
    sheet: sheet.name,
    compared: 0,
    matched: 0,
    mismatched: 0,
    skipped: 0,
  }
  if (sheetId === undefined) continue

  for (let rowIndex = 0; rowIndex < sheet.cells.length; rowIndex += 1) {
    const row = sheet.cells[rowIndex]
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const cell = row[colIndex]
      if (!cell.formula || cell.formula.includes('#REF!')) {
        sheetStats.skipped += 1
        report.skippedCells += 1
        continue
      }
      if (isExpectedError(sheet.name, cell.address)) {
        sheetStats.skipped += 1
        report.skippedCells += 1
        continue
      }
      const actual = plain(engine.getCellValue({ sheet: sheetId, row: rowIndex, col: colIndex }))
      const expected = expectedValue(sheet.name, cell.address)
      sheetStats.compared += 1
      report.comparedCells += 1
      if (closeEnough(actual, expected)) {
        sheetStats.matched += 1
        report.matchedCells += 1
      } else {
        sheetStats.mismatched += 1
        report.mismatchedCells += 1
        if (report.mismatches.length < 300) {
          report.mismatches.push({
            sheet: sheet.name,
            address: cell.address,
            formula: cell.formula,
            actual,
            expected,
          })
        }
      }
    }
  }
  report.bySheet.push(sheetStats)
}

engine.destroy()
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({
  comparedCells: report.comparedCells,
  matchedCells: report.matchedCells,
  mismatchedCells: report.mismatchedCells,
  skippedCells: report.skippedCells,
  outputPath,
}, null, 2))
