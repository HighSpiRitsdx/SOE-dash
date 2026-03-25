export type SeedRecord = {
  id: string
  taxonomyId: string
  item: string
  source: string
  sourceRow: number | null
  liabilityComponent: string
  statementBucket: string
  driverMajor: string
  driverMinor: string
  operatingCategory: string
  amount: number
  amountUnit: string
  profileId: string
  valYear: string
  goc: string
  reGoc: string
  origOrReins: string
  ifNb: string
  measurementModel: string
  account: string
  channel: string
  branch: string
  productGroup: string
  productType: string
  treaty: string
  scenario: string
  mappingKey: string
  longSheetCode: string | null
  operatingBridgeCode: string | null
  view: string
}

export type SeedTaxonomy = {
  id: string
  source: string
  sourceRow: number | null
  item: string
  liabilityComponent: string
  statementBucket: string
  driverMajor: string
  driverMinor: string
  operatingCategory: string
  mappingKey: string | null
}

export type ManagementDimension = {
  key: keyof Pick<
    SeedRecord,
    | 'valYear'
    | 'goc'
    | 'reGoc'
    | 'origOrReins'
    | 'ifNb'
    | 'measurementModel'
    | 'account'
    | 'channel'
    | 'branch'
    | 'productGroup'
    | 'productType'
    | 'treaty'
  >
  label: string
  options: string[]
}

export type SeedProfile = {
  id: string
  label: string
  scenario: string
  valYear: string
  goc: string
  reGoc: string
  origOrReins: string
  ifNb: string
  measurementModel: string
  account: string
  channel: string
  branch: string
  productGroup: string
  productType: string
  treaty: string
}

export type LongSheetLeafMeta = {
  code: string
  label: string
}

export type LongSheetTreeNode = {
  code: string
  label: string
  children?: LongSheetTreeNode[]
}

export type OperatingBridgeRow = {
  code: string
  label: string
  linePrefix?: string[]
  bucket?: string
  comprehensive?: boolean
}

export type SeedData = {
  generatedAt: string
  workbookFile: string
  currency: string
  profileCombinationCount: number
  dimensionProfiles: SeedProfile[]
  longSheetTree: LongSheetTreeNode[]
  longSheetLeafMeta: LongSheetLeafMeta[]
  operatingBridgeRows: OperatingBridgeRow[]
  managementDimensions: ManagementDimension[]
  dashboardNotes: string[]
  taxonomy: SeedTaxonomy[]
  records: SeedRecord[]
}

export type FilterKey = ManagementDimension['key']
export type Filters = Record<FilterKey, string>

export type AttributionNode = {
  id: string
  label: string
  value: number
  color: string
  children: AttributionNode[]
}

type LongSheetRow = {
  code: string
  label: string
  amount: number
  depth: number
  isLeaf: boolean
}

const sectionOrder = ['PL', 'OCI', 'CSMLC', 'BS']

function sumAmount(records: Pick<SeedRecord, 'amount'>[]) {
  return records.reduce((sum, record) => sum + record.amount, 0)
}

export function createInitialFilters(seed: SeedData) {
  const filters = Object.fromEntries(
    seed.managementDimensions.map((dimension) => [
      dimension.key,
      dimension.key === 'valYear' ? dimension.options[0] ?? '' : '',
    ]),
  )

  return filters as Filters
}

export function formatAmount(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}

export function formatSignedAmount(value: number, maximumFractionDigits = 0) {
  const formatted = formatAmount(Math.abs(value), maximumFractionDigits)
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted
}

export function amountTone(value: number) {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

export function filterRecords(seed: SeedData, records: readonly SeedRecord[], filters: Filters) {
  return records.filter((record) =>
    seed.managementDimensions.every((dimension) => {
      const selected = filters[dimension.key]
      return !selected || record[dimension.key] === selected
    }),
  )
}

function byLongSheetCode(records: readonly SeedRecord[]) {
  const totals: Record<string, number> = {}

  for (const record of records) {
    if (!record.longSheetCode) continue
    totals[record.longSheetCode] = (totals[record.longSheetCode] || 0) + record.amount
  }

  return totals
}

function walkLongSheet(
  node: LongSheetTreeNode,
  totals: Record<string, number>,
  rows: LongSheetRow[],
  depth: number,
) {
  const children = (node.children || []).filter(Boolean)

  if (children.length === 0) {
    const amount = totals[node.code] || 0
    rows.push({
      code: node.code,
      label: node.label,
      amount,
      depth,
      isLeaf: true,
    })
    return amount
  }

  let amount = 0
  for (const child of children) {
    amount += walkLongSheet(child, totals, rows, depth + 1)
  }

  rows.push({
    code: node.code,
    label: node.label,
    amount,
    depth,
    isLeaf: false,
  })

  return amount
}

export function buildLongSheet(seed: SeedData, records: readonly SeedRecord[]) {
  const totals = byLongSheetCode(records)
  const rows: LongSheetRow[] = []

  for (const node of seed.longSheetTree) {
    walkLongSheet(node, totals, rows, 0)
  }

  rows.sort((left, right) => left.code.localeCompare(right.code, 'zh-CN', { numeric: true }))

  const profitAfterTax = sumAmount(records.filter((record) => record.statementBucket === 'PL'))
  const comprehensiveIncome =
    profitAfterTax +
    sumAmount(records.filter((record) => record.statementBucket === 'OCI'))

  return {
    rows,
    profitAfterTax,
    comprehensiveIncome,
  }
}

function taxonomyIndexMap(seed: SeedData) {
  const byMajor = new Map<string, number>()
  const byMinor = new Map<string, number>()

  seed.taxonomy.forEach((row, index) => {
    const majorKey = `${row.statementBucket}|${row.driverMajor}`
    const minorKey = `${row.statementBucket}|${row.driverMajor}|${row.driverMinor}`

    if (!byMajor.has(majorKey)) byMajor.set(majorKey, index)
    if (!byMinor.has(minorKey)) byMinor.set(minorKey, index)
  })

  return { byMajor, byMinor }
}

export function buildDriverSheet(seed: SeedData, records: readonly SeedRecord[]) {
  const majorTotals = new Map<string, number>()
  const minorTotals = new Map<string, number>()
  const sectionTotals = new Map<string, number>()

  for (const record of records) {
    if (!record.driverMajor || record.driverMajor === 'Param') continue
    if (!['PL', 'OCI', 'CSMLC'].includes(record.statementBucket)) continue

    const sectionKey = record.statementBucket
    const majorKey = `${record.statementBucket}|${record.driverMajor}`
    const minorKey = `${record.statementBucket}|${record.driverMajor}|${record.driverMinor}`

    sectionTotals.set(sectionKey, (sectionTotals.get(sectionKey) || 0) + record.amount)
    majorTotals.set(majorKey, (majorTotals.get(majorKey) || 0) + record.amount)
    minorTotals.set(minorKey, (minorTotals.get(minorKey) || 0) + record.amount)
  }

  const { byMajor, byMinor } = taxonomyIndexMap(seed)
  const rows: Array<{
    key: string
    label: string
    amount: number
    depth: number
    section: string
  }> = []

  for (const section of sectionOrder.filter((value) => sectionTotals.has(value))) {
    rows.push({
      key: section,
      label: section,
      amount: sectionTotals.get(section) || 0,
      depth: 0,
      section,
    })

    const sectionMajors = [...majorTotals.entries()]
      .filter(([key]) => key.startsWith(`${section}|`))
      .sort(
        ([leftKey], [rightKey]) =>
          (byMajor.get(leftKey) ?? Number.MAX_SAFE_INTEGER) -
          (byMajor.get(rightKey) ?? Number.MAX_SAFE_INTEGER),
      )

    for (const [majorKey, majorAmount] of sectionMajors) {
      const [, driverMajor] = majorKey.split('|')
      rows.push({
        key: majorKey,
        label: driverMajor,
        amount: majorAmount,
        depth: 1,
        section,
      })

      const sectionMinors = [...minorTotals.entries()]
        .filter(([minorKey]) => minorKey.startsWith(`${majorKey}|`))
        .sort(
          ([leftKey], [rightKey]) =>
            (byMinor.get(leftKey) ?? Number.MAX_SAFE_INTEGER) -
            (byMinor.get(rightKey) ?? Number.MAX_SAFE_INTEGER),
        )

      for (const [minorKey, minorAmount] of sectionMinors) {
        const parts = minorKey.split('|')
        rows.push({
          key: minorKey,
          label: parts[2],
          amount: minorAmount,
          depth: 2,
          section,
        })
      }
    }
  }

  return rows
}

function includesLinePrefix(code: string | null, prefixes: string[]) {
  if (!code) return false
  return prefixes.some((prefix) => code.startsWith(prefix))
}

export function buildOperatingBridge(seed: SeedData, records: readonly SeedRecord[]) {
  return seed.operatingBridgeRows.map((row) => {
    const scopedRecords = records.filter((record) => {
      if (row.comprehensive) {
        return record.statementBucket === 'PL' || record.statementBucket === 'OCI'
      }

      if (row.bucket) {
        return record.statementBucket === row.bucket
      }

      return row.linePrefix ? includesLinePrefix(record.longSheetCode, [...row.linePrefix]) : false
    })

    const operating = sumAmount(scopedRecords.filter((record) => record.operatingCategory === 'Operating'))
    const nonOperating = sumAmount(
      scopedRecords.filter((record) => record.operatingCategory !== 'Operating'),
    )

    return {
      code: row.code,
      label: row.label,
      operating,
      nonOperating,
      total: operating + nonOperating,
    }
  })
}

export function buildKpis(records: readonly SeedRecord[]) {
  const profitAfterTax = sumAmount(records.filter((record) => record.statementBucket === 'PL'))
  const oci = sumAmount(records.filter((record) => record.statementBucket === 'OCI'))
  const operatingProfit = sumAmount(
    records.filter(
      (record) => record.statementBucket === 'PL' && record.operatingCategory === 'Operating',
    ),
  )
  const comprehensiveIncome = profitAfterTax + oci
  const csmLcAbsorption = sumAmount(records.filter((record) => record.statementBucket === 'CSMLC'))

  return [
    { key: 'profit', label: '税后利润', value: profitAfterTax, detail: 'PL total' },
    { key: 'oci', label: 'OCI', value: oci, detail: 'Insurance finance and asset OCI' },
    { key: 'operating', label: '营运利润', value: operatingProfit, detail: 'Operating before tax' },
    {
      key: 'comprehensive',
      label: '综合收益',
      value: comprehensiveIncome,
      detail: 'Profit after tax + OCI',
    },
    { key: 'csm', label: 'CSM / LC 吸收', value: csmLcAbsorption, detail: 'CSMLC total movement' },
  ]
}

export function buildSectionMix(seed: SeedData, records: readonly SeedRecord[]) {
  const bridge = buildOperatingBridge(seed, records)

  return bridge
    .filter((row) =>
      [
        'insurance-service',
        'reinsurance-service',
        'investment-income',
        'insurance-finance',
        'other-profit',
        'oci',
      ].includes(row.code),
    )
    .map((row) => ({
      name: row.label,
      operating: row.operating,
      nonOperating: row.nonOperating,
      total: row.total,
    }))
}

export function buildProfilePerformance(seed: SeedData, records: readonly SeedRecord[]) {
  return seed.dimensionProfiles.map((profile) => {
    const scoped = records.filter((record) => record.profileId === profile.id)
    const pl = sumAmount(scoped.filter((record) => record.statementBucket === 'PL'))
    const oci = sumAmount(scoped.filter((record) => record.statementBucket === 'OCI'))
    const csm = sumAmount(scoped.filter((record) => record.statementBucket === 'CSMLC'))

    return {
      profileId: profile.id,
      label: profile.label,
      scenario: profile.scenario,
      profit: pl,
      oci,
      csm,
      comprehensiveIncome: pl + oci,
    }
  })
}

export function buildWorkingRows(records: readonly SeedRecord[], search: string) {
  const keyword = search.trim().toLowerCase()
  const filtered = records.filter((record) => {
    if (!keyword) return true

    return [
      record.item,
      record.driverMajor,
      record.driverMinor,
      record.goc,
      record.branch,
      record.channel,
      record.productGroup,
      record.productType,
      record.mappingKey,
    ]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })

  return filtered.sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
}

export function buildTaxonomyCoverage(seed: SeedData, records: readonly SeedRecord[], search: string) {
  const keyword = search.trim().toLowerCase()
  const grouped = new Map<
    string,
    {
      total: number
      profiles: Set<string>
      mappings: Set<string>
    }
  >()

  for (const record of records) {
    const existing = grouped.get(record.taxonomyId) || {
      total: 0,
      profiles: new Set<string>(),
      mappings: new Set<string>(),
    }

    existing.total += record.amount
    existing.profiles.add(record.profileId)
    if (record.mappingKey) existing.mappings.add(record.mappingKey)
    grouped.set(record.taxonomyId, existing)
  }

  return seed.taxonomy
    .map((row) => {
      const coverage = grouped.get(row.id)

      return {
        ...row,
        total: coverage?.total || 0,
        profileCount: coverage?.profiles.size || 0,
        mappingCount: coverage?.mappings.size || 0,
        mapped: Boolean(coverage),
      }
    })
    .filter((row) => {
      if (!keyword) return true
      return [row.item, row.driverMajor, row.driverMinor, row.mappingKey, row.source]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
}

export function buildFilterSnapshot(seed: SeedData, filters: Filters) {
  return seed.managementDimensions
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      value: filters[dimension.key],
    }))
    .filter((entry) => entry.value)
}

export function buildCoverageStats(seed: SeedData, records: readonly SeedRecord[]) {
  const workbookItems = seed.taxonomy.filter((row) => row.source === 'workbook').length
  const supplementalItems = seed.taxonomy.filter((row) => row.source === 'supplemental').length
  const mappedItems = new Set(records.map((record) => record.taxonomyId)).size

  return {
    recordCount: records.length,
    workbookItems,
    supplementalItems,
    mappedItems,
  }
}

function sumMappingKeys(records: readonly SeedRecord[], mappingKeys: string[]) {
  return sumAmount(records.filter((record) => mappingKeys.includes(record.mappingKey)))
}

export function buildProfitAttributionTree(seed: SeedData, records: readonly SeedRecord[]): AttributionNode {
  const profitAfterTax = sumAmount(records.filter((record) => record.statementBucket === 'PL'))
  const oci = sumAmount(records.filter((record) => record.statementBucket === 'OCI'))
  const totals = byLongSheetCode(records)

  const colorByTopCode: Record<string, string> = {
    '1': '#10B981',
    '2': '#14B8A6',
    '3': '#0C8599',
    '4': '#64748B',
  }

  function treeColor(code: string, depth: number) {
    const topCode = code.split('.')[0]
    const base = colorByTopCode[topCode] || '#315487'

    if (depth === 0) return base
    if (depth === 1) {
      if (topCode === '1') return '#3B82F6'
      if (topCode === '2') return '#06B6D4'
      if (topCode === '3') return '#6366F1'
      if (topCode === '4') return '#94A3B8'
    }

    return base
  }

  function mapLongNode(node: LongSheetTreeNode, depth: number): AttributionNode {
    const childNodes = (node.children || []).filter(Boolean).map((child) => mapLongNode(child, depth + 1))
    const value = childNodes.length
      ? childNodes.reduce((sum, child) => sum + child.value, 0)
      : totals[node.code] || 0

    return {
      id: `long-${node.code}`,
      label: `${node.code} ${node.label}`,
      value,
      color: treeColor(node.code, depth),
      children: childNodes,
    }
  }

  const longSheetChildren = seed.longSheetTree.map((node) => mapLongNode(node, 0))

  const ociChildren: AttributionNode[] = [
    {
      id: 'oci-discount',
      label: '折现率与经济经验',
      value: sumMappingKeys(records, ['oci:discount-rate', 'oci:economic-variance', 'oci:tvog', 'oci:vfa-fvoci']),
      color: '#3B82F6',
      children: [],
    },
    {
      id: 'oci-dividend',
      label: '红利与特储',
      value: sumMappingKeys(records, ['oci:expected-dividend', 'oci:actual-dividend', 'oci:cat-reserve']),
      color: '#8B5CF6',
      children: [],
    },
    {
      id: 'oci-asset',
      label: '资产OCI',
      value: sumMappingKeys(records, ['oci:asset-oci']),
      color: '#F59E0B',
      children: [],
    },
  ]

  return {
    id: 'comprehensive-income',
    label: '综合收益总额',
    value: profitAfterTax + oci,
    color: '#1F3C88',
    children: [
      {
        id: 'profit-after-tax',
        label: '税后利润',
        value: profitAfterTax,
        color: '#2F6FED',
        children: longSheetChildren,
      },
      {
        id: 'oci',
        label: 'OCI',
        value: oci,
        color: '#F08C00',
        children: ociChildren,
      },
    ],
  }
}
