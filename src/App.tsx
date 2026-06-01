import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BookOpen,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  LayoutDashboard,
  Search,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { HyperFormula } from 'hyperformula'
import './App.css'

type CellSnapshot = {
  address: string
  value: unknown
  display: string
  formula: string
}

type SheetSnapshot = {
  name: string
  category: string
  rowCount: number
  columnCount: number
  displayedRows: number
  displayedColumns: number
  formulaCountInSnapshot: number
  sourceRefs: string[]
  cells: CellSnapshot[][]
}

type SheetGroup = {
  id: string
  label: string
  sheets: string[]
}

type ReportSection = {
  id: string
  title: string
  sheet: string
  question: string
  commentHint: string
}

type WorkbookSnapshot = {
  workbookFile: string
  generatedAt: string
  sheetGroups: SheetGroup[]
  reportSections: ReportSection[]
  sheets: SheetSnapshot[]
  notes: string[]
}

type Mode = 'dashboard' | 'workbook' | 'report'

type FilterKey = 'measurementModel' | 'origOrReins' | 'account' | 'channel'
type FilterState = Record<FilterKey, string>
type ApprovedResult = {
  id: string
  period: string
  approvedAt: string
  kpis: Array<{ label: string; value: string }>
}

const defaultSnapshotPath = '/data/lukang-workbook-snapshot.json'
const defaultRealSourcePath = 'D:\\Codex\\workspace\\SOE analysis\\public\\data\\ifrs17-upload-source-sample.csv'
const defaultDemoSourcePath = '/data/ifrs17-default-demo-source.csv'
const maxUploadRows = 120
const maxUploadCols = 36

const amountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const percentFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
  style: 'percent',
})

const tablePercentFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
  style: 'percent',
})

function formatWanAmount(value: unknown, withUnit = false) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[(),]/g, ''))
  if (!Number.isFinite(number)) return String(value ?? '-')
  const formatted = amountFormatter.format(number / 100)
  return withUnit ? `${formatted} 百万元` : formatted
}

function formatChartAmount(value: unknown) {
  return formatWanAmount(value)
}

function formatTooltipAmount(value: unknown) {
  return formatWanAmount(value, true)
}

function parseDisplayNumber(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '-' || raw === '-   ' || raw.includes('#REF!') || /^NA$/i.test(raw)) {
    return { raw, number: undefined as number | undefined, isPercent: false }
  }
  const isPercent = raw.endsWith('%')
  const isParenthesized = /^\(.+\)$/.test(raw)
  const numericText = raw.replace(/[(),%]/g, '')
  const parsed = Number(numericText)
  if (!Number.isFinite(parsed)) return { raw, number: undefined as number | undefined, isPercent }
  return {
    raw,
    number: isParenthesized ? -parsed : parsed,
    isPercent,
  }
}

function formatTableAmount(value: unknown, unit: 'wan' | 'yuan' | 'auto' = 'wan') {
  const parsed = parseDisplayNumber(value)
  if (parsed.number === undefined) return parsed.raw || ''
  const divisor = unit === 'yuan' || (unit === 'auto' && Math.abs(parsed.number) >= 1_000_000) ? 1_000_000 : 100
  const amount = parsed.number / divisor
  const formatted = amountFormatter.format(Math.abs(amount))
  return amount < 0 ? `(${formatted})` : formatted
}

function formatTablePercent(value: unknown) {
  const parsed = parseDisplayNumber(value)
  if (parsed.number === undefined) return parsed.raw || ''
  const ratio = parsed.isPercent ? parsed.number / 100 : parsed.number
  return tablePercentFormatter.format(ratio)
}

function formatStructuredCell(
  value: unknown,
  header = '',
  unit: 'wan' | 'yuan' | 'auto' | 'none' = 'wan',
  isNumberColumn = true,
) {
  const text = String(value ?? '').trim()
  if (!text || !isNumberColumn) return normalizeCurrentPeriodLabel(text)
  const normalizedHeader = compactText(header)
  const parsed = parseDisplayNumber(text)
  if (parsed.number === undefined) return normalizeCurrentPeriodLabel(text)
  if (parsed.isPercent || /率|比例|ratio|Rate/i.test(normalizedHeader)) return formatTablePercent(text)
  if (unit === 'none') return text
  return formatTableAmount(text, unit)
}

function normalizeCurrentPeriodLabel(value: string) {
  return /^\d{4,8}$/.test(compactText(value)) || /202502|2502|20250228/.test(value) ? '20251231' : value
}

const reportPhraseLibrary = [
  '本期结果整体与预期方向一致，主要变动来自 {driver}。',
  '保险服务业绩主要受 CSM 释放、RA 释放及经验偏差共同影响。',
  '投资收益可以覆盖保险金融负债成本，投资服务业绩为正向贡献。',
  '首日亏损较对比期间有所收窄，主要由新单结构和折现率假设变化驱动。',
  '对比期间存在 REF 或 hard code，待后续累计多期数据源后补齐趋势分析。',
]

const sensitiveTextPatterns: Array<[RegExp, string]> = [
  [/\u9646\u5bb6\u5634\u56fd\u6cf0/g, '某寿险公司'],
  [/\u540c\u65b9\u5168\u7403/g, '目标寿险公司'],
  [/\u540c\u65b9/g, '目标公司'],
  [/\u4e2d\u65b9/g, '客户项目'],
  [/[^\s",:：{}[\]]*(?:终身寿险|年金保险|两全保险|医疗保险|重大疾病保险)[^",:：{}[\]]*/g, '产品'],
]

function sanitizeText(value: string) {
  return sensitiveTextPatterns.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function sanitizeValue(value: unknown): unknown {
  return typeof value === 'string' ? sanitizeText(value) : value
}

function sanitizeCell(cell: CellSnapshot): CellSnapshot {
  return {
    ...cell,
    value: sanitizeValue(cell.value),
    display: sanitizeText(cell.display || ''),
  }
}

function sanitizeSnapshot(snapshot: WorkbookSnapshot): WorkbookSnapshot {
  return {
    ...snapshot,
    workbookFile: sanitizeText(snapshot.workbookFile.split(/[\\/]/).at(-1) || snapshot.workbookFile),
    sheets: snapshot.sheets.map((sheet) => ({
      ...sheet,
      cells: sheet.cells.map((row) => row.map(sanitizeCell)),
    })),
    notes: snapshot.notes.map(sanitizeText),
  }
}

function looksNumericDisplay(value: string) {
  const text = value.trim()
  if (!text || text.includes('#REF!')) return false
  if (text === '-' || text === '-   ') return true
  return /^-?\(?[\d,]+(?:\.\d+)?\)?%?$/.test(text)
}

function zeroCell(cell: CellSnapshot): CellSnapshot {
  const shouldZero = typeof cell.value === 'number' || looksNumericDisplay(cell.display)
  return shouldZero
    ? {
        ...cell,
        value: 0,
        display: '0',
      }
    : {
        ...cell,
        value: sanitizeValue(cell.value),
        display: sanitizeText(cell.display || ''),
      }
}

function zeroSnapshot(template: WorkbookSnapshot): WorkbookSnapshot {
  return {
    ...template,
    workbookFile: '',
    generatedAt: new Date().toISOString().slice(0, 10),
    sheets: template.sheets
      .filter((sheet) => !['source', 'reference'].includes(sheet.category))
      .map((sheet) => ({
        ...sheet,
        cells: sheet.cells.map((row) => row.map(zeroCell)),
      })),
    notes: ['当前尚未加载数据源，页面展示 0 值模板。'],
  }
}

const kpmgColor = {
  navy: '#00338D',
  blue: '#1E49E2',
  purple: '#6D2EFF',
  violet: '#8A3FFC',
  magenta: '#E6007E',
  slate: '#64748B',
  grid: '#D9E2EC',
}

const chartPalette = [kpmgColor.navy, kpmgColor.blue, kpmgColor.purple, kpmgColor.violet, kpmgColor.magenta, kpmgColor.slate]
const accountSegmentLabels = ['传统', '分红1', '分红2', '万能', '投连', '短险', '再保']
const accountColorMap: Record<string, string> = {
  传统: kpmgColor.navy,
  分红1: kpmgColor.blue,
  分红2: kpmgColor.purple,
  万能: '#00A3A1',
  投连: kpmgColor.magenta,
  短险: kpmgColor.slate,
  再保: '#00A3A1',
}

type PieLabelDatum = {
  name: string
  value: number
  labelText?: string
  color?: string
}

const filterDefinitions: Array<{
  key: FilterKey
  label: string
  note: string
  options: Array<{ value: string; label: string; code: string }>
}> = [
  {
    key: 'measurementModel',
    label: '计量模型',
    note: 'group_id / 辅助列：计量方法',
    options: [
      { value: 'BBA', label: 'BBA', code: '1' },
      { value: 'MBBA', label: 'MBBA', code: '2' },
      { value: 'VFA', label: 'VFA', code: '3' },
      { value: 'PAA', label: 'PAA', code: '4' },
    ],
  },
  {
    key: 'origOrReins',
    label: '直保 / 再保',
    note: 'group_id / 辅助列：直保再保',
    options: [
      { value: 'direct', label: '直保', code: '1' },
      { value: 'reinsurance', label: '再保', code: '2' },
    ],
  },
  {
    key: 'account',
    label: '账户',
    note: '由 M1/M2 tab 与 POC 账户位推理',
    options: [
      { value: 'traditional', label: '传统', code: '1' },
      { value: 'par1', label: '分红1', code: '2' },
      { value: 'par2', label: '分红2', code: '3' },
      { value: 'universal', label: '万能', code: '4' },
      { value: 'unitLinked', label: '投连', code: '5' },
      { value: 'shortTerm', label: '短险', code: '6' },
    ],
  },
  {
    key: 'channel',
    label: '渠道',
    note: '当前样例维度较少；后续按客户 input 展开',
    options: [
      { value: 'agent', label: '代理人', code: 'AG' },
      { value: 'banc', label: '银保', code: 'BA' },
      { value: 'broker', label: '经代', code: 'BR' },
      { value: 'internet', label: '互联网', code: 'IN' },
    ],
  },
]

const initialFilters: FilterState = {
  measurementModel: '',
  origOrReins: '',
  account: '',
  channel: '',
}

function normalizeFilters(filters: FilterState): FilterState {
  return filters.origOrReins === 'reinsurance'
    ? { ...filters, account: '' }
    : filters
}

type RawSheet = unknown[][]
type RawWorkbook = Record<string, RawSheet>

function splitFormulaArgs(text: string) {
  const args: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') inString = !inString
    if (!inString && char === '(') depth += 1
    if (!inString && char === ')') depth -= 1
    if (!inString && char === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) args.push(current.trim())
  return args
}

function colToIndex(col: string) {
  return col
    .replace(/\$/g, '')
    .split('')
    .reduce((sum, char) => sum * 26 + char.toUpperCase().charCodeAt(0) - 64, 0) - 1
}

function parseCellRef(ref: string) {
  const match = ref.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/i)
  if (!match) return undefined
  return { row: Number(match[2]) - 1, col: colToIndex(match[1]) }
}

function parseSheetRef(ref: string, currentSheet: string) {
  const trimmed = ref.trim()
  const quoted = trimmed.match(/^'([^']+)'!(.+)$/)
  if (quoted) return { sheet: quoted[1], addr: quoted[2] }
  const bare = trimmed.match(/^([^!]+)!(.+)$/)
  if (bare) return { sheet: bare[1], addr: bare[2] }
  return { sheet: currentSheet, addr: trimmed }
}

function normalizeSheetName(name: string) {
  return name.replace(/^'|'$/g, '').trim()
}

function rawCell(raw: RawWorkbook, sheet: string, addr: string) {
  const parsed = parseCellRef(addr)
  if (!parsed) return ''
  const rows = raw[normalizeSheetName(sheet)]
  return rows?.[parsed.row]?.[parsed.col] ?? ''
}

function rangeValues(raw: RawWorkbook, currentSheet: string, rangeRef: string) {
  const { sheet, addr } = parseSheetRef(rangeRef, currentSheet)
  const rows = raw[normalizeSheetName(sheet)] || []
  const [startRaw, endRaw = startRaw] = addr.split(':')
  const start = parseCellRef(startRaw)
  const end = parseCellRef(endRaw)
  if (!start || !end) return []
  const values: unknown[] = []
  const rowEnd = Math.min(end.row, rows.length - 1)
  for (let row = start.row; row <= rowEnd; row += 1) {
    for (let col = start.col; col <= end.col; col += 1) {
      values.push(rows[row]?.[col] ?? '')
    }
  }
  return values
}

function criterionValue(raw: RawWorkbook, currentSheet: string, criterion: string) {
  const trimmed = criterion.trim()
  if (/^".*"$/.test(trimmed)) return trimmed.slice(1, -1)
  const ref = parseSheetRef(trimmed, currentSheet)
  if (parseCellRef(ref.addr)) return rawCell(raw, ref.sheet, ref.addr)
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : trimmed
}

function matchesCriterion(value: unknown, criterion: unknown) {
  const left = String(value ?? '')
  const right = String(criterion ?? '')
  if (right.includes('*')) {
    const pattern = new RegExp(`^${right.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    return pattern.test(left)
  }
  return left === right || Number(left) === Number(right)
}

function evaluateSumifs(raw: RawWorkbook, currentSheet: string, inner: string) {
  const args = splitFormulaArgs(inner)
  if (args.length < 3) return 0
  const sumValues = rangeValues(raw, currentSheet, args[0]).map((value) => Number(value) || 0)
  const criteriaRanges: Array<{ values: unknown[]; criterion: unknown }> = []
  for (let index = 1; index < args.length; index += 2) {
    criteriaRanges.push({
      values: rangeValues(raw, currentSheet, args[index]),
      criterion: criterionValue(raw, currentSheet, args[index + 1] || ''),
    })
  }
  return sumValues.reduce((sum, value, index) => {
    const ok = criteriaRanges.every((range) => matchesCriterion(range.values[index], range.criterion))
    return ok ? sum + value : sum
  }, 0)
}

function evaluateSum(raw: RawWorkbook, currentSheet: string, inner: string) {
  return splitFormulaArgs(inner).reduce((sum, arg) => {
    if (arg.includes(':')) {
      return sum + rangeValues(raw, currentSheet, arg).reduce<number>((innerSum, value) => innerSum + (Number(value) || 0), 0)
    }
    const ref = parseSheetRef(arg, currentSheet)
    const value = parseCellRef(ref.addr) ? rawCell(raw, ref.sheet, ref.addr) : Number(arg)
    return sum + (Number(value) || 0)
  }, 0)
}

function replaceFunction(formula: string, fnName: string, evaluator: (inner: string) => number) {
  let output = formula
  let guard = 0
  while (guard < 200) {
    guard += 1
    const start = output.toUpperCase().indexOf(`${fnName}(`)
    if (start < 0) break
    let depth = 0
    let end = -1
    for (let index = start + fnName.length; index < output.length; index += 1) {
      const char = output[index]
      if (char === '(') depth += 1
      if (char === ')') {
        depth -= 1
        if (depth === 0) {
          end = index
          break
        }
      }
    }
    if (end < 0) break
    const inner = output.slice(start + fnName.length + 1, end)
    output = `${output.slice(0, start)}${evaluator(inner)}${output.slice(end + 1)}`
  }
  return output
}

function evaluateFormula(raw: RawWorkbook, currentSheet: string, formula: string): unknown {
  if (!formula || formula.includes('#REF!')) return undefined
  let expression = formula.replace(/^=/, '').replace(/\s+/g, '')
  expression = replaceFunction(expression, 'SUMIFS', (inner) => evaluateSumifs(raw, currentSheet, inner))
  expression = replaceFunction(expression, 'SUM', (inner) => evaluateSum(raw, currentSheet, inner))
  expression = expression.replace(/(?:'([^']+)'|([A-Za-z0-9_\u4e00-\u9fff .>\-]+))!\$?([A-Z]+)\$?(\d+)/g, (_match, quoted, bare, col, row) => {
    const value = rawCell(raw, quoted || bare, `${col}${row}`)
    return String(Number(value) || 0)
  })
  expression = expression.replace(/\$?([A-Z]+)\$?(\d+)/g, (_match, col, row) => {
    const value = rawCell(raw, currentSheet, `${col}${row}`)
    return String(Number(value) || 0)
  })
  if (!/^[0-9+\-*/().,%]+$/.test(expression)) return undefined
  try {
    const normalized = expression.replace(/,/g, '').replace(/%/g, '/100')
    return Function(`"use strict"; return (${normalized})`)()
  } catch {
    return undefined
  }
}

function buildRawWorkbookFromSheets(sheets: Record<string, XLSX.WorkSheet>) {
  const raw: RawWorkbook = {}
  Object.entries(sheets).forEach(([sheetName, sheet]) => {
    const decoded = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
    const rows: RawSheet = []
    for (let rowIndex = 0; rowIndex <= decoded.e.r; rowIndex += 1) {
      const row: unknown[] = []
      for (let colIndex = 0; colIndex <= decoded.e.c; colIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
        row.push(sheet[address]?.v ?? '')
      }
      rows.push(row)
    }
    raw[sheetName] = rows
  })
  return raw
}

function templateSheetOrder(template: WorkbookSnapshot) {
  return template.sheets.map((sheet) => sheet.name)
}

function expandThreeDSum(formula: string, sheetOrder: string[]) {
  return formula.replace(/'([^']+):([^']+)'!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)/gi, (_match, startSheet, endSheet, addr) => {
    const start = sheetOrder.indexOf(startSheet)
    const end = sheetOrder.indexOf(endSheet)
    if (start < 0 || end < 0 || end < start) return 'SUM(0)'
    const refs = sheetOrder.slice(start, end + 1).map((sheet) => `'${sheet}'!${addr}`)
    return refs.join(',')
  })
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function quoteSheetRefs(formula: string, sheetNames: string[]) {
  let output = formula
  sheetNames
    .filter((name) => name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .sort((left, right) => right.length - left.length)
    .forEach((name) => {
      output = output.replace(new RegExp(`(?<!')${escapeRegExp(name)}!`, 'g'), `'${name}'!`)
    })
  return output
}

function sanitizeFormulaForEngine(formula: string, sheetOrder: string[]) {
  if (formula.includes('[')) return ''
  let next = formula.replace(/\r?\n/g, '').replace(/\[[^\]]+\]/g, '')
  next = expandThreeDSum(next, sheetOrder)
  next = quoteSheetRefs(next, sheetOrder)
  return next
}

function templateSheetToEngineArray(sheet: SheetSnapshot, sheetOrder: string[]) {
  return sheet.cells.map((row) =>
    row.map((cell) => {
      if (cell.formula && !cell.formula.includes('#REF!')) return sanitizeFormulaForEngine(cell.formula, sheetOrder) || cell.value || ''
      return cell.value ?? ''
    }),
  )
}

function buildEngineSheets(template: WorkbookSnapshot, uploadedRaw: RawWorkbook) {
  const sheetOrder = templateSheetOrder(template)
  const sheets: Record<string, RawSheet> = {}
  template.sheets.forEach((sheet) => {
    sheets[sheet.name] = templateSheetToEngineArray(sheet, sheetOrder)
  })
  Object.entries(uploadedRaw).forEach(([sheetName, rows]) => {
    sheets[sheetName] = rows
  })
  return sheets
}

function hyperValueToPlain(value: unknown) {
  if (value && typeof value === 'object' && 'value' in value) {
    return String((value as { value: unknown }).value)
  }
  if (value && typeof value === 'object' && 'type' in value) {
    return `#${String((value as { type: unknown }).type)}`
  }
  return value ?? ''
}

function calculateTemplateSheets(template: WorkbookSnapshot, uploadedRaw: RawWorkbook) {
  const raw: RawWorkbook = { ...uploadedRaw }
  try {
    const engineSheets = buildEngineSheets(template, uploadedRaw)
    const engine = HyperFormula.buildFromSheets(engineSheets as never, {
      licenseKey: 'gpl-v3',
      useStats: false,
      maxRows: 200000,
      maxColumns: 2000,
    })
    const calculatedSheets = template.sheets
      .filter((sheet) => !['source', 'reference'].includes(sheet.category))
      .map((sheet) => {
        const sheetId = engine.getSheetId(sheet.name)
        const nextCells = sheet.cells.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            let engineValue: unknown
            if (sheetId !== undefined) {
              engineValue = hyperValueToPlain(engine.getCellValue({ sheet: sheetId, row: rowIndex, col: colIndex }))
            }
            const fallback = cell.formula ? evaluateFormula(raw, sheet.name, cell.formula) : undefined
            const value = engineValue === '' || String(engineValue).startsWith('#') ? fallback ?? cell.value : engineValue
            return {
              ...cell,
              value,
              display: cellDisplay(value),
            }
          }),
        )
        raw[sheet.name] = nextCells.map((row) => row.map((cell) => cell.value))
        return { ...sheet, cells: nextCells }
      })
    engine.destroy()
    return calculatedSheets
  } catch (error) {
    console.warn('HyperFormula calculation failed, using fallback evaluator', error)
    const calculatedSheets = template.sheets
      .filter((sheet) => !['source', 'reference'].includes(sheet.category))
      .map((sheet) => {
        const nextCells = sheet.cells.map((row) =>
          row.map((cell) => {
            const calculated = cell.formula ? evaluateFormula(raw, sheet.name, cell.formula) : undefined
            const value = calculated ?? cell.value
            return {
              ...cell,
              value,
              display: cellDisplay(value),
            }
          }),
        )
        raw[sheet.name] = nextCells.map((row) => row.map((cell) => cell.value))
        return { ...sheet, cells: nextCells }
      })
    return calculatedSheets
  }
}

function cellDisplay(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    if (value === 0) return '0'
    if (Math.abs(value) >= 1) return amountFormatter.format(value)
    return `${(value * 100).toFixed(2)}%`
  }
  return sanitizeText(String(value))
}

function normalizeFormula(formula: unknown) {
  if (!formula) return ''
  const text = String(formula)
  return text.startsWith('=') ? text : `=${text}`
}

function sourceRefs(formula: string) {
  if (!formula) return []
  const refs = [...formula.matchAll(/(?:'([^']+)'|([A-Za-z0-9_\u4e00-\u9fff .>\-]+))!/g)]
    .map((match) => (match[1] || match[2] || '').trim())
    .filter(Boolean)
  return [...new Set(refs)].slice(0, 8)
}

function parseCsvCellValue(value: unknown) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    const number = Number(trimmed.replace(/,/g, ''))
    return Number.isFinite(number) && /^-?[\d,.]+(?:\.\d+)?%?$/.test(trimmed)
      ? trimmed.endsWith('%')
        ? number / 100
        : number
      : trimmed
  }
}

function parseSnapshotCsv(text: string, template: WorkbookSnapshot, fileName: string): WorkbookSnapshot {
  const workbook = XLSX.read(text, { type: 'string', raw: false })
  const firstSheetName = workbook.SheetNames[0]
  const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined
  if (!firstSheet) throw new Error('CSV 文件为空。')
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as unknown[][]
  const header = rows[0]?.map((cell) => String(cell).trim()) || []
  const formatIndex = header.indexOf('format')
  const sheetIndex = header.indexOf('sheet')
  const rowIndex = header.indexOf('row')
  const colIndex = header.indexOf('col')
  const valueIndex = header.indexOf('valueJson')
  const displayIndex = header.indexOf('display')
  const formulaIndex = header.indexOf('formula')
  const isSnapshotCsv =
    formatIndex >= 0 &&
    sheetIndex >= 0 &&
    rowIndex >= 0 &&
    colIndex >= 0 &&
    valueIndex >= 0 &&
    rows.some((row) => row[formatIndex] === 'ifrs17-result-snapshot')

  if (!isSnapshotCsv) {
    throw new Error('当前 CSV 需要使用系统导出的 IFRS17 结果快照格式。')
  }

  const sheets = template.sheets
    .filter((sheet) => sheet.category !== 'reference')
    .map((sheet) => ({
      ...sheet,
      cells: sheet.cells.map((row) =>
        row.map((cell) => ({
          ...cell,
          value: '',
          display: '',
        })),
      ),
    }))
  const sheetMap = new Map(sheets.map((sheet) => [sheet.name, sheet]))

  rows.slice(1).forEach((row) => {
    if (row[formatIndex] !== 'ifrs17-result-snapshot') return
    const sheet = sheetMap.get(String(row[sheetIndex] || ''))
    const r = Number(row[rowIndex])
    const c = Number(row[colIndex])
    if (!sheet || !Number.isInteger(r) || !Number.isInteger(c) || !sheet.cells[r]?.[c]) return
    const value = parseCsvCellValue(row[valueIndex])
    sheet.cells[r][c] = {
      ...sheet.cells[r][c],
      value,
      display: String(row[displayIndex] || cellDisplay(value)),
      formula: formulaIndex >= 0 ? String(row[formulaIndex] || sheet.cells[r][c].formula || '') : sheet.cells[r][c].formula,
    }
  })

  return {
    ...template,
    workbookFile: fileName,
    generatedAt: new Date().toISOString().slice(0, 10),
    sheets,
    notes: ['已读取 CSV 数据，并生成分析展示。'],
  }
}

function parseWorkbook(file: File, template: WorkbookSnapshot): Promise<WorkbookSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    if (/\.csv$/i.test(file.name)) {
      reader.onload = () => {
        try {
          resolve(parseSnapshotCsv(String(reader.result || ''), template, file.name))
        } catch (error) {
          reject(error)
        }
      }
      reader.readAsText(file, 'utf-8')
      return
    }
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, {
          cellDates: true,
          cellFormula: true,
          cellNF: false,
          cellStyles: false,
          type: 'array',
        })
        const rawWorkbook = buildRawWorkbookFromSheets(workbook.Sheets as Record<string, XLSX.WorkSheet>)
        const outputSheetNames = template.sheetGroups
          .filter((group) => !['source', 'reference'].includes(group.id))
          .flatMap((group) => group.sheets)
        const hasOutputSheets = outputSheetNames.some((sheetName) => workbook.SheetNames.includes(sheetName))
        const sheets = hasOutputSheets
          ? template.sheetGroups
              .flatMap((group) => group.sheets)
              .filter((sheetName, index, arr) => arr.indexOf(sheetName) === index)
              .filter((sheetName) => workbook.SheetNames.includes(sheetName))
              .map((sheetName) => {
            const ws = workbook.Sheets[sheetName]
            const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
            const rows = Math.min(range.e.r - range.s.r + 1, maxUploadRows)
            const cols = Math.min(range.e.c - range.s.c + 1, maxUploadCols)
            const cells: CellSnapshot[][] = []
            let formulaCount = 0
            const refs = new Set<string>()

            for (let r = 0; r < rows; r += 1) {
              const row: CellSnapshot[] = []
              for (let c = 0; c < cols; c += 1) {
                const address = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })
                const cell = ws[address]
                const formula = normalizeFormula(cell?.f)
                if (formula) {
                  formulaCount += 1
                  sourceRefs(formula).forEach((ref) => refs.add(ref))
                }
                row.push({
                  address,
                  value: cell?.v ?? '',
                  display: cellDisplay(cell?.v ?? ''),
                  formula,
                })
              }
              cells.push(row)
            }

            const category =
              template.sheetGroups.find((group) => group.sheets.includes(sheetName))?.id || 'other'

            return {
              name: sheetName,
              category,
              rowCount: range.e.r - range.s.r + 1,
              columnCount: range.e.c - range.s.c + 1,
              displayedRows: rows,
              displayedColumns: cols,
              formulaCountInSnapshot: formulaCount,
              sourceRefs: [...refs].sort(),
              cells,
            }
          })
          : calculateTemplateSheets(template, rawWorkbook)

        resolve({
          ...template,
          workbookFile: file.name || 'uploaded-input.xlsx',
          generatedAt: new Date().toISOString().slice(0, 10),
          sheets,
          notes: [
            hasOutputSheets
              ? '已从上传文件读取分析结果。'
              : '已从上传文件读取数据源，并完成后台计算。',
            hasOutputSheets
              ? '上传文件包含结果表，优先展示已计算结果。'
              : '上传文件未包含结果表，系统已完成一次性计算并缓存本次结果。',
          ],
        })
      } catch (error) {
        reject(error)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

function rowByLabel(sheet: SheetSnapshot | undefined, label: string) {
  if (!sheet) return undefined
  return sheet.cells.find((row) => row.some((cell) => cell.display.includes(label)))
}

function rowByExactLabel(sheet: SheetSnapshot | undefined, label: string) {
  if (!sheet) return undefined
  const normalized = label.replace(/\s+/g, '')
  return sheet.cells.find((row) =>
    row.some((cell) => cell.display.replace(/\s+/g, '') === normalized),
  )
}

function nthNumberInRow(row: CellSnapshot[] | undefined, index: number) {
  const numbers = row?.filter((cell) => typeof cell.value === 'number').map((cell) => Number(cell.value)) || []
  return numbers[index]
}

function nthNumberRightOfLabel(sheet: SheetSnapshot | undefined, label: string, numberIndex: number) {
  const normalized = label.replace(/\s+/g, '')
  const row = sheet?.cells.find((candidate) =>
    candidate.some((cell) => cell.display.replace(/\s+/g, '') === normalized),
  )
  const labelIndex = row?.findIndex((cell) => cell.display.replace(/\s+/g, '') === normalized) ?? -1
  const numbers = labelIndex >= 0
    ? row?.slice(labelIndex + 1).filter((cell) => typeof cell.value === 'number').map((cell) => Number(cell.value)) || []
    : []
  return numbers[numberIndex] || 0
}

function metricDisplay(sheet: SheetSnapshot | undefined, labels: string[], numberIndex = 0, options: { absolute?: boolean } = {}) {
  const candidateRows = [
    ...labels.map((label) => rowByExactLabel(sheet, label)),
    ...labels.map((label) => rowByLabel(sheet, label)),
  ]
  for (const row of candidateRows) {
    const value = nthNumberInRow(row, numberIndex)
    if (value !== undefined) return formatWanAmount(options.absolute ? Math.abs(value) : value)
  }
  return ''
}

function valuesForResultRow(row: CellSnapshot[] | undefined) {
  if (!row) return []
  const labelCellIndex = row.findIndex((cell) => isCleanOutputLabel(cell.display))
  if (labelCellIndex < 0) return []
  const firstResultBlock = row.slice(labelCellIndex + 1, labelCellIndex + 17)
  return firstResultBlock.some((cell) => String(cell.display || cell.value).includes('#REF!'))
    ? firstResultBlock
        .filter((cell) => !String(cell.display || cell.value).includes('#REF!') && typeof cell.value === 'number')
        .map((cell) => Number(cell.value))
        .slice(0, 8)
    : row
        .slice(labelCellIndex + 1, labelCellIndex + 9)
        .map((cell) => (typeof cell.value === 'number' ? Number(cell.value) : 0))
}

function exactOrContainsRow(sheet: SheetSnapshot | undefined, labels: string[]) {
  for (const label of labels) {
    const exact = rowByExactLabel(sheet, label)
    if (exact) return exact
  }
  for (const label of labels) {
    const normalized = label.replace(/\s+/g, '')
    const row = sheet?.cells.find((candidate) =>
      candidate.some((cell) => cell.display.replace(/\s+/g, '').includes(normalized)),
    )
    if (row) return row
  }
  return undefined
}

function resultValue(sheet: SheetSnapshot | undefined, labels: string[], filters: FilterState) {
  const values = valuesForResultRow(exactOrContainsRow(sheet, labels))
  return values[selectedMetricIndex(filters)] || 0
}

function resultValueBetween(
  sheet: SheetSnapshot | undefined,
  labels: string[],
  startLabel: string,
  endLabel: string,
  filters: FilterState,
) {
  if (!sheet) return 0
  const startIndex = sheet.cells.findIndex((row) => row.some((cell) => cell.display.replace(/\s+/g, '') === startLabel))
  const endIndex = sheet.cells.findIndex((row, index) => index > startIndex && row.some((cell) => cell.display.replace(/\s+/g, '') === endLabel))
  const scopedRows = sheet.cells.slice(Math.max(startIndex + 1, 0), endIndex > startIndex ? endIndex : sheet.cells.length)
  for (const label of labels) {
    const normalized = label.replace(/\s+/g, '')
    const row = scopedRows.find((candidate) => candidate.some((cell) => cell.display.replace(/\s+/g, '') === normalized))
    const values = valuesForResultRow(row)
    if (values.length) return values[selectedMetricIndex(filters)] || 0
  }
  return 0
}

function withShares<T extends { value: number }>(rows: T[]) {
  const denominator = rows.reduce((sum, row) => sum + Math.abs(row.value), 0) || 1
  return rows.map((row) => ({
    ...row,
    share: Math.abs(row.value) / denominator,
    labelText: `${formatChartAmount(row.value)} (${percentFormatter.format(Math.abs(row.value) / denominator)})`,
  }))
}

function withSignedContribution<T extends { value: number }>(rows: T[], denominator: number) {
  const safeDenominator = denominator || 1
  return rows.map((row) => ({
    ...row,
    share: row.value / safeDenominator,
    labelText: `${formatChartAmount(row.value)} (${percentFormatter.format(row.value / safeDenominator)})`,
  }))
}

function withSignedShareOfTotal<T extends { value: number }>(rows: T[], denominator?: number) {
  const safeDenominator = denominator || rows.reduce((sum, row) => sum + row.value, 0) || 1
  return rows.map((row) => ({
    ...row,
    share: row.value / safeDenominator,
    labelText: `${formatChartAmount(row.value)} (${percentFormatter.format(row.value / safeDenominator)})`,
  }))
}

function withExpenseContribution<T extends { value: number }>(rows: T[], denominator: number) {
  const safeDenominator = denominator || rows.reduce((sum, row) => sum + row.value, 0) || 1
  return rows.map((row) => ({
    ...row,
    share: row.value / safeDenominator,
    labelText: `${formatChartAmount(row.value)} (${percentFormatter.format(row.value / safeDenominator)})`,
  }))
}

function longTermAccountRows<T extends { account: string }>(rows: T[]) {
  return rows.filter((row) => row.account !== '短险' && row.account !== '再保')
}

function buildAccountDistribution(sheet: SheetSnapshot | undefined, labels: string[], filters: FilterState) {
  const values = valuesForResultRow(exactOrContainsRow(sheet, labels))
  const rows = accountSegmentLabels.map((account, index) => ({
    account,
    value: values[index + 1] || 0,
  }))
  const accountOption = filterDefinitions
    .find((definition) => definition.key === 'account')
    ?.options.find((option) => option.value === filters.account)
  if (filters.origOrReins === 'reinsurance') return rows.filter((row) => row.account === '再保')
  if (accountOption) return rows.filter((row) => row.account === accountOption.label)
  if (filters.origOrReins === 'direct') return rows.filter((row) => row.account !== '再保')
  return rows
}

function buildCsmMovement(sheet: SheetSnapshot | undefined, filters: FilterState) {
  if (!sheet) return []
  const accountLabel = filterDefinitions
    .find((definition) => definition.key === 'account')
    ?.options.find((option) => option.value === filters.account)?.label
  const rowLabel = filters.origOrReins === 'reinsurance' ? '再保' : accountLabel || '公司'
  const csmRow =
    sheet.cells.find((row) => row[2]?.display.replace(/\s+/g, '') === rowLabel) ||
    sheet.cells.find((row) => row[2]?.display.replace(/\s+/g, '') === '公司')
  const labels = ['期初', '新单', '计息', '调整', '释放', '期末']
  return labels.map((name, index) => ({
    name,
    value: Number(csmRow?.[index + 3]?.value || 0) / 10000,
  }))
}

function buildCsmClosingByAccount(sheet: SheetSnapshot | undefined, filters: FilterState) {
  if (!sheet) return []
  const accountRows = ['传统', '分红1', '分红2', '万能', '投连'].map((account) => {
    const row = sheet.cells.find((candidate) => candidate[2]?.display.replace(/\s+/g, '') === account)
    return { account, value: Number(row?.[8]?.value || 0) / 10000 }
  })
  const accountOption = filterDefinitions
    .find((definition) => definition.key === 'account')
    ?.options.find((option) => option.value === filters.account)
  if (accountOption) return accountRows.filter((row) => row.account === accountOption.label)
  if (filters.origOrReins === 'reinsurance') return []
  return accountRows.filter((row) => row.value !== 0)
}

function findCsmSectionRows(sheet: SheetSnapshot | undefined, sectionLabel: string) {
  if (!sheet) return []
  const fallbackRanges: Record<string, [number, number]> = {
    NB盈利性: [11, 17],
    CSM计息率: [20, 26],
  }
  const fallback = fallbackRanges[sectionLabel]
  const startIndex = sheet.cells.findIndex((row) => row.some((cell) => cell.display.replace(/\s+/g, '').includes(sectionLabel)))
  if (startIndex < 0) return fallback ? sheet.cells.slice(fallback[0], fallback[1]) : []
  const nextSectionIndex = sheet.cells.findIndex(
    (row, index) =>
      index > startIndex &&
      row.some((cell) => /^\d+\./.test(cell.display.replace(/\s+/g, ''))),
  )
  const rows = sheet.cells.slice(startIndex + 1, nextSectionIndex > startIndex ? nextSectionIndex : sheet.cells.length)
  const accountRows = rows.filter((row) => row[2]?.display.trim())
  if (accountRows.length) return rows

  return fallback ? sheet.cells.slice(fallback[0], fallback[1]) : rows
}

function percentageCell(cell: CellSnapshot | undefined) {
  if (typeof cell?.value === 'number') return Number(cell.value)
  const text = String(cell?.display || '').trim()
  if (!text || text === 'NA' || text.includes('#')) return Number.NaN
  const parsed = Number(text.replace('%', '').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed / (text.includes('%') ? 100 : 1) : Number.NaN
}

function buildCsmNbProfitabilityRows(sheet: SheetSnapshot | undefined, filters: FilterState) {
  const rows = findCsmSectionRows(sheet, 'NB盈利性')
  const accountOption = filterDefinitions
    .find((definition) => definition.key === 'account')
    ?.options.find((option) => option.value === filters.account)
  const labels = filters.account
    ? [accountOption?.label || '公司']
    : ['公司', '传统', '分红1', '分红2', '万能', '投连']
  if (filters.origOrReins === 'reinsurance') return []
  return labels
    .map((account) => {
      const row = rows.find((candidate) => candidate[2]?.display.replace(/\s+/g, '') === account)
      return { name: account, value: percentageCell(row?.[3]) }
    })
    .filter((row) => Number.isFinite(row.value))
}

function buildCsmInterestRateRows(sheet: SheetSnapshot | undefined, filters: FilterState) {
  const rows = findCsmSectionRows(sheet, 'CSM计息率')
  const accountOption = filterDefinitions
    .find((definition) => definition.key === 'account')
    ?.options.find((option) => option.value === filters.account)
  const labels = filters.account
    ? [accountOption?.label || '公司']
    : ['公司', '传统', '分红1', '分红2', '万能', '投连']
  if (filters.origOrReins === 'reinsurance') return []
  return labels
    .map((account) => {
      const row = rows.find((candidate) => candidate[2]?.display.replace(/\s+/g, '') === account)
      return {
        name: account,
        rate: percentageCell(row?.[3]),
        annualized: percentageCell(row?.[4]),
      }
    })
    .filter((row) => Number.isFinite(row.rate) || Number.isFinite(row.annualized))
}

function withLabelText<T extends { value: number }>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    labelText: formatChartAmount(row.value),
  }))
}

function selectedFilterLabel(filters: FilterState) {
  const parts = filterDefinitions
    .map((definition) => {
      const selected = filters[definition.key]
      const option = definition.options.find((item) => item.value === selected)
      return option ? `${definition.label}: ${option.label}` : ''
    })
    .filter(Boolean)
  return parts.length ? parts.join(' / ') : '全部维度'
}

function selectedMetricIndex(filters: FilterState) {
  if (filters.origOrReins === 'reinsurance') return 7
  const accountIndex: Record<string, number> = {
    traditional: 1,
    par1: 2,
    par2: 3,
    universal: 4,
    unitLinked: 5,
    shortTerm: 6,
  }
  return accountIndex[filters.account] ?? 0
}

function hasAccountFilter(filters: FilterState) {
  return Boolean(filters.account || filters.origOrReins === 'reinsurance')
}

function buildMetricSeriesForFilter(sheet: SheetSnapshot | undefined, labels: string[], filters: FilterState, limit = 8) {
  const index = selectedMetricIndex(filters)
  return labels
    .map((label) => ({
      name: label.replace(/\s+/g, ''),
      value: nthNumberInRow(rowByExactLabel(sheet, label) || rowByLabel(sheet, label), index) || 0,
    }))
    .slice(0, limit)
}

function buildProfitStatementMain(sheet: SheetSnapshot | undefined, filters: FilterState) {
  const accountIndex = selectedMetricIndex(filters)
  const accountScope = hasAccountFilter(filters) ? '当前筛选账户' : '公司'
  return [
    {
      name: '保险服务业绩',
      value: nthNumberInRow(rowByExactLabel(sheet, '保险服务业绩合计') || rowByLabel(sheet, '保险服务业绩'), accountIndex) || 0,
      scope: accountScope,
      accountLevel: true,
    },
    {
      name: '投资服务业绩',
      value: nthNumberInRow(rowByExactLabel(sheet, '投资服务业绩合计') || rowByLabel(sheet, '投资服务业绩'), accountIndex) || 0,
      scope: accountScope,
      accountLevel: true,
    },
    {
      name: '其他业务利润',
      value: nthNumberInRow(rowByExactLabel(sheet, '其他业务利润'), 0) || 0,
      scope: '公司层级',
      accountLevel: false,
    },
    {
      name: '营业外收支',
      value: nthNumberInRow(rowByExactLabel(sheet, '营业外收支'), 0) || 0,
      scope: '公司层级',
      accountLevel: false,
    },
    {
      name: '所得税',
      value: nthNumberInRow(rowByExactLabel(sheet, '所得税'), 0) || 0,
      scope: '公司层级',
      accountLevel: false,
    },
    {
      name: '本期净利',
      value: nthNumberInRow(rowByExactLabel(sheet, '本期净利'), 0) || 0,
      scope: '公司口径结果',
      accountLevel: false,
    },
  ]
}

function buildRevenueComposition(sheet: SheetSnapshot | undefined, filters: FilterState) {
  return [
    { name: '合同服务边际摊销', value: resultValue(sheet, ['合同服务边际摊销', '合同服务边际'], filters) },
    { name: '预期风险调整释放', value: resultValue(sheet, ['预期风险调整释放', '预期风险调整'], filters) },
    { name: '预期赔付的保险成分', value: resultValue(sheet, ['预期赔付的保险成分', '预期赔付的'], filters) },
    { name: '预期保险服务费用', value: resultValue(sheet, ['预期保险服务费用', '预期保险服务'], filters) },
    { name: '损失摊销', value: resultValue(sheet, ['损失摊销'], filters) },
    { name: '获取费用摊销', value: resultValue(sheet, ['获取费用摊销'], filters) },
    { name: '保费分配法保费收入', value: resultValue(sheet, ['按保费分配法计量的合同确认的保费收入', '保费分配法'], filters) },
  ]
}

function buildPaaRevenueSplit(sheet: SheetSnapshot | undefined, filters: FilterState) {
  const index = selectedMetricIndex(filters)
  const total = nthNumberInRow(rowByLabel(sheet, '保险服务收入合计'), index) || 0
  const paa = nthNumberInRow(rowByLabel(sheet, '保费分配法'), index) || 0
  const nonPaa = total - paa
  return [
    { name: '非PAA合同收入', value: Math.max(nonPaa, 0) },
    { name: 'PAA合同收入', value: Math.max(paa, 0) },
  ]
}

function buildInsuranceProfitContribution(
  profitSheet: SheetSnapshot | undefined,
  serviceSheet: SheetSnapshot | undefined,
  filters: FilterState,
) {
  const rows = [
    { name: '合同服务边际摊销', value: resultValue(serviceSheet, ['合同服务边际摊销'], filters) },
    { name: '预期风险调整释放', value: resultValue(serviceSheet, ['预期风险调整释放'], filters) },
    { name: '保险成分预实偏差', value: resultValue(serviceSheet, ['保险成分预实偏差'], filters) },
    { name: '维持费用预实偏差', value: resultValue(serviceSheet, ['维持费用预实偏差'], filters) },
    { name: '首日亏损', value: resultValue(profitSheet, ['首日亏损'], filters) },
    { name: '亏损加剧/转回', value: resultValue(profitSheet, ['亏损加剧/转回'], filters) },
    { name: '已发生赔款负债的调整', value: resultValue(serviceSheet, ['已发生赔款负债的调整'], filters) },
    { name: '短险利润', value: resultValue(serviceSheet, ['短险利润'], filters) },
    { name: '再保净利', value: resultValue(serviceSheet, ['再保净利', '再保险净收益/成本'], filters) },
  ]
  const denominator = rows.reduce((sum, row) => sum + Math.abs(row.value), 0) || 1
  return rows.map((row) => ({ ...row, share: Math.abs(row.value) / denominator }))
}

function buildInsuranceExpenseDrivers(sheet: SheetSnapshot | undefined, filters: FilterState) {
  const expenseValue = (labels: string[]) => resultValueBetween(sheet, labels, '保险服务收入合计', '保险费用合计', filters)
  const rows = [
    { name: '实际赔付的保险成分', value: -expenseValue(['实际赔付的保险成分']) },
    { name: '实际维持费用', value: -expenseValue(['实际维持费用']) },
    { name: '损失摊销', value: -expenseValue(['损失摊销']) },
    { name: '获取费用摊销', value: -expenseValue(['获取费用摊销']) },
    { name: '首日亏损', value: -expenseValue(['首日亏损']) },
    { name: '亏损加剧/转回', value: -expenseValue(['亏损加剧/转回']) },
    { name: '已发生赔款负债的调整', value: -expenseValue(['（与过去服务相关的）已发生赔款负债的调整', '已发生赔款负债的调整']) },
    { name: '再保险净收益/成本', value: -expenseValue(['再保险净收益/成本']) },
  ]
  return withExpenseContribution(rows, -resultValue(sheet, ['保险费用合计'], filters))
}

function buildCsmAmortizationRateRows(sheet: SheetSnapshot | undefined, filters: FilterState) {
  if (!sheet) return []
  const accountLabels = filters.account || filters.origOrReins === 'reinsurance'
    ? [filters.origOrReins === 'reinsurance'
        ? '再保'
        : filterDefinitions.find((definition) => definition.key === 'account')?.options.find((option) => option.value === filters.account)?.label || '公司']
    : ['公司', '传统', '分红1', '分红2', '万能', '投连']
  return accountLabels
    .map((account) => {
      const row = sheet.cells.find((candidate) => candidate[2]?.display.replace(/\s+/g, '') === account)
      const release = Number(row?.[7]?.value || 0) / 10000
      const closing = Number(row?.[8]?.value || 0) / 10000
      const beforeRelease = closing - release
      return {
        name: account,
        value: beforeRelease ? Math.abs(release) / beforeRelease : 0,
      }
    })
    .filter((row) => row.value !== 0)
}

function buildInvestmentServiceRows(profitSheet: SheetSnapshot | undefined, filters: FilterState) {
  return [
    { name: '投资收益', value: resultValue(profitSheet, ['投资收益'], filters) },
    { name: '保险金融负债成本', value: resultValue(profitSheet, ['计入损益的保险合同金融变动额', '保险金融负债成本'], filters) },
    { name: '投资服务业绩', value: resultValue(profitSheet, ['投资服务业绩合计', '投资服务业绩'], filters) },
  ]
}

function companyResultValue(sheet: SheetSnapshot | undefined, labels: string[]) {
  return valuesForResultRow(exactOrContainsRow(sheet, labels))[0] || 0
}

function buildTaxBridge(sheet: SheetSnapshot | undefined) {
  return ['税前净利', '所得税', '本期净利'].map((label) => ({
    name: label,
    value: companyResultValue(sheet, [label]),
  }))
}

function buildTaxRate(sheet: SheetSnapshot | undefined) {
  const preTax = companyResultValue(sheet, ['税前净利'])
  const tax = companyResultValue(sheet, ['所得税'])
  return preTax ? Math.abs(tax) / Math.abs(preTax) : 0
}

function buildOciBridge(sheet: SheetSnapshot | undefined) {
  return ['本期净利', '税后负债OCI变动', '税后资产OCI变动', '本期综合收益'].map((label) => ({
    name: label,
    value: companyResultValue(sheet, [label]),
  }))
}

function buildValueReserveRows(finSheet: SheetSnapshot | undefined, csmSheet: SheetSnapshot | undefined) {
  const netAssetsWan = nthNumberRightOfLabel(finSheet, '所有者权益（或股东权益）合计', 2) / 10000
  const companyCsmRow = csmSheet?.cells.find((row) => row[2]?.display.replace(/\s+/g, '') === '公司')
  const closingCsmWan = Number(companyCsmRow?.[8]?.value || 0) / 10000
  const afterTaxCsmWan = closingCsmWan * 0.75
  return [
    { name: '净资产', value: netAssetsWan },
    { name: '税后CSM', value: afterTaxCsmWan },
    { name: '综合净资产', value: netAssetsWan + afterTaxCsmWan },
  ]
}

function buildSoeWaterfall(sheet: SheetSnapshot | undefined) {
  if (!sheet) return []
  const startIndex = sheet.cells.findIndex((row) =>
    row.some((cell) => cell.display.replace(/\s+/g, '') === '现行税前营业利润'),
  )
  const endIndex = sheet.cells.findIndex((row, index) =>
    index > startIndex && row.some((cell) => cell.display.replace(/\s+/g, '') === 'IFRS17税前营业利润'),
  )
  if (startIndex < 0 || endIndex <= startIndex) return []

  const startRow = sheet.cells[startIndex]
  const labelCol = startRow.findIndex((cell) => compactText(displayCellText(cell)) === '现行税前营业利润')
  const valueCol = startRow.findIndex((cell, index) => index > labelCol && typeof cell.value === 'number')
  if (labelCol < 0 || valueCol < 0) return []

  const sourceRows = sheet.cells
    .slice(startIndex, endIndex + 1)
    .map((row) => ({
      name: displayCellText(row[labelCol]),
      value: typeof row[valueCol]?.value === 'number' ? Number(row[valueCol].value) : 0,
    }))
    .filter((row) => row.name)

  let running = 0
  return sourceRows.map((row, index) => {
    const isEndpoint = index === 0 || index === sourceRows.length - 1
    const start = isEndpoint ? 0 : running
    const end = isEndpoint ? row.value : running + row.value
    running = isEndpoint ? row.value : end
    return {
      name: row.name,
      value: row.value,
      range: [Math.min(start, end), Math.max(start, end)] as [number, number],
      labelText: formatChartAmount(row.value),
      endpoint: isEndpoint,
    }
  })
}

const defaultCleanHeaders = ['公司', '传统', '分红1', '分红2', '万能', '投连', '短险', '再保']
const csmMovementHeaders = ['期初', '新单', '计息', '调整', '释放', '期末']
const hiddenOutputSheetNames = new Set(['2.0 IFIE细项拆分'])

type CleanOutputRowKind = 'detail' | 'subtotal' | 'total' | 'grand-total'

type CleanOutputRow = {
  label: string
  values: number[]
  kind: CleanOutputRowKind
  level: number
}

type CleanTableBlock = {
  id: string
  rows: CleanOutputRow[]
}

type M1M2TableBlock = {
  id: string
  title: string
  cols: number[]
  rows: CellSnapshot[][]
}

type RatioTableBlock = {
  id: string
  title: string
  headers: string[]
  rows: string[][]
}

type StructuredTableBlock = {
  id: string
  title: string
  subtitle?: string
  headers: string[]
  rows: string[][]
  amountUnit?: 'wan' | 'yuan' | 'auto' | 'none'
}

function isCleanOutputLabel(label: string) {
  const text = label.replace(/\s+/g, '')
  if (!text || text.length > 34) return false
  if (/^\d+(\.\d+)?$/.test(text)) return false
  if (/^\d{4,8}$/.test(text)) return false
  if (/^-?\d+(\.\d+)?%$/.test(text)) return false
  if (/单位|CHECK|CHK|REF|请检查|公式|差异|引用|source|变量|old|new|审计|WALR/i.test(text)) return false
  if (/^发生额$|^RECLASS$|^渠道$|^费用$|^原$|^现$/.test(text)) return false
  if (/上升|下降|主要由于|体现|原因|剧本|口径|影响|现行|较/.test(text)) return false
  return /[\u4e00-\u9fffA-Za-z]/.test(text)
}

function classifyCleanRow(label: string): Pick<CleanOutputRow, 'kind' | 'level'> {
  const text = label.replace(/\s+/g, '')
  if (/本期净利|净利润|综合收益|期末余额|净资产|权益合计/.test(text)) {
    return { kind: 'grand-total', level: 0 }
  }
  if (/合计|总计|营业利润|税前利润|利润总额/.test(text)) {
    return { kind: 'total', level: 0 }
  }
  if (/小计|其中/.test(text)) {
    return { kind: 'subtotal', level: 1 }
  }
  return { kind: 'detail', level: 1 }
}

function shouldCloseCleanBlock(row: CleanOutputRow) {
  if (row.kind === 'grand-total') return true
  if (row.kind !== 'total') return false
  return /合计|总计|营业利润|税前利润|利润总额/.test(row.label)
}

function sheetNavigationDepth(sheetName: string) {
  const text = sheetName.trim()
  if (/^\d+\.\d+/.test(text)) return 2
  if (/^\d+\./.test(text)) return 1
  return 0
}

function buildCleanOutputRows(sheet: SheetSnapshot, query: string) {
  const lowerQuery = query.trim().toLowerCase()
  if (sheet.name === '1.2 CSM') {
    const csmRows = ['公司', '传统', '分红1', '分红2', '万能', '投连']
      .map((label) => {
        const sourceRow = sheet.cells.find((row) => row[2]?.display.replace(/\s+/g, '') === label)
        if (!sourceRow) return undefined
        return {
          label,
          values: csmMovementHeaders.map((_header, index) => Number(sourceRow[index + 3]?.value || 0) / 10000),
          ...classifyCleanRow(label),
        }
      })
      .filter((row): row is CleanOutputRow => Boolean(row))
    return lowerQuery
      ? csmRows.filter((row) => [row.label, ...row.values.map((value) => formatWanAmount(value))].join(' ').toLowerCase().includes(lowerQuery))
      : csmRows
  }

  const seen = new Set<string>()
  const rows = sheet.cells
    .map((row) => {
      const labelCellIndex = row.findIndex((cell) => isCleanOutputLabel(cell.display))
      if (labelCellIndex < 0) return undefined
      const label = row[labelCellIndex].display.replace(/\s+/g, '')
      const firstResultBlock = row.slice(labelCellIndex + 1, labelCellIndex + 13)
      const hasNumericValue = firstResultBlock.some((cell) => typeof cell.value === 'number')
      if (!hasNumericValue) return undefined
      const values = firstResultBlock.some((cell) => String(cell.display || cell.value).includes('#REF!'))
        ? firstResultBlock
            .filter((cell) => !String(cell.display || cell.value).includes('#REF!') && typeof cell.value === 'number')
            .map((cell) => Number(cell.value))
            .slice(0, 8)
        : row
            .slice(labelCellIndex + 1, labelCellIndex + 9)
            .map((cell) => (typeof cell.value === 'number' ? Number(cell.value) : 0))
      if (values.length === 0) return undefined
      if (seen.has(label)) return undefined
      seen.add(label)
      return { label, values, ...classifyCleanRow(label) }
    })
    .filter((row): row is CleanOutputRow => Boolean(row))

  return lowerQuery
    ? rows.filter((row) => [row.label, ...row.values.map((value) => formatWanAmount(value))].join(' ').toLowerCase().includes(lowerQuery))
    : rows
}

function cleanHeadersForSheet(sheetName: string, count: number) {
  return (sheetName === '1.2 CSM' ? csmMovementHeaders : defaultCleanHeaders).slice(0, count)
}

function compactText(value: string) {
  return value.replace(/\s+/g, '')
}

function displayCellText(cell: CellSnapshot | undefined) {
  const display = sanitizeText(String(cell?.display || '')).trim()
  if (display) return display
  if (typeof cell?.value === 'number') return amountFormatter.format(cell.value)
  return ''
}

function positiveDisplayText(text: string) {
  const value = text.trim()
  if (!value || value === '-') return value
  if (/^\(.+\)$/.test(value)) return value.slice(1, -1)
  if (value.startsWith('-')) return value.slice(1)
  return value
}

function rowHasContent(row: string[]) {
  return row.some((cell) => compactText(cell))
}

function filterStructuredRows(block: StructuredTableBlock, query: string): StructuredTableBlock | undefined {
  const lowerQuery = query.trim().toLowerCase()
  if (!lowerQuery) return block
  const rows = block.rows.filter((row) => [block.title, block.subtitle || '', ...row].join(' ').toLowerCase().includes(lowerQuery))
  return rows.length ? { ...block, rows } : undefined
}

function tableRowValueByLabel(sheet: SheetSnapshot | undefined, rowLabel: string, colIndex: number) {
  const normalized = compactText(rowLabel)
  const row = sheet?.cells.find((candidate) => compactText(displayCellText(candidate[0])) === normalized)
  return displayCellText(row?.[colIndex])
}

function buildProfitBreakdownTables(sheet: SheetSnapshot, query: string): StructuredTableBlock[] {
  const headers = ['项目', '公司', '传统', '分红1', '分红2', '万能', '投连', 'I17-CGAAP']
  const cols = [0, 5, 6, 7, 8, 9, 10, 11]
  const keepLabels = [
    '合同服务边际摊销',
    '预期风险调整释放',
    '赔付保险成分&维持费用预实偏差',
    '预期保险服务费用',
    '实际维持费用',
    '预期死伤医疗给付的保险成分',
    '实际死伤医疗给付的保险成分',
    '预期非死伤医疗给付的保险成分',
    '实际非死伤医疗给付的保险成分',
    '首日亏损',
    '亏损合同损失及损失的转回',
    '估计变更',
    '调整合同服务边际的估计变更',
    '（与过去服务相关的）已发生赔款负债的调整',
    '保险服务业绩-短期险',
    '按保费分配法计量的合同确认的保费收入',
    '实际赔付&维持费用',
    '获取费用摊销',
    '保险服务业绩-再保险',
    '保险服务业绩合计',
    '投资收益',
    '保险合同金融变动额',
    '计入损益的保险合同金融变动额',
    '计入损益的保险合同金融变动额（BEL）',
    '计入损益的保险合同金融变动额（CSM）',
    '投资服务业绩-短期险',
    '投资服务业绩合计',
    '其他业务利润',
    '非履约费用',
    '税前利润',
    '计入其他综合收益的保险合同金融变动额',
  ]
  const rows = sheet.cells
    .slice(2)
    .map((row) => cols.map((col) => displayCellText(row[col])))
    .filter((row) => {
      const label = row[0]
      if (!label) return false
      if (!keepLabels.includes(label)) return false
      if (/^[A-Z0-9_]+$/.test(label)) return false
      return row.slice(1).some((cell) => parseDisplayNumber(cell).number !== undefined)
    })
  const block: StructuredTableBlock = {
    id: 'profit-breakdown-current',
    title: 'I17利润拆解',
    subtitle: '当前会计期间，按利润项目及账户列示。',
    headers,
    rows,
    amountUnit: 'wan',
  }
  return [block].map((table) => filterStructuredRows(table, query)).filter((table): table is StructuredTableBlock => Boolean(table))
}

function buildInsuranceRevenueTables(sheet: SheetSnapshot, query: string, sheetMap?: Map<string, SheetSnapshot>): StructuredTableBlock[] {
  const profitSplitSheet = sheetMap?.get('0.I17利润拆解')
  const sourceRows = [
    '合同服务边际摊销',
    '预期风险调整释放',
    '预期赔付的保险成分',
    '预期保险服务费用',
    '损失摊销',
    '获取费用摊销',
    '保费分配法保费收入',
  ]
  const cols = [3, 5, 7, 9, 11]
  const rows = sourceRows.map((label) => {
    const row = sheet.cells.find((candidate) => compactText(displayCellText(candidate[2])).includes(compactText(label)))
    const values = cols.map((col) => displayCellText(row?.[col]))
    const linkedValue = tableRowValueByLabel(profitSplitSheet, label, 10)
    const ppaShortTerm = label === '保费分配法保费收入' ? displayCellText(row?.[3]) : ''
    return [label, ...values, linkedValue || '', ppaShortTerm]
  })

  const total = sheet.cells.find((candidate) => compactText(displayCellText(candidate[2])).includes('保险服务收入合计'))
  if (total) {
    const values = cols.map((col) => displayCellText(total[col]))
    const unitLinked = rows.reduce((sum, row) => sum + (parseDisplayNumber(row[6]).number || 0), 0)
    const shortTerm = parseDisplayNumber(rows.find((row) => row[0] === '保费分配法保费收入')?.[7]).number || 0
    rows.push(['保险服务收入合计', ...values, String(unitLinked || ''), String(shortTerm || '')])
  }

  const block: StructuredTableBlock = {
    id: 'insurance-revenue-current',
    title: '保险服务收入',
    subtitle: '当前会计期间；投连按利润拆解表补充，短险仅列示保费分配法保费收入。',
    headers: ['项目', '公司', '传统', '分红1', '分红2', '万能', '投连', '短险'],
    rows,
    amountUnit: 'wan',
  }
  return [block].map((table) => filterStructuredRows(table, query)).filter((table): table is StructuredTableBlock => Boolean(table))
}

function isTableStopRow(texts: string[]) {
  const first = compactText(texts[0] || '')
  const second = compactText(texts[1] || '').toLowerCase()
  return /^1例如|^2该/.test(first) || ['check', 'diff', 'compchk'].includes(second)
}

function lastHeaderColumn(sheet: SheetSnapshot, start: number, fallbackEnd: number) {
  let end = fallbackEnd
  sheet.cells.slice(0, 3).forEach((row) => {
    row.forEach((cell, index) => {
      if (index >= start && displayCellText(cell)) end = Math.max(end, index)
    })
  })
  return end
}

function buildM1M2Table(sheet: SheetSnapshot, id: string, cols: number[], query: string): M1M2TableBlock {
  const lowerQuery = query.trim().toLowerCase()
  let lastRow = Math.min(2, sheet.cells.length - 1)
  for (let rowIndex = 3; rowIndex < sheet.cells.length; rowIndex += 1) {
    const texts = cols.map((col) => displayCellText(sheet.cells[rowIndex]?.[col]))
    if (isTableStopRow(texts)) break
    if (texts.some(Boolean)) lastRow = rowIndex
  }

  const allRows = sheet.cells.slice(0, lastRow + 1)
  const rows = lowerQuery
    ? allRows.filter((row, index) => {
        if (index <= 2) return true
        return cols
          .map((col) => displayCellText(row[col]))
          .join(' ')
          .toLowerCase()
          .includes(lowerQuery)
      })
    : allRows
  const title = cols.map((col) => displayCellText(sheet.cells[0]?.[col])).find(Boolean) || id
  return { id, title, cols, rows }
}

function buildM1M2Tables(sheet: SheetSnapshot, query: string): M1M2TableBlock[] {
  const firstRow = sheet.cells[0] || []
  const headerRow = sheet.cells[1] || []
  const m2StartFromTitle = firstRow.findIndex((cell, index) => index > 0 && /M2|表2/.test(displayCellText(cell)))
  const itemColumns = headerRow
    .map((cell, index) => ({ index, text: compactText(displayCellText(cell)) }))
    .filter((cell) => cell.text === '项目')
    .map((cell) => cell.index)
  const m2Start = m2StartFromTitle >= 0 ? m2StartFromTitle : itemColumns[1]
  if (m2Start === undefined || m2Start <= 0) return []

  let m1End = 0
  headerRow.slice(0, m2Start).forEach((cell, index) => {
    if (displayCellText(cell)) m1End = Math.max(m1End, index)
  })
  const m2End = lastHeaderColumn(sheet, m2Start, m2Start + 4)

  return [
    buildM1M2Table(sheet, 'M1', Array.from({ length: m1End + 1 }, (_unused, index) => index), query),
    buildM1M2Table(sheet, 'M2', Array.from({ length: m2End - m2Start + 1 }, (_unused, index) => m2Start + index), query),
  ].filter((table) => table.cols.length > 0 && table.rows.length > 0)
}

function buildRatioTables(sheet: SheetSnapshot, query: string): RatioTableBlock[] {
  const lowerQuery = query.trim().toLowerCase()
  const titleRows = sheet.cells
    .map((row, index) => ({ index, title: displayCellText(row[0]) }))
    .filter((row) => /^\d+\./.test(compactText(row.title)))

  return titleRows
    .map((titleRow, tableIndex) => {
      const headerRow = sheet.cells[titleRow.index]
      const headerStart = headerRow.findIndex((cell, index) => index > 0 && displayCellText(cell))
      if (headerStart < 0) return undefined
      const headers: string[] = []
      for (let col = headerStart; col < headerRow.length; col += 1) {
        const text = displayCellText(headerRow[col])
        if (!text) break
        headers.push(text)
      }
      const visibleHeaders = headers.length > 2 ? headers.slice(0, 2) : headers
      const endIndex = titleRows[tableIndex + 1]?.index ?? sheet.cells.length
      const rows = sheet.cells
        .slice(titleRow.index + 1, endIndex)
        .map((row) => visibleHeaders.map((_header, offset) => displayCellText(row[headerStart + offset])))
        .filter((row) => row.some(Boolean))
        .filter((row) => !lowerQuery || [titleRow.title, ...row].join(' ').toLowerCase().includes(lowerQuery))
      if (!rows.length) return undefined
      return {
        id: `ratio-${tableIndex + 1}`,
        title: titleRow.title,
        headers: visibleHeaders.map(normalizeCurrentPeriodLabel),
        rows,
      }
    })
    .filter((table): table is RatioTableBlock => Boolean(table))
}

function buildDayOneLossTables(sheet: SheetSnapshot, query: string): StructuredTableBlock[] {
  const headerRowIndex = sheet.cells.findIndex((row) => row.some((cell) => compactText(displayCellText(cell)) === '账户'))
  if (headerRowIndex < 0) return []
  const headerRow = sheet.cells[headerRowIndex]
  const accountCol = headerRow.findIndex((cell) => compactText(displayCellText(cell)) === '账户')
  const currentPeriod = displayCellText(headerRow[accountCol + 1]) || '本期'
  const rows: string[][] = []
  for (let rowIndex = headerRowIndex + 1; rowIndex < sheet.cells.length; rowIndex += 1) {
    const account = displayCellText(sheet.cells[rowIndex]?.[accountCol])
    const value = positiveDisplayText(displayCellText(sheet.cells[rowIndex]?.[accountCol + 1]))
    if (!account) break
    rows.push([account === '首日亏损' ? '公司' : account, value])
  }
  const block = {
    id: 'day-one-loss-current',
    title: '首日亏损',
    subtitle: '当前会计期间，亏损金额以正数列示。',
    headers: ['账户', normalizeCurrentPeriodLabel(currentPeriod)],
    rows,
    amountUnit: 'wan' as const,
  }
  return [block].map((table) => filterStructuredRows(table, query)).filter((table): table is StructuredTableBlock => Boolean(table))
}

function buildInvestmentComponentTables(sheet: SheetSnapshot, query: string): StructuredTableBlock[] {
  const blocks: StructuredTableBlock[] = []
  sheet.cells.forEach((row, rowIndex) => {
    const periodCol = row.findIndex((cell) => /^\d{4,8}$/.test(compactText(displayCellText(cell))))
    if (periodCol < 0) return
    const headerRow = sheet.cells[rowIndex + 1]
    if (!headerRow || compactText(displayCellText(headerRow[periodCol + 1])) !== '保成') return
    if (blocks.length > 0) return
    const headers = ['项目', '保成', '投成', '投成拆分比例']
    const rows: string[][] = []
    for (let sourceRowIndex = rowIndex + 2; sourceRowIndex < sheet.cells.length; sourceRowIndex += 1) {
      const item = displayCellText(sheet.cells[sourceRowIndex]?.[periodCol])
      if (!item || /^\d{4,8}$/.test(compactText(item))) break
      const outputRow = [
        item,
        displayCellText(sheet.cells[sourceRowIndex]?.[periodCol + 1]),
        displayCellText(sheet.cells[sourceRowIndex]?.[periodCol + 2]),
        displayCellText(sheet.cells[sourceRowIndex]?.[periodCol + 3]),
      ]
      if (rowHasContent(outputRow)) rows.push(outputRow)
    }
    if (rows.length) {
      blocks.push({
        id: `investment-component-${blocks.length + 1}`,
        title: `投成拆分 ${normalizeCurrentPeriodLabel(displayCellText(row[periodCol]))}`,
        subtitle: '当前会计期间',
        headers,
        rows,
        amountUnit: 'yuan',
      })
    }
  })
  return blocks.map((table) => filterStructuredRows(table, query)).filter((table): table is StructuredTableBlock => Boolean(table))
}

function buildCurrentPeriodRollForwardTable(sheet: SheetSnapshot, query: string): StructuredTableBlock[] {
  const headerRowIndex = sheet.cells.findIndex((row) => compactText(displayCellText(row[2])) === '账户')
  if (headerRowIndex < 0) return []
  const period = displayCellText(sheet.cells[headerRowIndex - 1]?.[2]) || '本期'
  const headers: string[] = []
  for (let col = 2; col < sheet.cells[headerRowIndex].length; col += 1) {
    const header = displayCellText(sheet.cells[headerRowIndex][col])
    if (!header) break
    headers.push(header)
  }
  const rows: string[][] = []
  for (let rowIndex = headerRowIndex + 1; rowIndex < sheet.cells.length; rowIndex += 1) {
    const firstCell = displayCellText(sheet.cells[rowIndex]?.[2])
    if (!firstCell) break
    const row = headers.map((_header, offset) => displayCellText(sheet.cells[rowIndex]?.[2 + offset]))
    if (rowHasContent(row)) rows.push(row)
  }
  const block = {
    id: `rollforward-${sheet.name}`,
    title: sheet.name,
    subtitle: `${normalizeCurrentPeriodLabel(period)}，按账户展示滚转过程。`,
    headers,
    rows,
    amountUnit: 'yuan' as const,
  }
  return [block].map((table) => filterStructuredRows(table, query)).filter((table): table is StructuredTableBlock => Boolean(table))
}

function trimStructuredBlock(
  sheet: SheetSnapshot,
  id: string,
  title: string,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
  query: string,
  subtitle?: string,
  amountUnit: StructuredTableBlock['amountUnit'] = 'wan',
) {
  const rawRows = sheet.cells
    .slice(startRow, endRow + 1)
    .map((row) => Array.from({ length: endCol - startCol + 1 }, (_unused, offset) => displayCellText(row[startCol + offset])))
    .filter(rowHasContent)
  if (!rawRows.length) return undefined

  const usedCols = rawRows[0].map((_cell, index) => index).filter((index) => rawRows.some((row) => displayCellText({ display: row[index] } as CellSnapshot)))
  const rows = rawRows.map((row) => usedCols.map((col) => row[col]))
  const headers = rows[0]
  const body = rows.slice(1).filter(rowHasContent)
  if (!body.length) return undefined
  return filterStructuredRows({ id, title, subtitle, headers: headers.map(normalizeCurrentPeriodLabel), rows: body, amountUnit }, query)
}

function buildIfieCostTables(sheet: SheetSnapshot, query: string): StructuredTableBlock[] {
  const definitions: Array<[string, string, number, number, number, number, string?, StructuredTableBlock['amountUnit']?]> = [
    ['ifie-summary', '保险金融负债成本(IFIE)', 1, 9, 2, 12, '按公司及主要账户展示当期IFIE构成。', 'wan'],
    ['ifie-rate', '1. 负债计息率', 43, 62, 2, 8, '传统、分红、万能账户的计息率及相关拆分。', 'auto'],
    ['ifie-tvog', '2. TVOG', 65, 68, 2, 5, '万能及分红账户的TVOG期初、期末和变动。', 'yuan'],
    ['ifie-oci', '4. OCI', 72, 74, 2, 7, '计入其他综合收益的主要驱动。', 'yuan'],
    ['ifie-detail', 'IFIE细项拆分', 80, 94, 0, 5, '按层级展示计入损益的保险合同金融变动额明细。', 'wan'],
  ]
  return definitions
    .map(([id, title, startRow, endRow, startCol, endCol, subtitle, amountUnit]) =>
      trimStructuredBlock(sheet, id, title, startRow, endRow, startCol, endCol, query, subtitle, amountUnit),
    )
    .filter((table): table is StructuredTableBlock => Boolean(table))
}

function buildStructuredTables(sheet: SheetSnapshot, query: string, sheetMap?: Map<string, SheetSnapshot>): StructuredTableBlock[] {
  if (sheet.name === '0.I17利润拆解') return buildProfitBreakdownTables(sheet, query)
  if (sheet.name === '1.1 保险服务收入') return buildInsuranceRevenueTables(sheet, query, sheetMap)
  if (sheet.name === '1.4 首日亏损') return buildDayOneLossTables(sheet, query)
  if (sheet.name === '1.5 投成拆分') return buildInvestmentComponentTables(sheet, query)
  if (sheet.name === '1.6 损失摊销' || sheet.name === '1.7 获取费用摊销') return buildCurrentPeriodRollForwardTable(sheet, query)
  if (sheet.name === '2.1 保险金融负债成本') return buildIfieCostTables(sheet, query)
  return []
}

function buildCleanTableBlocks(sheet: SheetSnapshot, query: string): CleanTableBlock[] {
  const rows = buildCleanOutputRows(sheet, query)
  const blocks: CleanTableBlock[] = []
  let currentRows: CleanOutputRow[] = []

  rows.forEach((row) => {
    currentRows.push(row)
    if (shouldCloseCleanBlock(row)) {
      blocks.push({ id: `block-${blocks.length + 1}`, rows: currentRows })
      currentRows = []
    }
  })

  if (currentRows.length > 0) {
    blocks.push({ id: `block-${blocks.length + 1}`, rows: currentRows })
  }

  return blocks
}

function RatioOutputTables({ sheet, query }: { sheet: SheetSnapshot; query: string }) {
  const tables = buildRatioTables(sheet, query)
  if (!tables.length) {
    return (
      <div className="clean-empty-state">
        当前比例表没有可展示的最终结果行。
      </div>
    )
  }

  return (
    <div className="ratio-table-wrap">
      <div className="ratio-table-heading">风险调整</div>
      {tables.map((table) => (
        <section key={table.id} className="ratio-table-block">
          <h3>{table.title}</h3>
          <table className="ratio-output-table">
            <thead>
              <tr>
                {table.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.join('|')}>
                  {row.map((cell, index) => (
                    <td key={`${row.join('|')}-${index}`} className={index > 0 ? 'ratio-number-cell' : ''}>
                      {index > 0 ? formatTablePercent(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

function StructuredOutputTables({ sheet, query, sheetMap }: { sheet: SheetSnapshot; query: string; sheetMap?: Map<string, SheetSnapshot> }) {
  const tables = buildStructuredTables(sheet, query, sheetMap)
  if (!tables.length) {
    return (
      <div className="clean-empty-state">
        当前专题表没有可展示的最终结果行。
      </div>
    )
  }

  return (
    <div className="structured-table-wrap">
      {tables.map((table) => (
        <section key={table.id} className="structured-table-block">
          <div className="structured-table-title">
            <h3>{table.title}</h3>
            {table.subtitle ? <p>{table.subtitle}</p> : null}
          </div>
          <table className="structured-output-table">
            <thead>
              <tr>
                {table.headers.map((header, index) => (
                  <th key={`${table.id}-header-${index}`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${table.id}-row-${rowIndex}`}>
                  {table.headers.map((_header, cellIndex) => {
                    const text = formatStructuredCell(row[cellIndex] || '', _header, table.amountUnit || 'wan', cellIndex > 0)
                    const isNegative = /^\(|^-/.test(text)
                    const isTotalRow = /公司|合计|总计|保险金融负债成本|保险服务业绩|理赔总计|TVOG变动/.test(compactText(row[0] || ''))
                    return (
                      <td
                        key={`${table.id}-row-${rowIndex}-${cellIndex}`}
                        className={[
                          cellIndex > 0 ? 'structured-number-cell' : '',
                          isNegative ? 'negative-cell' : '',
                          isTotalRow ? 'structured-total-cell' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

function M1M2OutputTables({ sheet, query }: { sheet: SheetSnapshot; query: string }) {
  const tables = buildM1M2Tables(sheet, query)
  if (!tables.length) {
    return (
      <div className="clean-empty-state">
        当前 M1/M2 表没有可展示的最终结果行。
      </div>
    )
  }

  return (
    <div className="m1m2-table-grid">
      {tables.map((table) => (
        <table key={table.id} className="m1m2-output-table">
          <thead>
            <tr className="m1m2-title-row">
              <th colSpan={table.cols.length}>{table.title}</th>
            </tr>
            {table.rows.slice(1, 3).map((row, rowIndex) => (
              <tr key={`${table.id}-header-${rowIndex}`} className="m1m2-header-row">
                {table.cols.map((col) => (
                  <th key={`${table.id}-header-${rowIndex}-${col}`}>
                    {displayCellText(row[col])}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.rows.slice(3).map((row, rowIndex) => (
              <tr key={`${table.id}-row-${rowIndex}`}>
                {table.cols.map((col, colIndex) => {
                  const text = displayCellText(row[col])
                  const isNumberColumn = colIndex > 1
                  const outputText = isNumberColumn ? formatStructuredCell(text, '', 'yuan', true) : text
                  const isTotalRow = /合计|余额|保险服务业绩|计入综合收益/.test(compactText(displayCellText(row[table.cols[0]])))
                  return (
                    <td
                      key={`${table.id}-row-${rowIndex}-${col}`}
                      className={[
                        isNumberColumn ? 'm1m2-number-cell' : '',
                        /^\(|^-/.test(outputText) ? 'negative-cell' : '',
                        isTotalRow ? 'm1m2-total-cell' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {outputText}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

function CleanOutputTable({ sheet, query, sheetMap }: { sheet: SheetSnapshot; query: string; sheetMap?: Map<string, SheetSnapshot> }) {
  if (sheet.category === 'm1m2') {
    return <M1M2OutputTables sheet={sheet} query={query} />
  }
  if (sheet.name === '1.3 RA') {
    return <RatioOutputTables sheet={sheet} query={query} />
  }
  if (['0.I17利润拆解', '1.1 保险服务收入', '1.4 首日亏损', '1.5 投成拆分', '1.6 损失摊销', '1.7 获取费用摊销', '2.1 保险金融负债成本'].includes(sheet.name)) {
    return <StructuredOutputTables sheet={sheet} query={query} sheetMap={sheetMap} />
  }

  const blocks = buildCleanTableBlocks(sheet, query)
  const rows = blocks.flatMap((block) => block.rows)
  const maxValues = Math.max(1, ...rows.map((row) => row.values.length))
  const headers = cleanHeadersForSheet(sheet.name, maxValues)
  if (rows.length === 0) {
    return (
      <div className="clean-empty-state">
        当前报表没有可展示的最终结果行。
      </div>
    )
  }

  const lowerQuery = query.trim().toLowerCase()

  return (
    <div className="clean-table-wrap">
      {blocks.map((block) => (
        <table key={block.id} className="clean-output-table">
          <colgroup>
            <col className="clean-output-col-label" />
            {headers.map((header) => (
              <col key={header} className="clean-output-col-value" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th>项目</th>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr
                key={`${block.id}-${row.label}`}
                className={[lowerQuery ? 'is-search-result' : '', `row-${row.kind}`, `row-level-${row.level}`]
                  .filter(Boolean)
                  .join(' ')}
              >
                <td>{row.label}</td>
                {headers.map((header, index) => {
                  const value = row.values[index]
                  return (
                    <td key={header} className={Number(value) < 0 ? 'negative-cell' : ''}>
                      {value === undefined ? '' : formatWanAmount(value)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

type ReportVisualKind = 'amount-bar' | 'percent-bar' | 'pie' | 'waterfall'

type ReportVisualContext = {
  kind: ReportVisualKind
  rows: Array<{ name: string; value: number; share?: number; labelText?: string; range?: [number, number]; endpoint?: boolean }>
  metricRows: Array<{ name: string; value: number }>
}

function buildReportVisualContext(section: ReportSection, sheetMap: Map<string, SheetSnapshot>, filters: FilterState): ReportVisualContext {
  const profitSheet = sheetMap.get('I17利润表')
  const insuranceServiceSheet = sheetMap.get('1. 保险服务业绩')
  const csmSheet = sheetMap.get('1.2 CSM')
  const ifieSheet = sheetMap.get('2.1 保险金融负债成本')
  const soeSheet = sheetMap.get('现行vsI17_利源分析')

  if (section.sheet === 'I17利润表' || section.sheet === '0.I17利润拆解') {
    const rows = buildProfitStatementMain(profitSheet, filters).map((row) => ({
      name: row.name,
      value: row.value,
      labelText: formatChartAmount(row.value),
    }))
    return { kind: 'amount-bar', rows, metricRows: rows.slice(0, 3) }
  }

  if (section.sheet === '1. 保险服务业绩') {
    const denominator =
      resultValue(insuranceServiceSheet, ['保险利润合计'], filters) ||
      resultValue(profitSheet, ['保险服务业绩合计'], filters)
    const rows = withSignedContribution(
      buildInsuranceProfitContribution(profitSheet, insuranceServiceSheet, filters),
      denominator,
    )
    return { kind: 'amount-bar', rows, metricRows: rows.slice(0, 3) }
  }

  if (section.sheet === '1.1 保险服务收入') {
    const rows = withShares(buildRevenueComposition(profitSheet, filters))
    return { kind: 'percent-bar', rows, metricRows: rows.slice(0, 3) }
  }

  if (section.sheet === '1.2 CSM') {
    const rows = buildCsmMovement(csmSheet, filters).map((row) => ({
      ...row,
      labelText: formatChartAmount(row.value),
    }))
    return { kind: 'amount-bar', rows, metricRows: rows.filter((row) => ['期初', '新单', '期末'].includes(row.name)) }
  }

  if (section.sheet === '1.4 首日亏损') {
    const rows = withShares(
      longTermAccountRows(buildAccountDistribution(profitSheet, ['首日亏损'], filters)).map((row) => ({
        name: row.account,
        value: Math.abs(row.value),
      })),
    )
    return { kind: 'amount-bar', rows, metricRows: rows.slice(0, 3) }
  }

  if (section.sheet === '2. 投资服务业绩') {
    const rows = buildInvestmentServiceRows(profitSheet, filters).map((row) => ({
      ...row,
      labelText: formatChartAmount(row.value),
    }))
    return { kind: 'amount-bar', rows, metricRows: rows }
  }

  if (section.sheet === '2.1 保险金融负债成本') {
    const rows = buildMetricSeriesForFilter(ifieSheet, ['BEL计息成本', 'UI投资收益成本', 'CSM计息成本', '保单贷款、累积生息、TVOG释放', '其他'], filters)
      .map((row) => ({ ...row, value: Math.abs(row.value) }))
      .filter((row) => row.value !== 0)
    return { kind: 'pie', rows, metricRows: rows.slice(0, 3) }
  }

  if (section.sheet === '现行vsI17_利源分析') {
    const rows = buildSoeWaterfall(soeSheet)
    return { kind: 'waterfall', rows, metricRows: rows.filter((row) => row.endpoint) }
  }

  const fallbackSheet = sheetMap.get(section.sheet)
  const fallbackRows = fallbackSheet ? buildCleanOutputRows(fallbackSheet, '') : []
  return {
    kind: 'amount-bar',
    rows: fallbackRows
    .slice(0, 6)
    .map((row) => ({ name: row.label, value: row.values[0] || 0, labelText: formatChartAmount(row.values[0] || 0) })),
    metricRows: fallbackRows.slice(0, 3).map((row) => ({ name: row.label, value: row.values[0] || 0 })),
  }
}

function ReportVisual({ context }: { context: ReportVisualContext }) {
  if (!context.rows.length) return <div className="empty-chart">暂无数值摘要</div>

  if (context.kind === 'pie') {
    return (
      <KpmgPieWithLabels
        data={context.rows.map((row) => ({
          name: row.name,
          value: Math.abs(row.value),
          labelText: row.labelText,
        }))}
      />
    )
  }

  if (context.kind === 'percent-bar') {
    return (
      <ResponsiveContainer width="100%" height={270}>
        <BarChart data={context.rows} margin={{ top: 24, right: 12, bottom: 48, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" />
          <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={(value) => percentFormatter.format(Number(value))} />
          <Tooltip
            formatter={(_value, _name, item) => {
              const payload = item.payload as { value: number; share?: number }
              return [`${percentFormatter.format(payload.share || 0)} / ${formatTooltipAmount(payload.value)}`, '占比 / 金额']
            }}
          />
          <Bar dataKey="share" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="labelText" content={BarTextLabel} />
            {context.rows.map((row, index) => (
              <Cell key={row.name} fill={row.value >= 0 ? chartPalette[index % chartPalette.length] : kpmgColor.magenta} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (context.kind === 'waterfall') {
    return (
      <ResponsiveContainer width="100%" height={290}>
        <BarChart data={context.rows} margin={{ top: 24, right: 12, bottom: 58, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-22} textAnchor="end" height={72} />
          <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
          <Tooltip
            formatter={(_value, _name, item) => {
              const payload = item.payload as { value: number }
              return [formatTooltipAmount(payload.value), '差异金额']
            }}
          />
          <Bar dataKey="range" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="labelText" content={WaterfallTextLabel} />
            {context.rows.map((row) => (
              <Cell key={row.name} fill={row.endpoint ? kpmgColor.navy : row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={270}>
      <BarChart data={context.rows} margin={{ top: 24, right: 12, bottom: 48, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
        <Tooltip formatter={formatTooltipAmount} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="labelText" content={BarTextLabel} />
          {context.rows.map((row) => (
            <Cell key={row.name} fill={row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function ReportPage({
  section,
  sheetMap,
  filters,
  comment,
  onCommentChange,
  editable = true,
}: {
  section: ReportSection
  sheetMap: Map<string, SheetSnapshot>
  filters: FilterState
  comment: string
  onCommentChange: (value: string) => void
  editable?: boolean
}) {
  const visualContext = buildReportVisualContext(section, sheetMap, filters)
  const metricRows = visualContext.metricRows.slice(0, 3)
  const finalComment = comment.trim() || section.commentHint

  return (
    <section className="report-page">
      <div className="report-page-copy">
        <span className="eyebrow">Management Report</span>
        <h2>{section.title}</h2>
        <p>{section.question}</p>
        {metricRows.length > 0 ? (
          <div className="metric-strip">
            {metricRows.map((row) => (
              <div key={row.name}>
                <small>{row.name}</small>
                <strong>{formatWanAmount(row.value)}</strong>
                <span>单位：百万元</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="report-visual">
        <ReportVisual context={visualContext} />
      </div>
      <div className="report-comment">
        <h3>分析结论</h3>
        <p>{finalComment}</p>
      </div>
      {editable ? (
        <details className="comment-box report-edit-panel">
          <summary>编辑本页分析话术</summary>
          <textarea
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder={section.commentHint}
          />
          <div className="phrase-row">
            {reportPhraseLibrary.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => onCommentChange(comment ? `${comment}\n${phrase}` : phrase)}
              >
                {phrase}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function DashboardCard({
  title,
  subtitle,
  children,
  action,
  className,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section className={`dashboard-card${className ? ` ${className}` : ''}`}>
      <div className="card-title-row">
        <div>
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function DashboardSection({ step, title, subtitle }: { step: string; title: string; subtitle: string }) {
  return (
    <section className="dashboard-section">
      <span>{step}</span>
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </section>
  )
}

function labelGeometry(props: any) {
  const viewBox = props.viewBox || {}
  const numberOr = (value: unknown, fallback = 0) => {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }
  const x = numberOr(props.x, numberOr(viewBox.x))
  const y = numberOr(props.y, numberOr(viewBox.y))
  const width = Math.abs(numberOr(props.width, numberOr(viewBox.width)))
  const height = Math.abs(numberOr(props.height, numberOr(viewBox.height)))
  return { x, y, width, height }
}

function labelPosition(props: any, numericValue: number) {
  const { y, height } = labelGeometry(props)
  if (numericValue === 0) return Number.NaN
  if (numericValue < 0) {
    const offset = height > 0 && height < 80 ? Math.min(34, height + 10) : 18
    return y + offset
  }
  return Math.max(12, y - 8)
}

function labelNumericValue(props: any, value: unknown) {
  const candidates = [props.payload?.value, props.payload?.share, props.payload?.rate, value]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
    const text = String(candidate ?? '').trim()
    if (!text) continue
    const match = text.match(/-?[\d,]+(?:\.\d+)?%?/)
    if (!match) continue
    const parsed = Number(match[0].replace(/,/g, '').replace('%', ''))
    if (Number.isFinite(parsed)) return match[0].endsWith('%') ? parsed / 100 : parsed
  }
  return Number.NaN
}

function BarTextLabel(props: any) {
  const { value, payload } = props
  if (value === undefined || value === null || value === '') return null
  const numericValue = labelNumericValue(props, value)
  if (!Number.isFinite(numericValue)) return null
  const { x, width } = labelGeometry(props)
  const textY = labelPosition(props, numericValue)
  if (!Number.isFinite(textY)) return null
  const label = payload?.labelText || (typeof value === 'number' ? formatChartAmount(value) : String(value))
  return (
    <text
      x={x + width / 2}
      y={textY}
      textAnchor="middle"
      dominantBaseline="auto"
      fill={numericValue >= 0 ? kpmgColor.blue : kpmgColor.magenta}
      fontSize={11}
      fontWeight={700}
      stroke="#ffffff"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {label}
    </text>
  )
}

function PercentTextLabel(props: any) {
  const { value } = props
  if (value === undefined || value === null || value === '') return null
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return null
  const { x, width } = labelGeometry(props)
  const textY = labelPosition(props, numericValue)
  if (!Number.isFinite(textY)) return null
  return (
    <text
      x={x + width / 2}
      y={textY}
      textAnchor="middle"
      dominantBaseline="auto"
      fill={numericValue >= 0 ? kpmgColor.blue : kpmgColor.magenta}
      fontSize={11}
      fontWeight={700}
      stroke="#ffffff"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {percentFormatter.format(numericValue)}
    </text>
  )
}

function WaterfallTextLabel(props: any) {
  const { value } = props
  if (value === undefined || value === null || value === '') return null
  const numericValue = labelNumericValue(props, value)
  if (!Number.isFinite(numericValue)) return null
  const { x, width } = labelGeometry(props)
  const textY = labelPosition(props, numericValue)
  if (!Number.isFinite(textY)) return null
  return (
    <text
      x={x + width / 2}
      y={textY}
      textAnchor="middle"
      dominantBaseline="auto"
      fill={numericValue >= 0 ? kpmgColor.blue : kpmgColor.magenta}
      fontSize={11}
      fontWeight={700}
      stroke="#ffffff"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {String(value)}
    </text>
  )
}

function TaxRateTextLabel(props: any) {
  const { payload, taxRate, index, value } = props
  const labelName = String(payload?.name ?? payload?.label ?? '')
  const numericValue = labelNumericValue(props, value)
  const isTaxBar = labelName === '所得税' || index === 1 || numericValue < 0
  if (!isTaxBar || !Number.isFinite(taxRate) || taxRate <= 0) return null
  const { x, y, width } = labelGeometry(props)
  const labelY = Math.max(12, y - 22)
  return (
    <text
      x={x + width / 2}
      y={labelY}
      textAnchor="middle"
      fill={kpmgColor.magenta}
      fontSize={12}
      fontWeight={800}
      stroke="#ffffff"
      strokeWidth={3}
      paintOrder="stroke"
    >
      税率：{percentFormatter.format(taxRate || 0)}
    </text>
  )
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle - 90) * (Math.PI / 180)
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  }
}

function pieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarPoint(cx, cy, radius, startAngle)
  const end = polarPoint(cx, cy, radius, endAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
}

function distributeLabelYs(labels: Array<{ desiredY: number }>, minY: number, maxY: number, minGap = 24) {
  if (!labels.length) return []
  const ys = labels.map((label) => Math.min(maxY, Math.max(minY, label.desiredY)))
  for (let index = 1; index < ys.length; index += 1) {
    ys[index] = Math.max(ys[index], ys[index - 1] + minGap)
  }
  for (let index = ys.length - 2; index >= 0; index -= 1) {
    ys[index] = Math.min(ys[index], ys[index + 1] - minGap)
  }
  return ys.map((y) => Math.min(maxY, Math.max(minY, y)))
}

function KpmgPieWithLabels({
  data,
  legendNameKey = 'name',
}: {
  data: PieLabelDatum[]
  legendNameKey?: keyof PieLabelDatum
}) {
  const normalized = data
    .map((row) => ({ ...row, value: Math.abs(row.value) }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0)
  if (!normalized.length) return <div className="empty-chart">暂无数值摘要</div>

  const total = normalized.reduce((sum, row) => sum + row.value, 0) || 1
  const cx = 380
  const cy = 138
  const radius = 94
  const rawSweeps = normalized.map((row) => (row.value / total) * 360)
  const minSweep = 9
  const smallSweepTotal = rawSweeps.reduce((sum, sweep) => sum + (sweep > 0 && sweep < minSweep ? minSweep : 0), 0)
  const largeSweepTotal = rawSweeps.reduce((sum, sweep) => sum + (sweep >= minSweep ? sweep : 0), 0)
  const largeScale = largeSweepTotal > 0 ? Math.max(0, 360 - smallSweepTotal) / largeSweepTotal : 1
  const displaySweeps = rawSweeps.map((sweep) => (sweep > 0 && sweep < minSweep ? minSweep : sweep * largeScale))
  let cursor = 0
  const slices = normalized.map((row, index) => {
    const startAngle = cursor
    const sweep = displaySweeps[index]
    const endAngle = cursor + sweep
    cursor = endAngle
    const midAngle = startAngle + sweep / 2
    const rightSide = midAngle <= 180
    const outer = polarPoint(cx, cy, radius, midAngle)
    const labelName = row.name.length > 12 ? `${row.name.slice(0, 11)}...` : row.name
    const labelText = row.labelText || `${formatChartAmount(row.value)} (${percentFormatter.format(row.value / total)})`
    return {
      ...row,
      color: row.color || accountColorMap[row.name] || chartPalette[index % chartPalette.length],
      endAngle,
      labelName,
      labelText,
      midAngle,
      outer,
      path: pieSlicePath(cx, cy, radius, startAngle, endAngle),
      rightSide,
      startAngle,
    }
  })

  const left = slices
    .filter((slice) => !slice.rightSide)
    .sort((a, b) => a.outer.y - b.outer.y)
  const right = slices
    .filter((slice) => slice.rightSide)
    .sort((a, b) => a.outer.y - b.outer.y)
  const labelMinY = 32
  const labelMaxY = 238
  const leftYs = distributeLabelYs(left.map((slice) => ({ desiredY: slice.outer.y })), labelMinY, labelMaxY, 28)
  const rightYs = distributeLabelYs(right.map((slice) => ({ desiredY: slice.outer.y })), labelMinY, labelMaxY, 28)
  const labelYByName = new Map<string, number>()
  left.forEach((slice, index) => labelYByName.set(slice.name, leftYs[index]))
  right.forEach((slice, index) => labelYByName.set(slice.name, rightYs[index]))

  return (
    <div className="labeled-pie-wrap">
      <svg className="labeled-pie" viewBox="0 0 760 276" role="img" aria-label="饼图">
        {slices.map((slice) => (
          <path key={slice.name} d={slice.path} fill={slice.color} stroke="#ffffff" strokeWidth={2}>
            <title>
              {slice.name} {slice.labelText}
            </title>
          </path>
        ))}
        {slices.map((slice) => {
          const y = labelYByName.get(slice.name) ?? slice.outer.y
          const textX = slice.rightSide ? 506 : 254
          const elbowX = slice.rightSide ? 474 : 286
          const anchor = slice.rightSide ? 'start' : 'end'
          return (
            <g key={`${slice.name}-label`}>
              <path
                d={`M ${slice.outer.x} ${slice.outer.y} L ${elbowX} ${y} L ${slice.rightSide ? textX - 5 : textX + 5} ${y}`}
                fill="none"
                stroke={slice.color}
                strokeWidth={1}
              />
              <text
                x={textX}
                y={y + 4}
                textAnchor={anchor}
                fill={slice.color}
                fontSize={12}
                fontWeight={800}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {slice.labelName} {slice.labelText}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="chart-footnote chart-footnote--pie">
        {slices.map((slice) => (
          <span key={`${slice.name}-legend`}>
            <b className="legend-dot" style={{ background: slice.color }} />
            {String(slice[legendNameKey])}
          </span>
        ))}
      </div>
    </div>
  )
}

function UnavailableData({ message = '暂未上传数据' }: { message?: string }) {
  return (
    <div className="unavailable-data">
      <span>{message}</span>
    </div>
  )
}

function ManagementDashboard({
  sheetMap,
  filters,
  onOpenSheet,
}: {
  sheetMap: Map<string, SheetSnapshot>
  filters: FilterState
  onOpenSheet: (sheet: string) => void
}) {
  const profitSheet = sheetMap.get('I17利润表')
  const insuranceServiceSheet = sheetMap.get('1. 保险服务业绩')
  const csmSheet = sheetMap.get('1.2 CSM')
  const ifieSheet = sheetMap.get('2.1 保险金融负债成本')
  const finSheet = sheetMap.get('利润表fromfin')
  const soeSheet = sheetMap.get('现行vsI17_利源分析')

  const filterLabel = selectedFilterLabel(filters)

  const profitBridge = buildProfitStatementMain(profitSheet, filters)
  const hasFilteredAccountScope = hasAccountFilter(filters)

  const insuranceMix = buildInsuranceProfitContribution(profitSheet, insuranceServiceSheet, filters)
  const revenueMix = buildRevenueComposition(profitSheet, filters)
  const revenueMixShares = withSignedShareOfTotal(
    revenueMix,
    resultValue(profitSheet, ['保险服务收入合计', '保险服务收入'], filters),
  )
  const csmMovement = buildCsmMovement(csmSheet, filters)
  const ifieCost = buildMetricSeriesForFilter(ifieSheet, ['BEL计息成本', 'UI投资收益成本', 'CSM计息成本', '保单贷款、累积生息、TVOG释放', '其他'], filters)
  const investmentBars = buildInvestmentServiceRows(profitSheet, filters)
  const soeWaterfall = buildSoeWaterfall(soeSheet)
  const csmByAccount = withShares(buildCsmClosingByAccount(csmSheet, filters))
  const revenueByAccount = withShares(buildAccountDistribution(profitSheet, ['保险服务收入合计', '保险服务收入'], filters))
  const insuranceByAccount = withShares(buildAccountDistribution(profitSheet, ['保险服务业绩合计', '保险服务业绩'], filters))
  const firstDayLossByAccount = withShares(
    longTermAccountRows(buildAccountDistribution(profitSheet, ['首日亏损'], filters))
      .map((row) => ({ ...row, value: Math.abs(row.value) })),
  )
  const onerousMovementRows = longTermAccountRows(buildAccountDistribution(profitSheet, ['亏损加剧/转回', '亏损加剧与转回'], filters))
  const onerousMovementByAccount = withSignedShareOfTotal(
    onerousMovementRows,
    resultValue(profitSheet, ['亏损加剧/转回', '亏损加剧与转回'], filters) ||
      onerousMovementRows.reduce((sum, row) => sum + row.value, 0),
  )
  const investmentByAccount = withShares(longTermAccountRows(buildAccountDistribution(profitSheet, ['投资收益'], filters)))
  const ifieByAccount = withShares(
    buildAccountDistribution(profitSheet, ['保险金融负债成本', '计入损益的保险合同金融变动额'], filters)
      .map((row) => ({ ...row, value: Math.abs(row.value) })),
  )
  const expenseDrivers = buildInsuranceExpenseDrivers(profitSheet, filters)
  const csmRatioRows = buildCsmAmortizationRateRows(csmSheet, filters)
  const paaRevenueSplit = buildPaaRevenueSplit(profitSheet, filters)
  const insuranceProfitContribution = withSignedContribution(
    insuranceMix,
    resultValue(insuranceServiceSheet, ['保险利润合计'], filters) || resultValue(profitSheet, ['保险服务业绩合计'], filters),
  )
  const csmNbProfitabilityRows = buildCsmNbProfitabilityRows(csmSheet, filters)
  const csmInterestRateRows = buildCsmInterestRateRows(csmSheet, filters)
  const taxBridge = buildTaxBridge(profitSheet)
  const taxBridgeWithLabels = withLabelText(taxBridge)
  const taxRate = buildTaxRate(profitSheet)
  const ociBridge = buildOciBridge(profitSheet)
  const ociBridgeWithLabels = withLabelText(ociBridge)
  const valueReserveRows = buildValueReserveRows(finSheet, csmSheet)

  return (
    <div className="dashboard-grid">
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow">Management Dashboard</span>
          <h2>公司 IFRS17 经营分析</h2>
          <p>
            基于已计算结果，按管理层视角展示利润、保险服务业绩、投资服务业绩、CSM/IFIE 和利源差异。
          </p>
          <div className="filter-context">当前筛选：{filterLabel}</div>
        </div>
      </section>

      <DashboardSection
        step="01"
        title="利润总览"
        subtitle="先看利润表主线，再向保险服务收入、保险费用和投资服务展开。"
      />

      <DashboardCard
        title="利润表主线"
        subtitle={`来源：I17利润表；单位：百万元。${hasFilteredAccountScope ? '账户筛选只影响可分账户项目，公司层级项目不做分摊。' : '公司口径展示。'}`}
        action={<button onClick={() => onOpenSheet('I17利润表')}>查看报表</button>}
        className="dashboard-card--wide"
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={profitBridge} margin={{ top: 30, right: 16, bottom: 68, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="value" content={BarTextLabel} />
              {profitBridge.map((row) => (
                <Cell
                  key={row.name}
                  fill={!row.accountLevel ? kpmgColor.slate : row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="chart-footnote">
          <span><b className="legend-dot legend-dot--account" />可分账户项目</span>
          <span><b className="legend-dot legend-dot--company" />公司层级项目</span>
        </div>
      </DashboardCard>

      <DashboardSection
        step="02"
        title="保险业务收入"
        subtitle="对应 PPT 的保险业务收入页：看当前筛选口径的构成，也看账户占比。"
      />

      <DashboardCard
        title="保险服务收入按账户"
        subtitle="全集视角：各账户对收入的贡献"
        action={<button onClick={() => onOpenSheet('I17利润表')}>收入追溯</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={revenueByAccount} margin={{ top: 30, right: 12, bottom: 34, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="account" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={kpmgColor.blue}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="保险服务收入明细占比"
        subtitle="来源：1.1 保险服务收入；按当前筛选口径对收入合计的贡献占比展示"
        action={<button onClick={() => onOpenSheet('1.1 保险服务收入')}>收入表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={revenueMixShares} margin={{ top: 30, right: 12, bottom: 72, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={(value) => percentFormatter.format(Number(value))} />
            <Tooltip
              formatter={(_value, _name, item) => {
                const payload = item.payload as { value: number; share: number }
                return [`${percentFormatter.format(payload.share)} / ${formatTooltipAmount(payload.value)}`, '占比 / 金额']
              }}
            />
            <Bar dataKey="share" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
              {revenueMixShares.map((row, index) => (
                <Cell key={row.name} fill={row.value >= 0 ? chartPalette[index % chartPalette.length] : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="PAA / 非PAA 收入结构"
        subtitle="对应上市公司报告中的保险业务收入构成视角"
        action={<button onClick={() => onOpenSheet('I17利润表')}>收入来源</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <PieChart>
            <Pie
              data={paaRevenueSplit}
              dataKey="value"
              nameKey="name"
              innerRadius={56}
              outerRadius={92}
              paddingAngle={2}
              label={({ name, value, percent }) => `${name} ${formatChartAmount(value)} (${percentFormatter.format(Number(percent || 0))})`}
            >
              {paaRevenueSplit.map((row, index) => (
                <Cell key={row.name} fill={chartPalette[index % chartPalette.length]} />
              ))}
            </Pie>
            <Tooltip formatter={formatTooltipAmount} />
          </PieChart>
        </ResponsiveContainer>
        <div className="chart-footnote chart-footnote--account-order">
          {paaRevenueSplit.map((row, index) => (
            <span key={row.name}>
              <b className="legend-dot" style={{ background: chartPalette[index % chartPalette.length] }} />
              {row.name}
            </span>
          ))}
        </div>
      </DashboardCard>

      <DashboardSection
        step="03"
        title="保险服务业绩"
        subtitle="对应 PPT 的保险服务业绩和首日亏损页：先看业绩构成，再看亏损 driver。"
      />

      <DashboardCard
        title="保险服务业绩构成"
        subtitle="CSM、RA、经验偏差、费用偏差等项目"
        action={<button onClick={() => onOpenSheet('1. 保险服务业绩')}>查看明细</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={insuranceProfitContribution} margin={{ top: 30, right: 12, bottom: 72, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
              {insuranceProfitContribution.map((row) => (
                <Cell key={row.name} fill={row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="保险服务业绩按账户"
        subtitle="全集视角：账户对保险服务业绩的正负贡献"
        action={<button onClick={() => onOpenSheet('1. 保险服务业绩')}>业绩表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={insuranceByAccount} margin={{ top: 30, right: 12, bottom: 34, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="account" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
              {insuranceByAccount.map((row) => (
                <Cell key={row.account} fill={row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="首日亏损按账户"
        subtitle="新业务亏损按账户拆解，按亏损绝对值展示"
        action={<button onClick={() => onOpenSheet('1.4 首日亏损')}>亏损表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={firstDayLossByAccount} margin={{ top: 30, right: 12, bottom: 34, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="account" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={kpmgColor.magenta}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="亏损加剧/转回按账户"
        subtitle="亏损部分后续变动单独展示：正数代表亏损转回、增加利润；负数代表亏损加剧、减少利润"
        action={<button onClick={() => onOpenSheet('1.4 首日亏损')}>亏损表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={onerousMovementByAccount} margin={{ top: 30, right: 12, bottom: 42, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="account" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
              {onerousMovementByAccount.map((row) => (
                <Cell key={row.account} fill={row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="保险服务费用构成"
        subtitle="实际赔付、实际维持费用、损失摊销、获取费用、亏损部分等项目"
        action={<button onClick={() => onOpenSheet('1.7 获取费用摊销')}>费用表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={expenseDrivers} margin={{ top: 34, right: 12, bottom: 76, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
              {expenseDrivers.map((row) => (
                <Cell key={row.name} fill={row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardSection
        step="04"
        title="CSM 与摊销率"
        subtitle="承接保险服务收入，继续解释 CSM 余额、滚转和释放。"
      />

      <DashboardCard
        title="CSM 按账户分布"
        subtitle="评估时点期末余额按账户拆分"
        action={<button onClick={() => onOpenSheet('1.2 CSM')}>CSM sheet</button>}
      >
        <KpmgPieWithLabels
          data={csmByAccount.map((row) => ({
            name: row.account,
            value: row.value,
            labelText: row.labelText,
            color: accountColorMap[row.account],
          }))}
        />
      </DashboardCard>

      <DashboardCard
        title="CSM 滚转"
        subtitle="期初、新单、计息、调整、释放、期末"
        action={<button onClick={() => onOpenSheet('1.2 CSM')}>CSM sheet</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={csmMovement} margin={{ top: 30, right: 12, bottom: 44, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-14} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="value" content={BarTextLabel} />
              {csmMovement.map((row) => (
                <Cell key={row.name} fill={row.value >= 0 ? kpmgColor.navy : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="CSM 摊销率分析"
        subtitle="CSM释放绝对值 /（期末CSM - CSM释放）"
        action={<button onClick={() => onOpenSheet('1.2 CSM')}>摊销率表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={csmRatioRows} margin={{ top: 30, right: 18, bottom: 42, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={(value) => percentFormatter.format(Number(value))} />
            <Tooltip formatter={(value) => percentFormatter.format(Number(value))} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={kpmgColor.navy}>
              <LabelList dataKey="value" content={PercentTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="NB 盈利性"
        subtitle="CSM0 / PV PREM0，来源：1.2 CSM"
        action={<button onClick={() => onOpenSheet('1.2 CSM')}>CSM 表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={csmNbProfitabilityRows} margin={{ top: 30, right: 18, bottom: 42, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={(value) => percentFormatter.format(Number(value))} />
            <Tooltip formatter={(value) => percentFormatter.format(Number(value))} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={kpmgColor.navy}>
              <LabelList dataKey="value" content={PercentTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="CSM 计息率"
        subtitle="计息率，来源：1.2 CSM"
        action={<button onClick={() => onOpenSheet('1.2 CSM')}>CSM 表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={csmInterestRateRows} margin={{ top: 30, right: 18, bottom: 42, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={(value) => percentFormatter.format(Number(value))} />
            <Tooltip formatter={(value) => percentFormatter.format(Number(value))} />
            <Bar dataKey="rate" name="计息率" radius={[4, 4, 0, 0]} fill={kpmgColor.blue}>
              <LabelList dataKey="rate" content={PercentTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardSection
        step="05"
        title="投资服务业绩与 IFIE"
        subtitle="对应 PPT 的投资服务业绩和保险金融负债成本页。"
      />

      <DashboardCard
        title="投资服务业绩"
        subtitle="投资收益、保险金融负债成本和投资利润"
        action={<button onClick={() => onOpenSheet('2. 投资服务业绩')}>投资服务</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={investmentBars} margin={{ top: 30, right: 12, bottom: 58, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="value" content={BarTextLabel} />
              {investmentBars.map((row) => (
                <Cell key={row.name} fill={row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="净投资收益、总投资收益、综合投资收益"
        action={<button onClick={() => onOpenSheet('利润表fromfin')}>财务输入</button>}
      >
        <UnavailableData />
      </DashboardCard>

      <DashboardCard
        title="投资收益按账户"
        subtitle="全集视角：投资收益账户贡献"
        action={<button onClick={() => onOpenSheet('2. 投资服务业绩')}>投资表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={investmentByAccount} margin={{ top: 30, right: 12, bottom: 34, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="account" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={kpmgColor.blue}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="金融资产分类结构"
        subtitle="从财务输入表读取金融投资分类，解释投资收益和 OCI 波动基础"
        action={<button onClick={() => onOpenSheet('利润表fromfin')}>资产表</button>}
      >
        <UnavailableData />
      </DashboardCard>

      <DashboardCard
        title="保险金融负债成本拆分"
        subtitle="BEL、UI、CSM 计息等 IFIE driver"
        action={<button onClick={() => onOpenSheet('2.1 保险金融负债成本')}>IFIE sheet</button>}
      >
        <KpmgPieWithLabels
          data={ifieCost
            .map((row, index) => ({ name: row.name, value: Math.abs(row.value), color: chartPalette[index % chartPalette.length] }))
            .filter((row) => row.value !== 0)}
        />
      </DashboardCard>

      <DashboardCard
        title="IFIE 按账户"
        subtitle="全集视角：保险金融负债成本账户分布"
        action={<button onClick={() => onOpenSheet('2.1 保险金融负债成本')}>IFIE 表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={ifieByAccount} margin={{ top: 30, right: 12, bottom: 34, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="account" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={kpmgColor.purple}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardSection
        step="06"
        title="资本、价值与 OCI"
        subtitle="补充上市公司报告中的税负、综合收益、净资产与 CSM 储备视角。"
      />

      <DashboardCard
        title="税前利润、所得税与净利润"
        subtitle="公司口径"
        action={<button onClick={() => onOpenSheet('I17利润表')}>利润表</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={taxBridgeWithLabels} margin={{ top: 42, right: 12, bottom: 54, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
              <LabelList dataKey="value" content={(props) => <TaxRateTextLabel {...props} taxRate={taxRate} />} />
              {taxBridgeWithLabels.map((row) => (
                <Cell key={row.name} fill={row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="净利润到综合收益"
        subtitle="公司口径：净利润 + 税后负债 OCI + 税后资产 OCI = 综合收益"
        action={<button onClick={() => onOpenSheet('I17利润表')}>OCI 明细</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={ociBridgeWithLabels} margin={{ top: 36, right: 12, bottom: 64, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-14} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={BarTextLabel} />
              {ociBridgeWithLabels.map((row) => (
                <Cell key={row.name} fill={row.value >= 0 ? kpmgColor.purple : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardCard
        title="净资产与税后 CSM 储备"
        subtitle="公司口径：综合净资产 = 净资产 + 期末 CSM 余额 x 75%"
        action={<button onClick={() => onOpenSheet('利润表fromfin')}>净资产来源</button>}
      >
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={valueReserveRows} margin={{ top: 30, right: 12, bottom: 48, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip formatter={formatTooltipAmount} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={kpmgColor.navy}>
              <LabelList dataKey="value" content={BarTextLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>

      <DashboardSection
        step="07"
        title="利源差异"
        subtitle="最后回到准则切换下的税前营业利润变动，支撑汇报结论。"
      />

      <DashboardCard
        title="现行 vs IFRS17 税前营业利润差异"
        subtitle="按底稿 waterfall 口径展示各利源 driver 的桥接路径"
        action={<button onClick={() => onOpenSheet('现行vsI17_利源分析')}>利源表</button>}
        className="dashboard-card--wide"
      >
        <ResponsiveContainer width="100%" height={380}>
          <BarChart data={soeWaterfall} margin={{ top: 42, right: 22, bottom: 88, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={kpmgColor.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-22} textAnchor="end" height={70} />
            <YAxis tick={{ fontSize: 11 }} width={76} tickFormatter={formatChartAmount} />
            <Tooltip
              formatter={(_value, _name, item) => {
                const payload = item.payload as { value: number }
                return [formatTooltipAmount(payload.value), '差异金额']
              }}
            />
            <Bar dataKey="range" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="labelText" content={WaterfallTextLabel} />
              {soeWaterfall.map((row) => (
                <Cell key={row.name} fill={row.endpoint ? kpmgColor.navy : row.value >= 0 ? kpmgColor.blue : kpmgColor.magenta} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </DashboardCard>
    </div>
  )
}

function App() {
  const [template, setTemplate] = useState<WorkbookSnapshot | null>(null)
  const [snapshot, setSnapshot] = useState<WorkbookSnapshot | null>(null)
  const [mode, setMode] = useState<Mode>('dashboard')
  const [cleanReportMode, setCleanReportMode] = useState(false)
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [query, setQuery] = useState('')
  const [comments, setComments] = useState<Record<string, string>>({})
  const [filters, setFilters] = useState<FilterState>(initialFilters)
  const [draftFilters, setDraftFilters] = useState<FilterState>(initialFilters)
  const [uploadStatus, setUploadStatus] = useState('')
  const [dataSourceLabel, setDataSourceLabel] = useState('')
  const [localFilePath, setLocalFilePath] = useState(defaultRealSourcePath)
  const [approvedResults, setApprovedResults] = useState<ApprovedResult[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ifrs17-approved-results') || '[]') as ApprovedResult[]
    } catch {
      return []
    }
  })
  useEffect(() => {
    fetch(defaultSnapshotPath)
      .then((response) => response.json())
      .then((payload: WorkbookSnapshot) => {
        const safePayload = sanitizeSnapshot(payload)
        setTemplate(safePayload)
      })
  }, [])

  const activeSnapshot = useMemo(() => {
    if (snapshot) return snapshot
    return template ? zeroSnapshot(template) : null
  }, [snapshot, template])

  const sheetMap = useMemo(() => {
    const map = new Map<string, SheetSnapshot>()
    activeSnapshot?.sheets.forEach((sheet) => map.set(sheet.name, sheet))
    return map
  }, [activeSnapshot])

  const currentSelectedSheetName = selectedSheetName || activeSnapshot?.sheets[0]?.name || ''
  const selectedSheet = sheetMap.get(currentSelectedSheetName)
  const profitSheet = sheetMap.get('I17利润表')
  const insuranceServiceSheet = sheetMap.get('1. 保险服务业绩')
  const revenueSheet = sheetMap.get('1.1 保险服务收入')
  const investmentSheet = sheetMap.get('2. 投资服务业绩')
  const csmSheet = sheetMap.get('1.2 CSM')
  const selectedIndex = selectedMetricIndex(filters)
  const csmClosing = buildCsmMovement(csmSheet, filters)[5]?.value

  const kpis = [
    { label: '保险服务收入', value: metricDisplay(profitSheet, ['保险服务收入合计'], selectedIndex) || metricDisplay(revenueSheet, ['保险服务收入合计', '总计'], selectedIndex) },
    { label: '保险服务费用', value: metricDisplay(profitSheet, ['保险费用合计'], selectedIndex, { absolute: true }) },
    { label: '保险服务业绩', value: metricDisplay(profitSheet, ['保险服务业绩合计'], selectedIndex) || metricDisplay(insuranceServiceSheet, ['保险利润合计'], selectedIndex) },
    { label: '投资收益', value: metricDisplay(profitSheet, ['投资收益'], selectedIndex) || metricDisplay(investmentSheet, ['投资收益'], selectedIndex) },
    { label: '投资服务业绩', value: metricDisplay(profitSheet, ['投资服务业绩合计'], selectedIndex) || metricDisplay(investmentSheet, ['投资服务业绩合计', '投资服务业绩', '投资利润'], selectedIndex) },
    { label: '负债利息成本', value: metricDisplay(profitSheet, ['计入损益的保险合同金融变动额'], selectedIndex, { absolute: true }) || metricDisplay(investmentSheet, ['保险金融负债成本'], selectedIndex, { absolute: true }) },
    { label: 'CSM余额', value: Number.isFinite(csmClosing) ? formatWanAmount(csmClosing) : '-' },
  ]

  function approveCurrentPeriod() {
    const result: ApprovedResult = {
      id: `${Date.now()}`,
      period: snapshot?.workbookFile.split(/[\\/]/).at(-1)?.match(/\d{4}/)?.[0] || snapshot?.generatedAt || 'current',
      approvedAt: new Date().toISOString(),
      kpis,
    }
    setApprovedResults((current) => {
      const next = [result, ...current].slice(0, 12)
      localStorage.setItem('ifrs17-approved-results', JSON.stringify(next))
      return next
    })
  }

  function switchMode(nextMode: Mode) {
    setCleanReportMode(false)
    setMode(nextMode)
  }

  async function processUploadFile(
    file: File,
    sourceLabel = file.name || '数据源',
    statusMessage = '正在读取并计算数据源...',
  ) {
    if (!file || !template) return
    setUploadStatus(statusMessage)
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      const parsed = sanitizeSnapshot(await parseWorkbook(file, template))
      setSnapshot(parsed)
      setDataSourceLabel(sourceLabel)
      setSelectedSheetName(parsed.sheets[0]?.name || '')
      switchMode('dashboard')
      setFilters(initialFilters)
      setDraftFilters(initialFilters)
      setUploadStatus('')
    } catch (error) {
      const message = error instanceof Error ? error.message : '请检查上传文件格式。'
      setUploadStatus(`上传失败：${message}`)
    }
  }

  async function handleLoadLocalPath() {
    const path = localFilePath.trim()
    if (!path) {
      setUploadStatus('请输入 CSV 或 Excel 文件路径。')
      return
    }
    setUploadStatus('正在按本地路径读取并计算数据源...')
    try {
      const response = await fetch(`/api/local-file?path=${encodeURIComponent(path)}`)
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const encodedName = response.headers.get('X-File-Name')
      const fileName = encodedName ? decodeURIComponent(encodedName) : path.split(/[\\/]/).at(-1) || 'local-input.csv'
      await processUploadFile(
        new File([blob], fileName, { type: blob.type || 'application/octet-stream' }),
        `真实数据源：${fileName}`,
        '正在按本地路径读取真实数据源...',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '请检查文件路径。'
      setUploadStatus(`本地路径加载失败：${message}`)
    }
  }

  async function handleLoadDefaultDemoSource() {
    setUploadStatus('正在加载默认示例数据源...')
    try {
      const response = await fetch(defaultDemoSourcePath)
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      await processUploadFile(
        new File([blob], 'ifrs17-default-demo-source.csv', { type: 'text/csv' }),
        'Demo 假数数据源：真实数据除以 2.5',
        '正在读取并计算默认示例数据源...',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '请检查默认示例数据源。'
      setUploadStatus(`默认示例数据源加载失败：${message}`)
    }
  }

  function exportCleanPdfReport() {
    if (!activeSnapshot) return
    setCleanReportMode(true)
    setMode('report')
    setUploadStatus('清洁版报告已准备，可导出为 PDF。')
    window.setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      window.dispatchEvent(new Event('resize'))
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
        window.print()
      }, 450)
    }, 120)
  }

  if (!template) {
    return (
      <main className="loading-screen">
        <FileSpreadsheet size={34} />
        <p>正在准备 IFRS17 计算模板...</p>
      </main>
    )
  }

  return (
    <main className={`app-shell${cleanReportMode ? ' report-clean' : ''}`}>
      <aside className="workbook-sidebar">
        <div className="brand">
          <FileSpreadsheet size={28} />
          <div>
            <h1>IFRS17 分析工作台</h1>
            <p>财务结果分析与管理层汇报</p>
          </div>
        </div>

        <div className="mode-switch">
          <button className={mode === 'dashboard' ? 'active' : ''} onClick={() => switchMode('dashboard')}>
            <LayoutDashboard size={16} />
            Dashboard
          </button>
          <button className={mode === 'workbook' ? 'active' : ''} onClick={() => switchMode('workbook')}>
            <BookOpen size={16} />
            报表
          </button>
          <button className={mode === 'report' ? 'active' : ''} onClick={() => switchMode('report')}>
            <FileText size={16} />
            汇报
          </button>
        </div>

        <section className="local-path-loader local-path-loader--sidebar">
          <label>
            <span>本地文件路径（真实数据源）</span>
            <input value={localFilePath} onChange={(event) => setLocalFilePath(event.target.value)} />
          </label>
          <div className="loader-actions">
            <button type="button" onClick={handleLoadLocalPath}>
              按路径加载真实数据源
            </button>
            <button className="secondary-loader-button" type="button" onClick={handleLoadDefaultDemoSource}>
              加载默认示例数据源
            </button>
          </div>
        </section>
        {uploadStatus ? <p className="upload-status upload-status--sidebar">{uploadStatus}</p> : null}
        {dataSourceLabel ? <p className="source-status source-status--sidebar">当前数据源：{dataSourceLabel}</p> : null}

        <section className="filter-panel">
          <div className="filter-panel-title">
            <Filter size={16} />
            <div>
              <h2>管理维度筛选</h2>
              <p>由 group_id / POC 辅助列推理</p>
            </div>
          </div>
          <div className="filter-fields">
            {filterDefinitions.map((definition) => (
              <label key={definition.key} className="filter-select">
                <span>
                  {definition.label}
                  <em>{definition.note}</em>
                </span>
                <select
                  value={draftFilters[definition.key]}
                  disabled={definition.key === 'account' && draftFilters.origOrReins === 'reinsurance'}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      [definition.key]: event.target.value,
                      ...(definition.key === 'origOrReins' && event.target.value === 'reinsurance' ? { account: '' } : {}),
                    }))
                  }
                >
                  <option value="">全部</option>
                  {definition.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.code})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="filter-actions">
            <button className="apply-filter-button" type="button" onClick={() => {
              const normalized = normalizeFilters(draftFilters)
              setDraftFilters(normalized)
              setFilters(normalized)
            }}>
              确定筛选
            </button>
            <button
              className="reset-filter-button"
              type="button"
              onClick={() => {
                setDraftFilters(initialFilters)
                setFilters(initialFilters)
              }}
            >
              清空筛选
            </button>
          </div>
          <div className="applied-filter-note">当前生效：{selectedFilterLabel(filters)}</div>
        </section>

        <div className="sheet-nav">
          {activeSnapshot?.sheetGroups
            .filter((group) => !['source', 'reference'].includes(group.id))
            .map((group) => {
            const groupSheets = group.sheets.filter((sheet) => sheetMap.has(sheet) && !hiddenOutputSheetNames.has(sheet))
            if (groupSheets.length === 0) return null
            return (
              <section key={group.id}>
                <h2>{group.label}</h2>
                {groupSheets.map((sheet) => {
                  const depth = sheetNavigationDepth(sheet)
                  return (
                    <button
                      key={sheet}
                      className={[
                        currentSelectedSheetName === sheet ? 'selected' : '',
                        `nav-depth-${depth}`,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      type="button"
                      onClick={() => {
                        setSelectedSheetName(sheet)
                        switchMode('workbook')
                      }}
                    >
                      <ChevronRight size={14} />
                      <span>{sheet}</span>
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header workspace-header--compact">
          <div>
            <span className="eyebrow">Management view</span>
            <h2>{mode === 'report' ? '管理层汇报材料' : '管理层驾驶舱'}</h2>
            <p>{snapshot ? `已加载${dataSourceLabel ? `：${dataSourceLabel}` : '数据源'}，展示本次计算结果。` : '尚未加载数据源，当前展示 0 值模板。'}</p>
          </div>
          <div className="header-actions">
            <button type="button" onClick={exportCleanPdfReport}>
              <Download size={16} />
              生成报告 PDF
            </button>
            <button type="button" onClick={approveCurrentPeriod} disabled={!snapshot}>
              <FileText size={16} />
              定稿审批
            </button>
          </div>
        </header>

        <div className="kpi-grid">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="kpi-card">
              <small>{kpi.label}</small>
              <strong>{kpi.value || '-'}</strong>
              <span>单位：百万元</span>
            </div>
          ))}
        </div>

        {approvedResults.length > 0 ? (
          <section className="approval-strip">
            <strong>已留存结果</strong>
            {approvedResults.slice(0, 4).map((result) => (
              <span key={result.id}>
                {result.period} · {new Date(result.approvedAt).toLocaleString('zh-CN')}
              </span>
            ))}
          </section>
        ) : null}

        {mode === 'dashboard' ? (
          <ManagementDashboard
            sheetMap={sheetMap}
            filters={filters}
            onOpenSheet={(sheet) => {
              setSelectedSheetName(sheet)
              switchMode('workbook')
            }}
          />
        ) : mode === 'workbook' && selectedSheet ? (
          <div className="workbook-layout">
            <section className="sheet-card">
              <div className="sheet-toolbar">
                <div>
                  <span className="eyebrow">{selectedSheet.category}</span>
                  <h2>{selectedSheet.name}</h2>
                  <p>
                    仅展示用于经营分析的结果行，按业务层级整理为可阅读表格。
                  </p>
                </div>
                <label className="search-box">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索项目或金额"
                  />
                </label>
              </div>

              <CleanOutputTable
                sheet={selectedSheet}
                query={query}
                sheetMap={sheetMap}
              />
            </section>
          </div>
        ) : (
          <div className="report-stack">
            {activeSnapshot?.reportSections.map((section) => (
              <ReportPage
                key={section.id}
                section={section}
                sheetMap={sheetMap}
                filters={filters}
                comment={comments[section.id] || ''}
                onCommentChange={(value) => setComments((current) => ({ ...current, [section.id]: value }))}
                editable={!cleanReportMode}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

export default App


