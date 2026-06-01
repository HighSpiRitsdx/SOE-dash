import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const root = 'D:/Codex/workspace/SOE analysis'
const inputPath = path.join(root, 'public/data/ifrs17-upload-source-sample.csv')
const outputPath = path.join(root, 'public/data/ifrs17-default-demo-source.csv')
const scaleFactor = 2.5

function parseJsonValue(value) {
  try {
    return JSON.parse(String(value ?? ''))
  } catch {
    return value
  }
}

function looksLikePeriodOrDate(display, value) {
  const text = String(display ?? '').trim()
  if (!/^\d{4,8}$/.test(text)) return false
  if (!Number.isInteger(value)) return false
  return value >= 1900
}

function shouldScale(value, display) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const text = String(display ?? '').trim()
  if (!text || text.includes('#')) return false
  if (/^-?[\d,.]+(?:\.\d+)?%$/.test(text)) return false
  if (looksLikePeriodOrDate(text, value)) return false
  return true
}

function formatScaledValue(value, originalDisplay) {
  const scaled = value / scaleFactor
  const text = String(originalDisplay ?? '').trim()
  const hasParens = /^\(.+\)$/.test(text)
  const decimals = Math.min(Math.max((text.split('.')[1] || '').replace(/[^\d]/g, '').length, 0), 6)
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, 2),
  }).format(Math.abs(scaled))
  return hasParens || scaled < 0 ? `(${formatted})` : formatted
}

const sourceCsv = fs.readFileSync(inputPath, 'utf8')
const workbook = XLSX.read(sourceCsv, { type: 'string', raw: false })
const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' })
const header = rows[0].map((cell) => String(cell))
const valueIndex = header.indexOf('valueJson')
const displayIndex = header.indexOf('display')
if (valueIndex < 0 || displayIndex < 0) throw new Error('Unexpected snapshot CSV format.')

const scaledRows = rows.map((row, rowIndex) => {
  if (rowIndex === 0) return row
  const next = [...row]
  const parsedValue = parseJsonValue(row[valueIndex])
  if (shouldScale(parsedValue, row[displayIndex])) {
    const scaled = parsedValue / scaleFactor
    next[valueIndex] = JSON.stringify(scaled)
    next[displayIndex] = formatScaledValue(parsedValue, row[displayIndex])
  }
  return next
})

const outputSheet = XLSX.utils.aoa_to_sheet(scaledRows)
const csv = XLSX.utils.sheet_to_csv(outputSheet)
fs.writeFileSync(outputPath, csv, 'utf8')
console.log(JSON.stringify({ inputPath, outputPath, rows: scaledRows.length, scaleFactor }, null, 2))
