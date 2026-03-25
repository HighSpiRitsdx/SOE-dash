import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const projectRoot = path.resolve(import.meta.dirname, '..')
const workbookCandidates = fs
  .readdirSync(projectRoot)
  .filter((fileName) => fileName.endsWith('.xlsx') && !fileName.startsWith('~$') && fileName !== 'source.xlsx')
  .sort((left, right) => left.localeCompare(right, 'zh-CN'))

const sourceWorkbookName = workbookCandidates[0] || 'source.xlsx'
const sourceWorkbookPath = path.join(projectRoot, sourceWorkbookName)
const workbookPath = path.join(projectRoot, 'source.xlsx')
const outputJsonPath = path.join(projectRoot, 'public', 'data', 'ifrs17-seed.json')
const outputCubePath = path.join(projectRoot, 'public', 'data', 'ifrs17-management-cube.json')
const outputPreviewPath = path.join(projectRoot, 'public', 'data', 'ifrs17-fact-preview.json')
const outputStubPath = path.join(projectRoot, 'src', 'generated', 'ifrs17-data.ts')

if (sourceWorkbookPath !== workbookPath && fs.existsSync(sourceWorkbookPath)) {
  fs.copyFileSync(sourceWorkbookPath, workbookPath)
}

const workbook = XLSX.readFile(workbookPath)
const dataSheet = workbook.Sheets.data

if (!dataSheet) {
  throw new Error('Cannot find worksheet "data" in source.xlsx')
}

const rawRows = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: '' })
const taxonomyRows = rawRows.slice(1).map((cells, index) => ({
  id: `src-${String(index + 2).padStart(3, '0')}`,
  source: 'workbook',
  sourceRow: index + 2,
  item: String(cells[0] || '').trim(),
  liabilityComponent: String(cells[1] || '').trim(),
  statementBucket: String(cells[2] || '').trim(),
  driverMajor: String(cells[3] || '').trim(),
  driverMinor: String(cells[4] || '').trim(),
  operatingCategory: String(cells[5] || '').trim() || 'Operating',
  sampleDimensions: {
    valYear: String(cells[8] || '').trim(),
    goc: String(cells[9] || '').trim(),
    reGoc: String(cells[10] || '').trim(),
    origOrReins: String(cells[11] || '').trim(),
    ifNb: String(cells[12] || '').trim(),
    measurementModel: String(cells[13] || '').trim(),
    account: String(cells[14] || '').trim(),
    channel: String(cells[15] || '').trim(),
    branch: String(cells[16] || '').trim(),
    productGroup: String(cells[17] || '').trim(),
    productType: String(cells[18] || '').trim(),
    treaty: String(cells[19] || '').trim(),
  },
}))

const dimensionKeys = [
  'valYear',
  'goc',
  'reGoc',
  'origOrReins',
  'ifNb',
  'measurementModel',
  'account',
  'channel',
  'branch',
  'productGroup',
  'productType',
  'treaty',
]

const profileCells = rawRows
  .slice(1)
  .filter((cells) => String(cells[8] || '').trim() === '2025' && String(cells[9] || '').trim())
  .map((cells) => ({
    valYear: String(cells[8] || '').trim(),
    goc: String(cells[9] || '').trim(),
    reGoc: String(cells[10] || '').trim(),
    origOrReins: String(cells[11] || '').trim(),
    ifNb: String(cells[12] || '').trim(),
    measurementModel: String(cells[13] || '').trim(),
    account: String(cells[14] || '').trim(),
    channel: String(cells[15] || '').trim(),
    branch: String(cells[16] || '').trim(),
    productGroup: String(cells[17] || '').trim(),
    productType: String(cells[18] || '').trim(),
    treaty: String(cells[19] || '').trim(),
  }))

const dimensionOptions = Object.fromEntries(
  dimensionKeys.map((key) => [
    key,
    [...new Set(profileCells.map((profile) => profile[key]).filter(Boolean))].sort((left, right) =>
      String(left).localeCompare(String(right), 'zh-CN'),
    ),
  ]),
)

function inferScenario(profile) {
  if (profile.origOrReins === '再保') return 'reinsurance'
  if (profile.productGroup === '重疾' && profile.productType === '定期重疾') return 'direct-protection-term'
  if (profile.productGroup === '重疾' && profile.productType === '终身重疾') return 'direct-protection-wholelife'
  if (profile.measurementModel === 'VFA') return 'direct-savings-participating'
  if (profile.measurementModel === 'MBBA') return 'direct-savings-universal'
  return 'direct-balanced'
}

function buildCartesianProfiles(optionMap) {
  const results = []

  function walk(index, current) {
    if (index === dimensionKeys.length) {
      results.push({ ...current })
      return
    }

    const key = dimensionKeys[index]
    for (const option of optionMap[key]) {
      current[key] = option
      walk(index + 1, current)
    }
  }

  walk(0, {})
  return results
}

const dimensionProfiles = buildCartesianProfiles(dimensionOptions).map((profile, index) => ({
  id: `p${String(index + 1).padStart(4, '0')}`,
  label: `${profile.branch} / ${profile.channel} / ${profile.productGroup} / ${profile.productType}`,
  scenario: inferScenario(profile),
  ...profile,
}))

const profileById = Object.fromEntries(dimensionProfiles.map((profile) => [profile.id, profile]))

const supplementalTaxonomy = [
  {
    id: 'sup-001',
    source: 'supplemental',
    sourceRow: null,
    item: '再保CSM摊销',
    liabilityComponent: 'CSM',
    statementBucket: 'PL',
    driverMajor: 'CSM_RLS',
    driverMinor: '合同服务边际摊销',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-002',
    source: 'supplemental',
    sourceRow: null,
    item: '再保预期赔付费用',
    liabilityComponent: 'BEL',
    statementBucket: 'PL',
    driverMajor: 'Experience_Variance_CLM',
    driverMinor: '预期保险理赔',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-003',
    source: 'supplemental',
    sourceRow: null,
    item: '再保PAA保费分摊',
    liabilityComponent: 'BEL',
    statementBucket: 'PL',
    driverMajor: 'Experience_Variance_ST',
    driverMinor: '短险已赚保费',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-004',
    source: 'supplemental',
    sourceRow: null,
    item: '再保摊回实际赔付费用',
    liabilityComponent: 'CF',
    statementBucket: 'PL',
    driverMajor: 'Experience_Variance_CLM',
    driverMinor: '实际保险理赔',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-005',
    source: 'supplemental',
    sourceRow: null,
    item: '再保亏损部分的确认和转回',
    liabilityComponent: 'Param',
    statementBucket: 'PL',
    driverMajor: 'LC_NB',
    driverMinor: '亏损部分的加剧或转回',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-006',
    source: 'supplemental',
    sourceRow: null,
    item: '再保非PAA已发生赔款调整',
    liabilityComponent: 'BEL',
    statementBucket: 'PL',
    driverMajor: 'Experience_Variance_CLM',
    driverMinor: '已发生赔款负债的调整',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-007',
    source: 'supplemental',
    sourceRow: null,
    item: '再保NPR提转差',
    liabilityComponent: 'BEL',
    statementBucket: 'PL',
    driverMajor: 'Experience_Variance_ST',
    driverMinor: '短险亏损部分提转差',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-008',
    source: 'supplemental',
    sourceRow: null,
    item: '再保PAA再保险服务费用',
    liabilityComponent: 'BEL',
    statementBucket: 'PL',
    driverMajor: 'Experience_Variance_ST',
    driverMinor: '短险理赔和费用支出',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-009',
    source: 'supplemental',
    sourceRow: null,
    item: '再保合同计息',
    liabilityComponent: 'BEL',
    statementBucket: 'PL',
    driverMajor: 'IFIE-PL',
    driverMinor: '其他',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-010',
    source: 'supplemental',
    sourceRow: null,
    item: '长险保险获取费用摊销费用',
    liabilityComponent: 'Param',
    statementBucket: 'PL',
    driverMajor: 'Param',
    driverMinor: '长险保险获取费用的分摊',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-011',
    source: 'supplemental',
    sourceRow: null,
    item: '亏损部分的分摊费用',
    liabilityComponent: 'Param',
    statementBucket: 'PL',
    driverMajor: 'Param',
    driverMinor: '亏损部分的分摊',
    operatingCategory: 'Operating',
  },
  {
    id: 'sup-012',
    source: 'supplemental',
    sourceRow: null,
    item: '非履约费用',
    liabilityComponent: 'CF',
    statementBucket: 'PL',
    driverMajor: 'Param',
    driverMinor: '其他',
    operatingCategory: 'Non-Operating',
  },
  {
    id: 'sup-013',
    source: 'supplemental',
    sourceRow: null,
    item: '企业所得税',
    liabilityComponent: 'Tax',
    statementBucket: 'PL',
    driverMajor: 'Tax',
    driverMinor: '企业所得税',
    operatingCategory: 'Non-Operating',
  },
]

const allTaxonomy = [...taxonomyRows, ...supplementalTaxonomy]

const mappingTotals = {
  'pl:1.1.1': 980,
  'pl:1.1.2': 210,
  'pl:1.1.3': 2460,
  'pl:1.1.4': 710,
  'pl:1.1.5': 180,
  'pl:1.1.6': 35,
  'pl:1.1.7': 540,
  'pl:1.2.1': -2575,
  'pl:1.2.2': -742,
  'pl:1.2.3': -180,
  'pl:1.2.4': -35,
  'pl:1.2.5': -62,
  'pl:1.2.6': -48,
  'pl:1.2.7': -438,
  'pl:1.2.8': -36,
  'pl:1.2.9': -12,
  'pl:1.2.10': -95,
  'pl:2.1.1': -55,
  'pl:2.1.2': -140,
  'pl:2.1.3': -35,
  'pl:2.2.1': 188,
  'pl:2.2.2': 42,
  'pl:2.2.3': 28,
  'pl:2.2.4': 17,
  'pl:2.2.5': 20,
  'pl:3.1.1': 402,
  'pl:3.1.2': 138,
  'pl:3.1.3': 24,
  'pl:3.2.1.1': -188,
  'pl:3.2.1.2': -42,
  'pl:3.2.1.3': -76,
  'pl:3.2.1.4': -18,
  'pl:3.2.2': 31,
  'pl:4.1.1': -18,
  'pl:4.2': -101,
  'oci:expected-dividend': -18,
  'oci:discount-rate': -74,
  'oci:economic-variance': -12,
  'oci:tvog': -9,
  'oci:actual-dividend': -6,
  'oci:cat-reserve': -15,
  'oci:vfa-fvoci': -24,
  'oci:asset-oci': -56,
  'csmlc:model-change': 28,
  'csmlc:acquisition-variance': -64,
  'csmlc:premium-variance': 18,
  'csmlc:investment-component': -186,
  'csmlc:death-reserve-change': -26,
  'csmlc:disease-reserve-change': -18,
  'csmlc:surrender-reserve-change': 12,
  'csmlc:other-reserve-change': 22,
  'csmlc:assumption-change': -55,
  'csmlc:ibnr-progress': -8,
  'csmlc:new-business-bel': -1180,
  'csmlc:new-business-ra': -86,
  'csmlc:new-business-csm': 1440,
  'bs:opening-bel': 11280,
  'bs:opening-ra': 905,
  'bs:opening-csm': 6320,
  'bs:closing-bel': 11960,
  'bs:closing-ra': 958,
  'bs:closing-csm': 6835,
  'bs:opening-short-acq': 94,
  'bs:closing-short-acq': 112,
}

const longSheetLeafMeta = [
  ['1.1.1', '合同服务边际摊销'],
  ['1.1.2', '非金融风险调整释放'],
  ['1.1.3', '预期保险理赔'],
  ['1.1.4', '预期维持费用'],
  ['1.1.5', '长险保险获取费用的分摊'],
  ['1.1.6', '亏损部分的分摊'],
  ['1.1.7', '短险已赚保费'],
  ['1.2.1', '实际保险理赔'],
  ['1.2.2', '实际维持费用'],
  ['1.2.3', '长险保险获取费用的分摊'],
  ['1.2.4', '亏损部分的分摊'],
  ['1.2.5', '首日亏损'],
  ['1.2.6', '亏损部分的加剧或转回'],
  ['1.2.7', '短险理赔和费用支出'],
  ['1.2.8', '短险保险获取费用'],
  ['1.2.9', '短险亏损部分提转差'],
  ['1.2.10', '已发生赔款负债的调整'],
  ['2.1.1', '再保CSM摊销'],
  ['2.1.2', '再保预期赔付费用'],
  ['2.1.3', '再保PAA保费分摊'],
  ['2.2.1', '再保摊回实际赔付费用'],
  ['2.2.2', '再保亏损部分的确认和转回'],
  ['2.2.3', '再保非PAA已发生赔款调整'],
  ['2.2.4', '再保NPR提转差'],
  ['2.2.5', '再保PAA再保险服务费用'],
  ['3.1.1', '利息收入'],
  ['3.1.2', '公允价值变动'],
  ['3.1.3', '其他'],
  ['3.2.1.1', '非VFA_BEL计息'],
  ['3.2.1.2', '非VFA_CSM计息'],
  ['3.2.1.3', 'VFA公允价值变动'],
  ['3.2.1.4', '其他利息成本'],
  ['3.2.2', '再保合同计息'],
  ['4.1.1', '非履约费用'],
  ['5', '企业所得税'],
].map(([code, label]) => ({ code, label }))

const longSheetTree = [
  {
    code: '1',
    label: '保险服务业绩',
    children: [
      {
        code: '1.1',
        label: '保险服务收入',
        children: longSheetLeafMeta.filter((row) => row.code.startsWith('1.1.')),
      },
      {
        code: '1.2',
        label: '保险服务费用',
        children: longSheetLeafMeta.filter((row) => row.code.startsWith('1.2.')),
      },
    ],
  },
  {
    code: '2',
    label: '再保险服务业绩',
    children: [
      {
        code: '2.1',
        label: '分出保费的分摊',
        children: longSheetLeafMeta.filter((row) => row.code.startsWith('2.1.')),
      },
      {
        code: '2.2',
        label: '摊回保险服务费用',
        children: longSheetLeafMeta.filter((row) => row.code.startsWith('2.2.')),
      },
    ],
  },
  {
    code: '3',
    label: '投资服务业绩',
    children: [
      {
        code: '3.1',
        label: '投资收益',
        children: longSheetLeafMeta.filter((row) => row.code.startsWith('3.1.')),
      },
      {
        code: '3.2',
        label: '承保财务损益',
        children: [
          {
            code: '3.2.1',
            label: '直保合同计息',
            children: longSheetLeafMeta.filter((row) => row.code.startsWith('3.2.1.')),
          },
          longSheetLeafMeta.find((row) => row.code === '3.2.2'),
        ],
      },
    ],
  },
  {
    code: '4',
    label: '其他',
    children: [
      {
        code: '4.1',
        label: '其他利润',
        children: [longSheetLeafMeta.find((row) => row.code === '4.1.1')],
      },
    ],
  },
  longSheetLeafMeta.find((row) => row.code === '5'),
]

const operatingBridgeRows = [
  { code: 'insurance-service', label: '保险服务业绩', linePrefix: ['1.'] },
  { code: 'reinsurance-service', label: '再保险服务业绩', linePrefix: ['2.'] },
  { code: 'investment-income', label: '投资收益', linePrefix: ['3.1.'] },
  { code: 'insurance-finance', label: '承保财务损益', linePrefix: ['3.2.'] },
  { code: 'other-profit', label: '其他利润', linePrefix: ['4.1.'] },
  { code: 'profit-before-tax', label: '税前利润', linePrefix: ['1.', '2.', '3.', '4.1.'] },
  { code: 'income-tax', label: '企业所得税', linePrefix: ['5'] },
  { code: 'profit-after-tax', label: '税后利润', linePrefix: ['1.', '2.', '3.', '4.', '5'] },
  { code: 'oci', label: 'OCI', bucket: 'OCI' },
  { code: 'comprehensive-income', label: '综合收益总额', comprehensive: true },
]

const dashboardNotes = [
  '原始 workbook 提供了利润要素 taxonomy，但管理层展示所需的再保险、税项和非履约费用口径不完整，因此本数据库补入了少量 supplemental taxonomy 行用于完整展示。',
  'Long sheet 映射优先遵循 IFRS 17 展示口径；Driver sheet 直接沿用 报表归属 + Driver大类 + Driver小类 三层标签。',
  'Operating / Non-Operating 表采用管理口径，保留源数据中的 Operating/Non-Op 标签，并在行项目上汇总为可读的营运利润桥。',
  '数字为可分析 mock database，已保证 PL、OCI、CSMLC 和 BS 的主表层面关系自洽，便于后续继续替换为真实数据。 ',
]

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function splitAmount(total, weightedEntries) {
  const entries = weightedEntries.filter((entry) => entry.weight > 0)
  if (entries.length === 0) {
    return []
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0)
  let running = 0

  return entries.map((entry, index) => {
    if (index === entries.length - 1) {
      return { ...entry, amount: round2(total - running) }
    }

    const amount = round2((total * entry.weight) / totalWeight)
    running = round2(running + amount)
    return { ...entry, amount }
  })
}

function riskTokenWeight(item) {
  if (item.includes('死亡')) return 0.28
  if (item.includes('疾病')) return 0.22
  if (item.includes('意外')) return 0.08
  if (item.includes('医疗健康')) return 0.1
  if (item.includes('豁免')) return 0.07
  if (item.includes('年金')) return 0.09
  if (item.includes('退保')) return 0.1
  if (item.includes('满期')) return 0.06
  if (item.includes('红利')) return 0.1
  return 0.08
}

function expenseTokenWeight(item) {
  if (item.includes('佣金-直接')) return 0.18
  if (item.includes('佣金-其他')) return 0.11
  if (item.includes('普通间接佣金')) return 0.1
  if (item.includes('管理费用')) return 0.18
  if (item.includes('支持费用')) return 0.15
  if (item.includes('Conservation PRE')) return 0.09
  if (item.includes('业务监管费')) return 0.06
  if (item.includes('税金及附加')) return 0.05
  if (item.includes('资本金监管费')) return 0.03
  if (item.includes('保险保障基金')) return 0.05
  if (item.includes('渠道直接费用')) return 0.05
  if (item.includes('PRE营业费')) return 0.06
  if (item.includes('PRE间佣')) return 0.05
  if (item.includes('间佣-财补')) return 0.03
  if (item.includes('其他费用')) return 0.1
  return 0.08
}

function lineWeight(row, mappingKey) {
  if (
    mappingKey === 'pl:1.1.3' ||
    mappingKey === 'pl:1.2.1' ||
    mappingKey === 'pl:1.2.10' ||
    mappingKey === 'csmlc:investment-component' ||
    mappingKey === 'csmlc:death-reserve-change' ||
    mappingKey === 'csmlc:disease-reserve-change' ||
    mappingKey === 'csmlc:surrender-reserve-change'
  ) {
    return riskTokenWeight(row.item)
  }

  if (
    mappingKey === 'pl:1.1.4' ||
    mappingKey === 'pl:1.2.2' ||
    mappingKey === 'csmlc:acquisition-variance'
  ) {
    return expenseTokenWeight(row.item)
  }

  if (mappingKey === 'pl:1.2.7') {
    if (row.item.includes('短险理赔')) return 0.5
    if (row.item.includes('短险维持费用')) return 0.16
    if (row.item.includes('CY')) return 0.22
    if (row.item.includes('进展因子调整')) return 0.12
  }

  if (mappingKey === 'pl:1.1.7') {
    if (row.item.includes('短险当期保费收入')) return 0.64
    if (row.item.includes('短险未到期提转差')) return 0.24
    if (row.item === '获取费用分摊') return 0.12
  }

  if (mappingKey === 'oci:asset-oci') {
    if (row.item.includes('权益工具')) return 0.46
    if (row.item.includes('公允价值')) return 0.38
    if (row.item.includes('信用损失')) return 0.16
  }

  if (mappingKey === 'csmlc:new-business-bel') return 1
  if (mappingKey === 'csmlc:new-business-ra') return 1
  if (mappingKey === 'csmlc:new-business-csm') return 1

  return 1
}

function inferMappingKey(row) {
  const item = row.item
  const bucket = row.statementBucket
  const minor = row.driverMinor

  if (bucket === 'BS') {
    if (item.includes('期初BEL')) return 'bs:opening-bel'
    if (item.includes('期初RA')) return 'bs:opening-ra'
    if (item.includes('期初CSM')) return 'bs:opening-csm'
    if (item.includes('期末BEL')) return 'bs:closing-bel'
    if (item.includes('期末RA')) return 'bs:closing-ra'
    if (item.includes('期末CSM')) return 'bs:closing-csm'
    if (item.includes('短险期初获取费用')) return 'bs:opening-short-acq'
    if (item.includes('短险期末获取费用')) return 'bs:closing-short-acq'
    return null
  }

  if (bucket === 'OCI') {
    if (item === '预期红利给付') return 'oci:expected-dividend'
    if (item === '现金流偏差调整-CUR校准') return 'oci:discount-rate'
    if (item === '经济经验偏差调整-BEL') return 'oci:economic-variance'
    if (item === '当期TVOG释放的偏差-CURR校准') return 'oci:tvog'
    if (item === '实际红利给付') return 'oci:actual-dividend'
    if (item === '特储提转差') return 'oci:cat-reserve'
    if (item === 'VFA-UI FVOCI') return 'oci:vfa-fvoci'
    if (item.includes('投资')) return 'oci:asset-oci'
    return null
  }

  if (bucket === 'CSMLC') {
    if (item === '期初优化') return 'csmlc:model-change'
    if (item.startsWith('预期获取费用') || item.startsWith('实际获取费用')) return 'csmlc:acquisition-variance'
    if (item === '预期保费' || item === '实际保费') return 'csmlc:premium-variance'
    if (item.startsWith('预期投资成分') || item.startsWith('实际投资成分')) return 'csmlc:investment-component'
    if (item === '死亡经验调整') return 'csmlc:death-reserve-change'
    if (item === '疾病经验调整') return 'csmlc:disease-reserve-change'
    if (item === '退保经验调整') return 'csmlc:surrender-reserve-change'
    if (item === '豁免经验调整' || item === '其他经验调整' || item === 'RA变动') return 'csmlc:other-reserve-change'
    if (item === '死亡率调整' || item === '疾病率调整' || item === '退保率调整' || item === '费用调整') {
      return 'csmlc:assumption-change'
    }
    if (item === '未决准备金提转差-CY-投资成分（进展因子调整）') return 'csmlc:ibnr-progress'
    if (item === '新单初始确认-BEL') return 'csmlc:new-business-bel'
    if (item === '新单初始确认-RA') return 'csmlc:new-business-ra'
    if (item === '新单初始确认-CSM') return 'csmlc:new-business-csm'
    return null
  }

  if (bucket !== 'PL') {
    return null
  }

  if (item === '企业所得税') return 'pl:5'
  if (item === '长险保险获取费用摊销费用') return 'pl:1.2.3'
  if (item === '亏损部分的分摊费用') return 'pl:1.2.4'
  if (item === '非履约费用') return 'pl:4.1.1'

  if (item === '再保CSM摊销') return 'pl:2.1.1'
  if (item === '再保预期赔付费用') return 'pl:2.1.2'
  if (item === '再保PAA保费分摊') return 'pl:2.1.3'
  if (item === '再保摊回实际赔付费用') return 'pl:2.2.1'
  if (item === '再保亏损部分的确认和转回') return 'pl:2.2.2'
  if (item === '再保非PAA已发生赔款调整') return 'pl:2.2.3'
  if (item === '再保NPR提转差') return 'pl:2.2.4'
  if (item === '再保PAA再保险服务费用') return 'pl:2.2.5'
  if (item === '再保合同计息') return 'pl:3.2.2'

  if (item === 'CSM释放') return 'pl:1.1.1'
  if (item === 'RA释放') return 'pl:1.1.2'
  if (minor === '预期保险理赔') return 'pl:1.1.3'
  if (minor === '预期维持费用') return 'pl:1.1.4'
  if (minor === '长险保险获取费用的分摊') return 'pl:1.1.5'
  if (minor === '亏损部分的分摊') return 'pl:1.1.6'
  if (minor === '短险已赚保费') return 'pl:1.1.7'
  if (minor === '实际保险理赔') return 'pl:1.2.1'
  if (minor === '实际维持费用') return 'pl:1.2.2'
  if (minor === '首日亏损' || item.includes('新单初始确认-LC')) return 'pl:1.2.5'
  if (minor === '亏损部分的加剧或转回') return 'pl:1.2.6'
  if (minor === '短险理赔和费用支出') return 'pl:1.2.7'
  if (minor === '短险保险获取费用的分摊') return 'pl:1.2.8'
  if (minor === '短险亏损部分提转差') return 'pl:1.2.9'
  if (minor === '已发生赔款负债的调整') return 'pl:1.2.10'
  if (minor === '利息收入') return 'pl:3.1.1'
  if (minor === '公允价值变动') return 'pl:3.1.2'
  if (item === '投资收益' || item === '资产处置收益') return 'pl:3.1.3'
  if (minor === '非VFA_BEL计息') return 'pl:3.2.1.1'
  if (minor === '非VFA_CSM计息') return 'pl:3.2.1.2'
  if (item === 'VFA-UI FVTPL') return 'pl:3.2.1.3'
  if (minor === 'TVOG释放') return 'pl:3.2.1.4'
  return null
}

function inferView(row, mappingKey) {
  if (mappingKey?.startsWith('pl:')) return 'profit'
  if (mappingKey?.startsWith('oci:')) return 'oci'
  if (mappingKey?.startsWith('csmlc:')) return 'csmlc'
  if (mappingKey?.startsWith('bs:')) return 'bs'
  return row.statementBucket.toLowerCase() || 'other'
}

function operatingBridgeCode(mappingKey) {
  if (!mappingKey) return null
  if (mappingKey.startsWith('pl:1.')) return 'insurance-service'
  if (mappingKey.startsWith('pl:2.')) return 'reinsurance-service'
  if (mappingKey.startsWith('pl:3.1.')) return 'investment-income'
  if (mappingKey.startsWith('pl:3.2.')) return 'insurance-finance'
  if (mappingKey.startsWith('pl:4.1.')) return 'other-profit'
  if (mappingKey.startsWith('pl:5')) return 'income-tax'
  if (mappingKey.startsWith('oci:')) return 'oci'
  return null
}

function dimensionBias(profile, row, mappingKey) {
  const text = `${row.item} ${row.driverMajor} ${row.driverMinor}`
  let weight = 1

  if (mappingKey?.startsWith('pl:2.') || mappingKey === 'pl:3.2.2') {
    if (profile.origOrReins !== '再保') return 0
    weight *= 1.4
  } else if (mappingKey === 'pl:4.2') {
    weight *= 1
  } else {
    if (profile.origOrReins !== '原保') return 0
  }

  if (mappingKey === 'bs:closing-ra' || mappingKey === 'bs:opening-ra') {
    weight *= profile.origOrReins === '再保' ? 1.35 : 0.9
  }

  if (/死亡|疾病|意外|医疗健康|豁免|重疾|CLM/.test(text)) {
    weight *= profile.productGroup === '重疾' ? 1.65 : 0.7
    weight *= profile.productType === '终身重疾' ? 1.12 : profile.productType === '定期重疾' ? 1.05 : 0.82
  }

  if (/红利|VFA|年金|满期|退保|储蓄|分红|万能|投成/.test(text)) {
    weight *= profile.productGroup === '储蓄' ? 1.7 : 0.74
    if (/红利|VFA/.test(text)) {
      weight *= profile.measurementModel === 'VFA' ? 1.7 : 0.76
    }
    if (/万能/.test(text)) {
      weight *= profile.measurementModel === 'MBBA' ? 1.5 : 0.85
    }
  }

  if (/短险|未决准备金|PAA/.test(text)) {
    weight *= profile.productType === '定期重疾' ? 1.32 : 0.92
  }

  if (/费用|佣金|获取/.test(text)) {
    weight *= profile.channel === '代理人' ? 1.18 : 0.88
  }

  if (/投资|利息|公允价值|OCI/.test(text)) {
    weight *= profile.account === '分红' ? 1.16 : profile.account === '万能' ? 1.08 : 0.94
  }

  weight *= profile.branch === '上海分' ? 1.06 : 0.94

  const varianceSeed = `${mappingKey}|${profile.goc}|${profile.measurementModel}|${profile.channel}|${profile.productType}`
  let hash = 0
  for (const char of varianceSeed) hash = (hash * 31 + char.charCodeAt(0)) % 997
  weight *= 0.88 + (hash % 19) / 100

  return Math.max(weight, 0.01)
}

function profileWeightsForRow(row, mappingKey) {
  if (mappingKey === 'pl:4.2') {
    return []
  }

  return dimensionProfiles.map((profile) => ({
    profileId: profile.id,
    weight: dimensionBias(profile, row, mappingKey),
  }))
}

const groups = new Map()

for (const row of allTaxonomy) {
  const mappingKey = inferMappingKey(row)
  if (!mappingKey) {
    continue
  }

  const groupRows = groups.get(mappingKey) || []
  groupRows.push({
    ...row,
    mappingKey,
    view: inferView(row, mappingKey),
    longSheetCode: mappingKey.startsWith('pl:') ? mappingKey.slice(3) : null,
    operatingBridge: operatingBridgeCode(mappingKey),
  })
  groups.set(mappingKey, groupRows)
}

const records = []
let recordSequence = 1

for (const [mappingKey, groupRows] of groups.entries()) {
  if (!(mappingKey in mappingTotals) || mappingKey === 'pl:4.2') {
    continue
  }

  const groupTotal = mappingTotals[mappingKey]
  const rowSplits = splitAmount(
    groupTotal,
    groupRows.map((row) => ({
      row,
      weight: lineWeight(row, mappingKey),
    })),
  )

  for (const rowSplit of rowSplits) {
    const profileSplits = splitAmount(
      rowSplit.amount,
      profileWeightsForRow(rowSplit.row, mappingKey).map((entry) => ({
        ...entry,
        weight: entry.weight,
      })),
    )

    for (const profileSplit of profileSplits) {
      const profile = profileById[profileSplit.profileId]
      records.push({
        id: `rec-${String(recordSequence).padStart(4, '0')}`,
        taxonomyId: rowSplit.row.id,
        item: rowSplit.row.item,
        source: rowSplit.row.source,
        sourceRow: rowSplit.row.sourceRow,
        liabilityComponent: rowSplit.row.liabilityComponent || 'Param',
        statementBucket: rowSplit.row.statementBucket,
        driverMajor: rowSplit.row.driverMajor || 'Param',
        driverMinor: rowSplit.row.driverMinor || 'Param',
        operatingCategory: rowSplit.row.operatingCategory || 'Operating',
        amount: profileSplit.amount,
        amountUnit: 'CNY mn',
        profileId: profile.id,
        valYear: profile.valYear,
        goc: profile.goc,
        reGoc: profile.reGoc,
        origOrReins: profile.origOrReins,
        ifNb: profile.ifNb,
        measurementModel: profile.measurementModel,
        account: profile.account,
        channel: profile.channel,
        branch: profile.branch,
        productGroup: profile.productGroup,
        productType: profile.productType,
        treaty: profile.treaty,
        scenario: profile.scenario,
        mappingKey,
        longSheetCode: rowSplit.row.longSheetCode,
        operatingBridgeCode: rowSplit.row.operatingBridge,
        view: rowSplit.row.view,
      })
      recordSequence += 1
    }
  }
}

const preTaxByProfile = Object.fromEntries(
  dimensionProfiles.map((profile) => [
    profile.id,
    round2(
      records
        .filter((record) => record.profileId === profile.id && record.statementBucket === 'PL')
        .reduce((sum, record) => sum + record.amount, 0),
    ),
  ]),
)

const taxWeights = splitAmount(
  mappingTotals['pl:4.2'],
  Object.entries(preTaxByProfile).map(([profileId, amount]) => ({
    profileId,
    weight: Math.max(Math.abs(amount), 0.01),
  })),
)

for (const taxSplit of taxWeights) {
  const profile = profileById[taxSplit.profileId]
  records.push({
    id: `rec-${String(recordSequence).padStart(4, '0')}`,
    taxonomyId: 'sup-013',
    item: '企业所得税',
    source: 'supplemental',
    sourceRow: null,
    liabilityComponent: 'Tax',
    statementBucket: 'PL',
    driverMajor: 'Tax',
    driverMinor: '企业所得税',
    operatingCategory: 'Non-Operating',
    amount: taxSplit.amount,
    amountUnit: 'CNY mn',
    profileId: profile.id,
    valYear: profile.valYear,
    goc: profile.goc,
    reGoc: profile.reGoc,
    origOrReins: profile.origOrReins,
    ifNb: profile.ifNb,
    measurementModel: profile.measurementModel,
    account: profile.account,
    channel: profile.channel,
    branch: profile.branch,
    productGroup: profile.productGroup,
    productType: profile.productType,
    treaty: profile.treaty,
    scenario: profile.scenario,
    mappingKey: 'pl:5',
    longSheetCode: '5',
    operatingBridgeCode: 'income-tax',
    view: 'profit',
  })
  recordSequence += 1
}

const managementDimensions = [
  ['valYear', 'ValYr'],
  ['goc', 'GOC'],
  ['reGoc', 'reGOC'],
  ['origOrReins', '原保/再保'],
  ['ifNb', 'IF/NB'],
  ['measurementModel', '计量模型'],
  ['account', '账户'],
  ['channel', '渠道'],
  ['branch', '机构'],
  ['productGroup', '产品大类'],
  ['productType', '产品类型'],
  ['treaty', '再保合约'],
].map(([key, label]) => ({
  key,
  label,
  options: [...new Set(records.map((record) => record[key]).filter(Boolean))].sort(),
}))

const taxonomy = allTaxonomy.map((row) => ({
  id: row.id,
  source: row.source,
  sourceRow: row.sourceRow,
  item: row.item,
  liabilityComponent: row.liabilityComponent,
  statementBucket: row.statementBucket,
  driverMajor: row.driverMajor,
  driverMinor: row.driverMinor,
  operatingCategory: row.operatingCategory,
  mappingKey: inferMappingKey(row),
}))

const output = {
  generatedAt: new Date().toISOString(),
  workbookFile: sourceWorkbookName,
  currency: 'CNY mn',
  dimensionProfiles,
  profileCombinationCount: dimensionProfiles.length,
  longSheetTree,
  longSheetLeafMeta,
  operatingBridgeRows,
  managementDimensions,
  dashboardNotes,
  taxonomy,
  records,
}

const profileIndexById = Object.fromEntries(
  dimensionProfiles.map((profile, index) => [profile.id, index]),
)

function roundVector(values) {
  return values.map((value) => round2(value))
}

function addToVectorMap(map, key, profileIndex, amount) {
  if (!key) return

  if (!map[key]) {
    map[key] = Array(dimensionProfiles.length).fill(0)
  }

  map[key][profileIndex] += amount
}

function operatingRowMatches(record, row) {
  if (row.comprehensive) {
    return record.statementBucket === 'PL' || record.statementBucket === 'OCI'
  }

  if (row.bucket) {
    return record.statementBucket === row.bucket
  }

  if (row.linePrefix) {
    return row.linePrefix.some((prefix) => record.longSheetCode?.startsWith(prefix))
  }

  return false
}

const statementBucketVectors = {}
const longSheetVectors = {}
const driverSectionVectors = {}
const driverMajorVectors = {}
const driverMinorVectors = {}
const taxonomyVectors = {}
const mappingKeyVectors = {}

for (const record of records) {
  const profileIndex = profileIndexById[record.profileId]
  addToVectorMap(statementBucketVectors, record.statementBucket, profileIndex, record.amount)
  addToVectorMap(driverSectionVectors, record.statementBucket, profileIndex, record.amount)
  addToVectorMap(longSheetVectors, record.longSheetCode, profileIndex, record.amount)
  addToVectorMap(taxonomyVectors, record.taxonomyId, profileIndex, record.amount)
  addToVectorMap(mappingKeyVectors, record.mappingKey, profileIndex, record.amount)

  if (record.driverMajor && record.driverMajor !== 'Param' && ['PL', 'OCI', 'CSMLC'].includes(record.statementBucket)) {
    addToVectorMap(
      driverMajorVectors,
      `${record.statementBucket}|${record.driverMajor}`,
      profileIndex,
      record.amount,
    )
    addToVectorMap(
      driverMinorVectors,
      `${record.statementBucket}|${record.driverMajor}|${record.driverMinor}`,
      profileIndex,
      record.amount,
    )
  }
}

const operatingRows = Object.fromEntries(
  operatingBridgeRows.map((row) => [
    row.code,
    {
      label: row.label,
      operating: Array(dimensionProfiles.length).fill(0),
      nonOperating: Array(dimensionProfiles.length).fill(0),
    },
  ]),
)

for (const record of records) {
  const profileIndex = profileIndexById[record.profileId]

  for (const row of operatingBridgeRows) {
    if (!operatingRowMatches(record, row)) continue
    const bucket = record.operatingCategory === 'Operating' ? 'operating' : 'nonOperating'
    operatingRows[row.code][bucket][profileIndex] += record.amount
  }
}

const managementCube = {
  generatedAt: output.generatedAt,
  workbookFile: output.workbookFile,
  currency: output.currency,
  profileCombinationCount: output.profileCombinationCount,
  rawRecordCount: records.length,
  rawDataPath: '/data/ifrs17-seed.json',
  previewDataPath: '/data/ifrs17-fact-preview.json',
  dimensionProfiles,
  longSheetTree,
  longSheetLeafMeta,
  operatingBridgeRows,
  managementDimensions,
  dashboardNotes,
  taxonomy,
  statementBucketVectors: Object.fromEntries(
    Object.entries(statementBucketVectors).map(([key, values]) => [key, roundVector(values)]),
  ),
  longSheetVectors: Object.fromEntries(
    Object.entries(longSheetVectors).map(([key, values]) => [key, roundVector(values)]),
  ),
  driverSectionVectors: Object.fromEntries(
    Object.entries(driverSectionVectors).map(([key, values]) => [key, roundVector(values)]),
  ),
  driverMajorVectors: Object.fromEntries(
    Object.entries(driverMajorVectors).map(([key, values]) => [key, roundVector(values)]),
  ),
  driverMinorVectors: Object.fromEntries(
    Object.entries(driverMinorVectors).map(([key, values]) => [key, roundVector(values)]),
  ),
  taxonomyVectors: Object.fromEntries(
    Object.entries(taxonomyVectors).map(([key, values]) => [key, roundVector(values)]),
  ),
  mappingKeyVectors: Object.fromEntries(
    Object.entries(mappingKeyVectors).map(([key, values]) => [key, roundVector(values)]),
  ),
  operatingRows: Object.fromEntries(
    Object.entries(operatingRows).map(([key, row]) => [
      key,
      {
        label: row.label,
        operating: roundVector(row.operating),
        nonOperating: roundVector(row.nonOperating),
      },
    ]),
  ),
}

const previewRecords = [...records]
  .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
  .slice(0, 1000)

const previewOutput = {
  ...output,
  records: previewRecords,
  previewRecordCount: previewRecords.length,
  rawRecordCount: records.length,
}

fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true })
fs.writeFileSync(outputJsonPath, JSON.stringify(output), 'utf8')
fs.writeFileSync(outputCubePath, JSON.stringify(managementCube), 'utf8')
fs.writeFileSync(outputPreviewPath, JSON.stringify(previewOutput), 'utf8')

const stub = `export const ifrs17SeedStub = {\n  generatedAt: ${JSON.stringify(output.generatedAt)},\n  workbookFile: ${JSON.stringify(output.workbookFile)},\n  currency: ${JSON.stringify(output.currency)},\n  profileCombinationCount: ${output.profileCombinationCount},\n  recordCount: ${records.length},\n  dataPath: '/data/ifrs17-seed.json',\n  cubePath: '/data/ifrs17-management-cube.json',\n} as const\n`

fs.mkdirSync(path.dirname(outputStubPath), { recursive: true })
fs.writeFileSync(outputStubPath, stub, 'utf8')

console.log(`Generated ${records.length} records into ${path.relative(projectRoot, outputJsonPath)}`)
console.log(`Generated management cube into ${path.relative(projectRoot, outputCubePath)}`)
console.log(`Generated fact preview into ${path.relative(projectRoot, outputPreviewPath)}`)
