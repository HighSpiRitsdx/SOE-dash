export type CubeDimensionKey =
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

export type CubeDimension = {
  key: CubeDimensionKey
  label: string
  options: string[]
}

export type CubeFilters = Record<CubeDimensionKey, string>

export type CubeProfile = {
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

export type CubeLongSheetTreeNode = {
  code: string
  label: string
  children?: CubeLongSheetTreeNode[]
}

export type CubeLongSheetLeafMeta = {
  code: string
  label: string
}

export type CubeOperatingBridgeRow = {
  code: string
  label: string
  linePrefix?: string[]
  bucket?: string
  comprehensive?: boolean
}

export type CubeTaxonomy = {
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

export type ManagementCube = {
  generatedAt: string
  workbookFile: string
  currency: string
  profileCombinationCount: number
  rawRecordCount: number
  rawDataPath: string
  previewDataPath?: string
  dimensionProfiles: CubeProfile[]
  longSheetTree: CubeLongSheetTreeNode[]
  longSheetLeafMeta: CubeLongSheetLeafMeta[]
  operatingBridgeRows: CubeOperatingBridgeRow[]
  managementDimensions: CubeDimension[]
  dashboardNotes: string[]
  taxonomy: CubeTaxonomy[]
  statementBucketVectors: Record<string, number[]>
  longSheetVectors: Record<string, number[]>
  driverSectionVectors: Record<string, number[]>
  driverMajorVectors: Record<string, number[]>
  driverMinorVectors: Record<string, number[]>
  taxonomyVectors: Record<string, number[]>
  mappingKeyVectors: Record<string, number[]>
  operatingRows: Record<
    string,
    {
      label: string
      operating: number[]
      nonOperating: number[]
    }
  >
}

export type AttributionNode = {
  id: string
  label: string
  value: number
  color: string
  children: AttributionNode[]
}

export type LongSheetRow = {
  code: string
  label: string
  amount: number
  depth: number
  isLeaf: boolean
  formula: string
}

export type DriverMinorRow = {
  key: string
  labelZh: string
  labelEn: string
  amount: number
}

export type DriverGroup = {
  key: string
  sectionKey: string
  sectionLabelZh: string
  sectionLabelEn: string
  majorKey: string
  majorLabelZh: string
  majorLabelEn: string
  amount: number
  order: number
  minors: DriverMinorRow[]
}

export type ParameterRow = {
  key: string
  sectionKey: string
  sectionLabelZh: string
  sectionLabelEn: string
  labelZh: string
  labelEn: string
  amount: number
}

export type OperatingTreeRow = {
  key: string
  labelZh: string
  labelEn: string
  amount: number
  depth: number
  isTotal?: boolean
}

type DimensionMixRow = {
  key: string
  label: string
  value: number
  share: number
}

type DriverMajorMeta = {
  key: string
  labelZh: string
  labelEn: string
  order: number
}

const sectionMetaMap: Record<string, [string, string]> = {
  PL: ['损益', 'Profit or Loss'],
  OCI: ['OCI', 'Other Comprehensive Income'],
  CSMLC: ['CSM/LC', 'CSM / Loss Component'],
  Param: ['参数类', 'Parameter'],
}

const driverDisplayOrder = [
  'CSM释放',
  'RA释放',
  '经验偏差',
  '假设变更',
  '首日亏损',
  '短期险相关',
  '利差',
  'OCI偏差',
  '企业所得税',
  '其他',
]

const majorLabelFallbacks: Record<string, [string, string]> = {
  CSM_RLS: ['CSM释放', 'CSM Release'],
  RA_RLS: ['RA释放', 'RA Release'],
  LC_NB: ['首日亏损', 'Day-one Loss'],
  CSM_NB: ['首日确认', 'Day-one Recognition'],
  'IFIE-PL': ['利差', 'Spread'],
  'IFIE-OCI': ['OCI偏差', 'OCI Variance'],
  利差: ['利差', 'Spread'],
  浮盈浮亏偏差: ['OCI偏差', 'OCI Variance'],
  Tax: ['企业所得税', 'Income Tax'],
  Param: ['参数类', 'Parameter'],
}

const minorLabelMap: Record<string, [string, string]> = {
  Param: ['参数项', 'Parameter'],
  RA释放: ['RA释放', 'RA Release'],
  TVOG释放: ['TVOG释放', 'TVOG Release'],
  VFA公允价值变动: ['VFA公允价值变动', 'VFA Fair Value Change'],
  亏损部分的分摊: ['亏损部分的分摊', 'Loss Component Amortization'],
  亏损部分的加剧或转回: ['亏损部分的加剧或转回', 'Loss Component Deterioration / Reversal'],
  企业所得税: ['企业所得税', 'Income Tax'],
  保费偏差: ['保费偏差', 'Premium Variance'],
  公允价值变动: ['公允价值变动', 'Fair Value Change'],
  其他: ['其他', 'Other'],
  其他RA变更: ['其他RA变更', 'Other RA Change'],
  其他TVOG变更: ['其他TVOG变更', 'Other TVOG Change'],
  其他准备金变更: ['其他准备金变更', 'Other Reserve Change'],
  利息收入: ['利息收入', 'Interest Income'],
  合同服务边际摊销: ['合同服务边际释放', 'CSM Release'],
  实际保险理赔: ['实际保险理赔', 'Actual Claims'],
  实际维持费用: ['实际维持费用', 'Actual Maintenance Expense'],
  已发生赔款负债的调整: ['已发生赔款负债的调整', 'Incurred Claims Liability Adjustment'],
  投成偏差: ['投资成分偏差', 'Investment Component Variance'],
  折现率影响: ['折现率影响', 'Discount Rate Impact'],
  '新单初始确认-LC（考虑IACF_True-up）': ['新单初始确认-LC', 'New Business LC Recognition'],
  模型变更: ['模型变更', 'Model Change'],
  死亡假设变更: ['死亡假设变更', 'Death Assumption Change'],
  死亡导致准备金变更: ['死亡导致准备金变更', 'Death Reserve Change'],
  特储提转差: ['特储提转差', 'Cat Reserve Movement'],
  疾病假设变更: ['重疾假设变更', 'CI Assumption Change'],
  疾病导致准备金变更: ['重疾导致准备金变更', 'CI Reserve Change'],
  短险亏损部分提转差: ['短期险亏损部分提转差', 'Short-term LC Movement'],
  短险保险获取费用的分摊: ['短期险获取费用分摊', 'Short-term Acquisition Cost Amortization'],
  短险已赚保费: ['短期险已赚保费', 'Earned Premium - Short-term'],
  短险理赔和费用支出: ['短期险理赔和费用支出', 'Short-term Claims and Expenses'],
  红利偏差: ['红利偏差', 'Dividend Variance'],
  经济经验偏差: ['经济经验偏差', 'Economic Variance'],
  获取费用偏差: ['获取费用偏差', 'Acquisition Cost Variance'],
  费用假设变更: ['费用假设变更', 'Expense Assumption Change'],
  资产OCI: ['资产OCI', 'Asset OCI'],
  进展因子调整: ['进展因子调整', 'Progress Factor Adjustment'],
  退保假设变更: ['退保假设变更', 'Surrender Assumption Change'],
  退保导致准备金变更: ['退保导致准备金变更', 'Surrender Reserve Change'],
  长险保险获取费用的分摊: ['长险获取费用分摊', 'Acquisition Cost Amortization - Long-term'],
  非VFA_BEL计息: ['非VFA BEL计息', 'Non-VFA BEL Accretion'],
  非VFA_CSM计息: ['非VFA CSM计息', 'Non-VFA CSM Accretion'],
  预期保险理赔: ['预期保险理赔', 'Expected Claims'],
  预期维持费用: ['预期维持费用', 'Expected Maintenance Expense'],
  首日亏损: ['首日亏损', 'Day-one Loss'],
  DTH: ['死亡给付', 'Death Benefit'],
  DD: ['重疾给付', 'Critical Illness Benefit'],
  SURR: ['退保', 'Surrender'],
  HLT: ['医疗给付', 'Health Benefit'],
  WP: ['豁免保费', 'Waiver of Premium'],
  ANN: ['年金给付', 'Annuity Benefit'],
  MAT: ['满期给付', 'Maturity Benefit'],
  CSM_RLS: ['合同服务边际释放', 'CSM Release'],
  RA_RLS: ['风险调整释放', 'RA Release'],
  CLM: ['理赔', 'Claims'],
  ASSUMP: ['假设变更', 'Assumption Change'],
}

function sumSelected(values: number[] | undefined, selectedIndexes: readonly number[]) {
  if (!values || selectedIndexes.length === 0) return 0

  let total = 0
  for (const index of selectedIndexes) total += values[index] || 0
  return total
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function byLongSheetCode(cube: ManagementCube, selectedIndexes: readonly number[]) {
  const totals: Record<string, number> = {}

  for (const leaf of cube.longSheetLeafMeta) {
    if (leaf.code === '5') {
      totals[leaf.code] = sumSelected(cube.longSheetVectors['4.2'] || cube.longSheetVectors['5'], selectedIndexes)
      continue
    }

    totals[leaf.code] = sumSelected(cube.longSheetVectors[leaf.code], selectedIndexes)
  }

  return totals
}

function formulaForNode(code: string, childCodes: string[]) {
  if (childCodes.length === 0) return ''
  if (code === '1' && childCodes.length === 2) return `1 = ${childCodes[0]} - ${childCodes[1]}`
  return `${code} = ${childCodes.join(' + ')}`
}

function walkLongSheet(
  node: CubeLongSheetTreeNode,
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
      formula: '',
    })
    return amount
  }

  let amount = 0
  for (const child of children) amount += walkLongSheet(child, totals, rows, depth + 1)

  rows.push({
    code: node.code,
    label: node.label,
    amount,
    depth,
    isLeaf: false,
    formula: formulaForNode(node.code, children.map((child) => child.code)),
  })

  return amount
}

function sectionMeta(sectionKey: string) {
  const [labelZh, labelEn] = sectionMetaMap[sectionKey] || [sectionKey, sectionKey]
  return { key: sectionKey, labelZh, labelEn }
}

function translationPair(value: string, map: Record<string, [string, string]>) {
  return map[value] || [value, value]
}

function driverOrder(labelZh: string) {
  const index = driverDisplayOrder.indexOf(labelZh)
  return index === -1 ? driverDisplayOrder.length : index
}

function buildDriverMajorMeta(statementBucket: string, driverMajor: string): DriverMajorMeta {
  if (driverMajor === 'CSM_RLS') {
    return { key: 'CSM释放', labelZh: 'CSM释放', labelEn: 'CSM Release', order: driverOrder('CSM释放') }
  }

  if (driverMajor === 'RA_RLS') {
    return { key: 'RA释放', labelZh: 'RA释放', labelEn: 'RA Release', order: driverOrder('RA释放') }
  }

  if (driverMajor === 'Experience_Variance_ST') {
    return { key: '短期险相关', labelZh: '短期险相关', labelEn: 'Short-term Insurance', order: driverOrder('短期险相关') }
  }

  if (driverMajor.startsWith('Experience_Variance_')) {
    return { key: '经验偏差', labelZh: '经验偏差', labelEn: 'Experience Variance', order: driverOrder('经验偏差') }
  }

  if (driverMajor.startsWith('ASSUMP_')) {
    return { key: '假设变更', labelZh: '假设变更', labelEn: 'Assumption Change', order: driverOrder('假设变更') }
  }

  if (driverMajor === 'LC_NB' || driverMajor === 'CSM_NB') {
    return { key: '首日亏损', labelZh: '首日亏损', labelEn: 'Day-one Recognition / Loss', order: driverOrder('首日亏损') }
  }

  if (driverMajor === 'IFIE-PL' || driverMajor === '利差') {
    return { key: '利差', labelZh: '利差', labelEn: 'Spread', order: driverOrder('利差') }
  }

  if (driverMajor === 'IFIE-OCI' || driverMajor === '浮盈浮亏偏差' || statementBucket === 'OCI') {
    return { key: 'OCI偏差', labelZh: 'OCI偏差', labelEn: 'OCI Variance', order: driverOrder('OCI偏差') }
  }

  if (driverMajor === 'Tax') {
    return { key: '企业所得税', labelZh: '企业所得税', labelEn: 'Income Tax', order: driverOrder('企业所得税') }
  }

  const [labelZh, labelEn] = translationPair(driverMajor, majorLabelFallbacks)
  return { key: labelZh, labelZh, labelEn, order: driverOrder(labelZh) }
}

function buildDimensionMix(
  cube: ManagementCube,
  selectedIndexes: readonly number[],
  key: CubeDimensionKey,
): DimensionMixRow[] {
  const grouped = new Map<string, number>()
  const profitVector = cube.statementBucketVectors.PL || []

  for (const index of selectedIndexes) {
    const profile = cube.dimensionProfiles[index]
    const dimensionValue = profile[key]
    grouped.set(dimensionValue, (grouped.get(dimensionValue) || 0) + (profitVector[index] || 0))
  }

  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0)

  return [...grouped.entries()]
    .map(([label, value]) => ({
      key: label,
      label,
      value: round2(value),
      share: Math.abs(total) > 0.0001 ? round2((value / total) * 100) : 0,
    }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
}

function buildOperatingTree(
  operatingSheet: Array<{ code: string; operating: number; nonOperating: number; total: number }>,
): OperatingTreeRow[] {
  const row = (code: string) => operatingSheet.find((item) => item.code === code)

  const preTaxOperating = row('profit-before-tax')?.operating || 0
  const preTaxNonOperating = (row('profit-before-tax')?.total || 0) - preTaxOperating
  const incomeTax = row('income-tax')?.total || 0
  const profitAfterTax = row('profit-after-tax')?.total || 0

  return [
    { key: 'operating-root', labelZh: '营运利润', labelEn: 'Operating Profit', amount: preTaxOperating, depth: 0, isTotal: true },
    { key: 'op-ins', labelZh: '保险服务业绩', labelEn: 'Insurance Service Result', amount: row('insurance-service')?.operating || 0, depth: 1 },
    { key: 'op-reins', labelZh: '再保险服务业绩', labelEn: 'Reinsurance Service Result', amount: row('reinsurance-service')?.operating || 0, depth: 1 },
    { key: 'op-invest', labelZh: '投资收益', labelEn: 'Investment Income', amount: row('investment-income')?.operating || 0, depth: 1 },
    { key: 'op-finance', labelZh: '保险财务损益', labelEn: 'Insurance Finance Result', amount: row('insurance-finance')?.operating || 0, depth: 1 },
    { key: 'op-other', labelZh: '其他营运项目', labelEn: 'Other Operating Items', amount: row('other-profit')?.operating || 0, depth: 1 },
    { key: 'nonop-root', labelZh: '非营运利润', labelEn: 'Non-operating Profit', amount: preTaxNonOperating, depth: 0, isTotal: true },
    { key: 'nonop-ins', labelZh: '保险服务业绩', labelEn: 'Insurance Service Result', amount: row('insurance-service')?.nonOperating || 0, depth: 1 },
    { key: 'nonop-reins', labelZh: '再保险服务业绩', labelEn: 'Reinsurance Service Result', amount: row('reinsurance-service')?.nonOperating || 0, depth: 1 },
    { key: 'nonop-invest', labelZh: '投资收益', labelEn: 'Investment Income', amount: row('investment-income')?.nonOperating || 0, depth: 1 },
    { key: 'nonop-finance', labelZh: '保险财务损益', labelEn: 'Insurance Finance Result', amount: row('insurance-finance')?.nonOperating || 0, depth: 1 },
    { key: 'nonop-other', labelZh: '其他非营运项目', labelEn: 'Other Non-operating Items', amount: row('other-profit')?.nonOperating || 0, depth: 1 },
    { key: 'pretax', labelZh: '税前利润', labelEn: 'Profit Before Tax', amount: row('profit-before-tax')?.total || 0, depth: 0, isTotal: true },
    { key: 'tax', labelZh: '企业所得税', labelEn: 'Income Tax', amount: incomeTax, depth: 0 },
    { key: 'pat', labelZh: '税后利润', labelEn: 'Profit After Tax', amount: profitAfterTax, depth: 0, isTotal: true },
  ]
}

function buildDriverGroups(cube: ManagementCube, selectedIndexes: readonly number[]) {
  const groupMap = new Map<
    string,
    DriverGroup & {
      firstSeen: number
      minorMap: Map<string, DriverMinorRow>
    }
  >()
  const parameterMap = new Map<string, ParameterRow & { firstSeen: number }>()

  cube.taxonomy.forEach((row, index) => {
    const amount = round2(sumSelected(cube.taxonomyVectors[row.id], selectedIndexes))
    if (Math.abs(amount) < 0.0001) return
    if (row.statementBucket === 'BS') return

    const section = sectionMeta(row.statementBucket || 'PL')
    const [minorZh, minorEn] = translationPair(row.driverMinor || '其他', minorLabelMap)

    if (row.driverMajor === 'Param' || row.statementBucket === 'Param' || row.driverMinor === 'Param') {
      const parameterKey = `${section.key}|${minorZh}`
      const current = parameterMap.get(parameterKey)
      if (current) {
        current.amount = round2(current.amount + amount)
      } else {
        parameterMap.set(parameterKey, {
          key: parameterKey,
          sectionKey: section.key,
          sectionLabelZh: section.labelZh,
          sectionLabelEn: section.labelEn,
          labelZh: minorZh,
          labelEn: minorEn,
          amount,
          firstSeen: index,
        })
      }
      return
    }

    const major = buildDriverMajorMeta(row.statementBucket, row.driverMajor || '其他')
    const groupKey = `${section.key}|${major.key}`
    let group = groupMap.get(groupKey)

    if (!group) {
      group = {
        key: groupKey,
        sectionKey: section.key,
        sectionLabelZh: section.labelZh,
        sectionLabelEn: section.labelEn,
        majorKey: major.key,
        majorLabelZh: major.labelZh,
        majorLabelEn: major.labelEn,
        amount: 0,
        order: major.order,
        minors: [],
        firstSeen: index,
        minorMap: new Map<string, DriverMinorRow>(),
      }
      groupMap.set(groupKey, group)
    }

    group.amount = round2(group.amount + amount)

    const minorKey = `${groupKey}|${minorZh}`
    const currentMinor = group.minorMap.get(minorKey)
    if (currentMinor) {
      currentMinor.amount = round2(currentMinor.amount + amount)
    } else {
      group.minorMap.set(minorKey, {
        key: minorKey,
        labelZh: minorZh,
        labelEn: minorEn,
        amount,
      })
    }
  })

  const sectionOrder = ['PL', 'OCI', 'CSMLC', 'Param']

  const driverGroups = [...groupMap.values()]
    .map((group) => ({
      key: group.key,
      sectionKey: group.sectionKey,
      sectionLabelZh: group.sectionLabelZh,
      sectionLabelEn: group.sectionLabelEn,
      majorKey: group.majorKey,
      majorLabelZh: group.majorLabelZh,
      majorLabelEn: group.majorLabelEn,
      amount: group.amount,
      order: group.order,
      minors: [...group.minorMap.values()].sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount)),
      firstSeen: group.firstSeen,
    }))
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order
      const leftSectionIndex = sectionOrder.indexOf(left.sectionKey)
      const rightSectionIndex = sectionOrder.indexOf(right.sectionKey)
      if (leftSectionIndex !== rightSectionIndex) return leftSectionIndex - rightSectionIndex
      return left.firstSeen - right.firstSeen
    })

  const parameterRows = [...parameterMap.values()]
    .sort((left, right) => {
      const leftSectionIndex = sectionOrder.indexOf(left.sectionKey)
      const rightSectionIndex = sectionOrder.indexOf(right.sectionKey)
      if (leftSectionIndex !== rightSectionIndex) return leftSectionIndex - rightSectionIndex
      return left.firstSeen - right.firstSeen
    })
    .map((row) => ({
      key: row.key,
      sectionKey: row.sectionKey,
      sectionLabelZh: row.sectionLabelZh,
      sectionLabelEn: row.sectionLabelEn,
      labelZh: row.labelZh,
      labelEn: row.labelEn,
      amount: row.amount,
    }))

  return { driverGroups, parameterRows }
}

export function createInitialCubeFilters(cube: ManagementCube) {
  const filters = Object.fromEntries(
    cube.managementDimensions.map((dimension) => [
      dimension.key,
      dimension.key === 'valYear' ? dimension.options[0] ?? '' : '',
    ]),
  )

  return filters as CubeFilters
}

export function buildFilterSnapshot(cube: ManagementCube, filters: CubeFilters) {
  return cube.managementDimensions
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      value: filters[dimension.key],
    }))
    .filter((entry) => entry.value)
}

export function selectProfileIndexes(cube: ManagementCube, filters: CubeFilters) {
  return cube.dimensionProfiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) =>
      cube.managementDimensions.every((dimension) => {
        const selected = filters[dimension.key]
        return !selected || profile[dimension.key] === selected
      }),
    )
    .map(({ index }) => index)
}

export function buildManagementView(cube: ManagementCube, filters: CubeFilters) {
  const selectedIndexes = selectProfileIndexes(cube, filters)
  const selectedProfiles = selectedIndexes.map((index) => cube.dimensionProfiles[index])
  const longSheetTotals = byLongSheetCode(cube, selectedIndexes)

  const longRows: LongSheetRow[] = []
  for (const node of cube.longSheetTree) walkLongSheet(node, longSheetTotals, longRows, 0)
  longRows.sort((left, right) => left.code.localeCompare(right.code, 'zh-CN', { numeric: true }))

  const profitAfterTax = sumSelected(cube.statementBucketVectors.PL, selectedIndexes)
  const oci = sumSelected(cube.statementBucketVectors.OCI, selectedIndexes)
  const csm = sumSelected(cube.statementBucketVectors.CSMLC, selectedIndexes)
  const comprehensiveIncome = profitAfterTax + oci

  const operatingSheet = cube.operatingBridgeRows.map((row) => {
    const vectors = cube.operatingRows[row.code]
    const operating = sumSelected(vectors?.operating, selectedIndexes)
    const nonOperating = sumSelected(vectors?.nonOperating, selectedIndexes)

    return {
      code: row.code,
      operating,
      nonOperating,
      total: operating + nonOperating,
    }
  })

  const { driverGroups, parameterRows } = buildDriverGroups(cube, selectedIndexes)
  const operatingTree = buildOperatingTree(operatingSheet)

  const profilePerformance = selectedProfiles
    .map((profile) => {
      const index = cube.dimensionProfiles.findIndex((entry) => entry.id === profile.id)
      const profit = cube.statementBucketVectors.PL?.[index] || 0
      const profileOci = cube.statementBucketVectors.OCI?.[index] || 0
      const profileCsm = cube.statementBucketVectors.CSMLC?.[index] || 0

      return {
        profileId: profile.id,
        label: profile.label,
        scenario: profile.scenario,
        profit,
        oci: profileOci,
        csm: profileCsm,
        comprehensiveIncome: profit + profileOci,
      }
    })
    .sort((left, right) => Math.abs(right.profit) - Math.abs(left.profit))

  const dimensionMixes = {
    account: buildDimensionMix(cube, selectedIndexes, 'account'),
    measurementModel: buildDimensionMix(cube, selectedIndexes, 'measurementModel'),
    channel: buildDimensionMix(cube, selectedIndexes, 'channel'),
    branch: buildDimensionMix(cube, selectedIndexes, 'branch'),
    productGroup: buildDimensionMix(cube, selectedIndexes, 'productGroup'),
  }

  const mappedItems = cube.taxonomy.filter(
    (row) => Math.abs(sumSelected(cube.taxonomyVectors[row.id], selectedIndexes)) > 0.0001,
  ).length

  const coverageStats = {
    workbookItems: cube.taxonomy.filter((row) => row.source === 'workbook').length,
    supplementalItems: cube.taxonomy.filter((row) => row.source === 'supplemental').length,
    mappedItems,
  }

  const colorByTopCode: Record<string, string> = {
    '1': '#10B981',
    '2': '#14B8A6',
    '3': '#0C8599',
    '4': '#64748B',
    '5': '#9A3412',
  }

  function mapLongNode(node: CubeLongSheetTreeNode, depth: number): AttributionNode {
    const childNodes = (node.children || []).filter(Boolean).map((child) => mapLongNode(child, depth + 1))
    const topCode = node.code.split('.')[0]
    const value = childNodes.length
      ? childNodes.reduce((sum, child) => sum + child.value, 0)
      : longSheetTotals[node.code] || 0

    return {
      id: `long-${node.code}`,
      label: `${node.code} ${node.label}`,
      value,
      color: colorByTopCode[topCode] || '#315487',
      children: childNodes,
    }
  }

  return {
    selectedIndexes,
    selectedProfileCount: selectedIndexes.length,
    filterSnapshot: buildFilterSnapshot(cube, filters),
    kpis: [
      { key: 'profit', label: '税后利润', value: profitAfterTax, detail: 'PL total' },
      { key: 'pretax', label: '税前利润', value: operatingSheet.find((row) => row.code === 'profit-before-tax')?.total || 0, detail: 'Profit before tax' },
      { key: 'operating', label: '营运利润', value: operatingSheet.find((row) => row.code === 'profit-before-tax')?.operating || 0, detail: 'Operating before tax' },
      {
        key: 'nonOperating',
        label: '非营运利润',
        value:
          (operatingSheet.find((row) => row.code === 'profit-before-tax')?.total || 0) -
          (operatingSheet.find((row) => row.code === 'profit-before-tax')?.operating || 0),
        detail: 'Non-operating before tax',
      },
      { key: 'csm', label: 'CSM / LC吸收', value: csm, detail: 'CSMLC total movement' },
    ],
    longSheet: {
      rows: longRows,
      profitAfterTax,
      comprehensiveIncome,
    },
    driverGroups,
    parameterRows,
    operatingTree,
    profilePerformance,
    coverageStats,
    attributionTree: {
      id: 'profit-after-tax',
      label: '税后利润',
      value: profitAfterTax,
      color: '#1F3C88',
      children: cube.longSheetTree.map((node) => mapLongNode(node, 0)),
    },
    leafTotals: longSheetTotals,
    dimensionMixes,
  }
}
