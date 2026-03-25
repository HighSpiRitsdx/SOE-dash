import {
  Fragment,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Filter,
  NotebookText,
  PanelsTopLeft,
  RefreshCw,
  TableProperties,
  Upload,
} from 'lucide-react'
import './App.css'
import { ChinaBranchMap } from './components/ChinaBranchMap'
import { DimensionPieCard } from './components/DimensionPieCard'
import { ProfitAttributionTree } from './components/ProfitAttributionTree'
import {
  amountTone,
  buildTaxonomyCoverage,
  buildWorkingRows,
  filterRecords,
  formatAmount,
  formatSignedAmount,
  type Filters as RawFilters,
  type SeedData,
} from './lib/ifrs17'
import {
  buildManagementView,
  createInitialCubeFilters,
  type CubeFilters,
  type ManagementCube,
} from './lib/management-cube'

type TabKey = 'dashboard' | 'attribution' | 'detail' | 'mapping'

const tabMeta: Array<{ key: TabKey; label: string; icon: typeof PanelsTopLeft }> = [
  { key: 'dashboard', label: 'Management Dashboard', icon: PanelsTopLeft },
  { key: 'attribution', label: 'Driver Tree', icon: PanelsTopLeft },
  { key: 'detail', label: 'Working Detail', icon: TableProperties },
  { key: 'mapping', label: 'Mapping Notes', icon: NotebookText },
]

function isManagementCube(value: unknown): value is ManagementCube {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ManagementCube>

  return (
    Array.isArray(candidate.managementDimensions) &&
    Array.isArray(candidate.dimensionProfiles) &&
    !!candidate.statementBucketVectors &&
    !!candidate.longSheetVectors
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [cube, setCube] = useState<ManagementCube | null>(null)
  const [rawSeed, setRawSeed] = useState<SeedData | null>(null)
  const [seedError, setSeedError] = useState('')
  const [rawLoading, setRawLoading] = useState(true)
  const [importMessage, setImportMessage] = useState('')
  const [draftFilters, setDraftFilters] = useState<CubeFilters>({} as CubeFilters)
  const [appliedFilters, setAppliedFilters] = useState<CubeFilters>({} as CubeFilters)
  const [search, setSearch] = useState('')
  const [collapsedDriverGroups, setCollapsedDriverGroups] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true

    fetch('/data/ifrs17-management-cube.json')
      .then((response) => {
        if (!response.ok) throw new Error(`无法加载 management cube (${response.status})`)
        return response.json() as Promise<ManagementCube>
      })
      .then((payload) => {
        if (!active) return
        const initialFilters = createInitialCubeFilters(payload)
        setCube(payload)
        setDraftFilters(initialFilters)
        setAppliedFilters(initialFilters)
        setSeedError('')
        setImportMessage(`当前使用 management cube: ${payload.workbookFile}`)
      })
      .catch((error: Error) => {
        if (!active) return
        setSeedError(error.message || '无法加载 management cube')
      })

    fetch('/data/ifrs17-fact-preview.json')
      .then((response) => {
        if (!response.ok) throw new Error(`无法加载 working detail preview (${response.status})`)
        return response.json() as Promise<SeedData>
      })
      .then((payload) => {
        if (!active) return
        setRawSeed(payload)
      })
      .catch(() => {
        if (!active) return
        setRawSeed(null)
      })
      .finally(() => {
        if (!active) return
        setRawLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const deferredAppliedFilters = useDeferredValue(appliedFilters)
  const deferredSearch = useDeferredValue(search)

  const hasPendingChanges = useMemo(() => {
    if (!cube) return false

    return cube.managementDimensions.some(
      (dimension) => draftFilters[dimension.key] !== appliedFilters[dimension.key],
    )
  }, [appliedFilters, cube, draftFilters])

  const handleFilterChange = (key: string, value: string) => {
    setDraftFilters((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const handleApply = () => {
    startTransition(() => {
      setAppliedFilters(draftFilters)
    })
  }

  const handleReset = () => {
    if (!cube) return
    const initialFilters = createInitialCubeFilters(cube)
    setDraftFilters(initialFilters)
    startTransition(() => {
      setAppliedFilters(initialFilters)
    })
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    try {
      const payload = JSON.parse(await file.text()) as unknown

      if (!isManagementCube(payload)) {
        throw new Error('当前导入口仅支持 management cube JSON，请先做预聚合。')
      }

      startTransition(() => {
        const initialFilters = createInitialCubeFilters(payload)
        setCube(payload)
        setRawSeed(null)
        setRawLoading(false)
        setDraftFilters(initialFilters)
        setAppliedFilters(initialFilters)
        setSearch('')
        setCollapsedDriverGroups(new Set())
        setActiveTab('dashboard')
        setSeedError('')
        setImportMessage(`当前使用导入 cube: ${file.name}`)
      })
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : '导入失败，请检查 JSON 文件格式')
    }
  }

  const handleExportCurrent = () => {
    if (!cube) return

    const blob = new Blob([JSON.stringify(cube, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'ifrs17-management-cube.json'
    link.click()

    URL.revokeObjectURL(url)
  }

  const managementView = useMemo(
    () => (cube ? buildManagementView(cube, deferredAppliedFilters) : null),
    [cube, deferredAppliedFilters],
  )

  useEffect(() => {
    if (!managementView) return
    const validKeys = new Set(managementView.driverGroups.map((group) => group.key))
    setCollapsedDriverGroups((current) => new Set([...current].filter((key) => validKeys.has(key))))
  }, [managementView])

  const rawFilteredRecords = useMemo(() => {
    if (!rawSeed) return []
    return filterRecords(rawSeed, rawSeed.records, deferredAppliedFilters as RawFilters)
  }, [deferredAppliedFilters, rawSeed])

  const workingRows = useMemo(() => {
    if (!rawSeed) return []
    return buildWorkingRows(rawFilteredRecords, deferredSearch)
  }, [deferredSearch, rawFilteredRecords, rawSeed])

  const taxonomyCoverage = useMemo(() => {
    if (!rawSeed) return []
    return buildTaxonomyCoverage(rawSeed, rawFilteredRecords, deferredSearch)
  }, [deferredSearch, rawFilteredRecords, rawSeed])

  if (!cube || !managementView) {
    return (
      <div className="app-shell app-shell--loading">
        <main className="content-panel">
          <header className="page-header">
            <div>
              <p className="eyebrow">IFRS17 SOE</p>
              <h2>{seedError ? 'Management cube 加载失败' : '正在加载 IFRS17 management cube'}</h2>
              <p className="page-description">
                {seedError || '正在读取预聚合 management cube，目标是让管理层筛选接近瞬时响应。'}
              </p>
            </div>
          </header>
        </main>
      </div>
    )
  }

  const periodDimension = cube.managementDimensions.find((dimension) => dimension.key === 'valYear')
  const periodLabel = draftFilters.valYear || periodDimension?.options[0] || 'Current'
  const piePalette = ['#00338D', '#005EB8', '#4F7CAC', '#8AA9C7', '#C9D9EB']
  const driverGroupKeys = managementView.driverGroups.map((group) => group.key)
  const detailProfileRows = managementView.profilePerformance.slice(0, 120)

  const toggleDriverGroup = (key: string) => {
    setCollapsedDriverGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandAllDrivers = () => {
    setCollapsedDriverGroups(new Set())
  }

  const collapseAllDrivers = () => {
    setCollapsedDriverGroups(new Set(driverGroupKeys))
  }

  return (
    <div className="app-shell">
      <aside className="sidebar-panel">
        <div className="brand-block brand-block--compact">
          <div className="brand-mark">SOE</div>
          <div>
            <p className="eyebrow">IFRS 17</p>
            <h1>IFRS17 SOE</h1>
          </div>
        </div>

        <div className="panel-section">
          <div className="section-heading">
            <Filter size={16} />
            <span>Management Filters</span>
          </div>

          <div className="filter-grid">
            {cube.managementDimensions.map((dimension) => (
              <label className="filter-field" key={dimension.key}>
                <span>
                  {dimension.label}
                  <em>{dimension.options.length} 项</em>
                </span>
                <select
                  value={draftFilters[dimension.key] ?? ''}
                  onChange={(event) => handleFilterChange(dimension.key, event.target.value)}
                >
                  <option value="">全部</option>
                  {dimension.options.map((option) => (
                    <option key={`${dimension.key}-${option}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="sidebar-actions sidebar-actions--stacked">
            <div className="sidebar-button-row">
              <button
                className="primary-button"
                type="button"
                onClick={handleApply}
                disabled={!hasPendingChanges}
              >
                <Check size={14} />
                确定
              </button>
              <button className="primary-button primary-button--ghost" type="button" onClick={handleReset}>
                <RefreshCw size={14} />
                重置
              </button>
            </div>
            <div className="sidebar-metric">
              <strong>{formatAmount(managementView.selectedProfileCount)}</strong>
              <span>个已应用 profile</span>
            </div>
          </div>
          {hasPendingChanges ? (
            <p className="sidebar-copy sidebar-copy--small">
              你有未应用的筛选，点“确定”后再刷新结果。
            </p>
          ) : null}
        </div>

        <div className="panel-section">
          <div className="section-heading">
            <Upload size={16} />
            <span>Data Import / Export</span>
          </div>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
          />
          <div className="io-actions">
            <button className="primary-button primary-button--ghost" type="button" onClick={handleImportClick}>
              <Upload size={14} />
              导入 Cube
            </button>
            <button className="primary-button primary-button--ghost" type="button" onClick={handleExportCurrent}>
              <Download size={14} />
              导出当前 Cube
            </button>
          </div>
          <p className="sidebar-copy sidebar-copy--small">
            {importMessage || '支持导入预聚合 management cube JSON。'}
          </p>
          <p className="sidebar-copy sidebar-copy--small">
            Working Detail 已在首屏预载 1000 行 preview，切换 tab 不再等整包 raw fact。
          </p>
        </div>

        <div className="panel-section panel-section--subtle">
          <div className="section-heading">
            <Database size={16} />
            <span>Data Coverage</span>
          </div>
          <dl className="definition-grid">
            <div>
              <dt>Workbook taxonomy</dt>
              <dd>{formatAmount(managementView.coverageStats.workbookItems)}</dd>
            </div>
            <div>
              <dt>Supplemental taxonomy</dt>
              <dd>{formatAmount(managementView.coverageStats.supplementalItems)}</dd>
            </div>
            <div>
              <dt>Dimension profiles</dt>
              <dd>{formatAmount(cube.dimensionProfiles.length)}</dd>
            </div>
            <div>
              <dt>Mapped items</dt>
              <dd>{formatAmount(managementView.coverageStats.mappedItems)}</dd>
            </div>
          </dl>
        </div>
      </aside>

      <main className="content-panel">
        <header className="page-header">
          <div>
            <p className="eyebrow">KPMG-style management dashboard</p>
            <h2>Management dashboard, driver tree and working preview</h2>
            <p className="page-description">
              管理层页面只读取预聚合 cube；利源归因单独成页；工作层默认展示已预载的 1000 行 preview。
            </p>
          </div>
          <div className="header-meta">
            <span>{cube.currency}</span>
            <span>{cube.workbookFile}</span>
            <span>{new Date(cube.generatedAt).toLocaleString('zh-CN')}</span>
          </div>
        </header>

        <nav className="tab-bar" aria-label="Dashboard views">
          {tabMeta.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                className={`tab-button${activeTab === tab.key ? ' is-active' : ''}`}
                type="button"
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            )
          })}
        </nav>

        <div className="filter-chip-row">
          {managementView.filterSnapshot.length === 0 ? (
            <span className="chip chip--ghost">当前为全量视图</span>
          ) : (
            managementView.filterSnapshot.map((entry) => (
              <span className="chip" key={entry.key}>
                {entry.label}: {entry.value}
              </span>
            ))
          )}
        </div>

        {activeTab === 'dashboard' ? (
          <section className="view-stack">
            <div className="kpi-grid">
              {managementView.kpis.map((kpi) => (
                <article className="metric-card reveal" key={kpi.key}>
                  <span className="metric-label">{kpi.label}</span>
                  <strong className={`metric-value tone-${amountTone(kpi.value)}`}>
                    {formatSignedAmount(kpi.value)}
                  </strong>
                  <span className="metric-detail">{kpi.detail}</span>
                </article>
              ))}
            </div>

            <div className="chart-grid">
              <DimensionPieCard
                eyebrow="Account"
                title="利润按账户分布"
                data={managementView.dimensionMixes.account}
                colors={piePalette}
              />
              <DimensionPieCard
                eyebrow="Measurement Model"
                title="利润按计量模型分布"
                data={managementView.dimensionMixes.measurementModel}
                colors={piePalette}
              />
              <DimensionPieCard
                eyebrow="Channel"
                title="利润按渠道分布"
                data={managementView.dimensionMixes.channel}
                colors={piePalette}
              />
              <DimensionPieCard
                eyebrow="Product Group"
                title="利润按产品大类分布"
                data={managementView.dimensionMixes.productGroup}
                colors={piePalette}
              />
              <ChinaBranchMap data={managementView.dimensionMixes.branch} />
            </div>

            <div className="summary-layout">
              <section className="surface-card surface-card--long reveal">
                <div className="card-head">
                  <div>
                    <p className="eyebrow">Long Sheet</p>
                    <h3>IFRS 17 profit statement</h3>
                  </div>
                  <span className="card-note">金额单位: {cube.currency}</span>
                </div>
                <table className="data-table data-table--long">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>公式</th>
                      <th>项目</th>
                      <th>金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managementView.longSheet.rows.map((row) => (
                      <tr key={row.code} className={row.isLeaf ? '' : 'is-group'}>
                        <td>{row.code}</td>
                        <td className="formula-cell">{row.formula || '-'}</td>
                        <td className="item-cell">
                          <span style={{ paddingLeft: `${row.depth * 18}px` }}>{row.label}</span>
                        </td>
                        <td className={`tone-${amountTone(row.amount)}`}>{formatSignedAmount(row.amount)}</td>
                      </tr>
                    ))}
                    <tr className="is-total">
                      <td>PL</td>
                      <td>PL = 1 + 2 + 3 + 4 + 5</td>
                      <td className="item-cell">税后利润</td>
                      <td className={`tone-${amountTone(managementView.longSheet.profitAfterTax)}`}>
                        {formatSignedAmount(managementView.longSheet.profitAfterTax)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <div className="summary-layout-bottom">
                <section className="surface-card reveal summary-main-card">
                  <div className="card-head">
                    <div>
                      <p className="eyebrow">Driver Sheet</p>
                      <h3>报表归属 / Driver 大类 / Driver 小类</h3>
                    </div>
                    <div className="card-actions">
                      <button className="secondary-btn" type="button" onClick={expandAllDrivers}>
                        全部展开
                      </button>
                      <button className="secondary-btn" type="button" onClick={collapseAllDrivers}>
                        全部收起
                      </button>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>报表归属</th>
                          <th>Driver 大类</th>
                          <th>Driver 小类</th>
                          <th>金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managementView.driverGroups.map((group) => {
                          const collapsed = collapsedDriverGroups.has(group.key)

                          return (
                            <Fragment key={group.key}>
                              <tr className="is-group">
                                <td>
                                  {group.sectionLabelZh}
                                  <div className="subtext">{group.sectionLabelEn}</div>
                                </td>
                                <td>
                                  <button
                                    className="row-toggle"
                                    type="button"
                                    onClick={() => toggleDriverGroup(group.key)}
                                  >
                                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                    <span>
                                      {group.majorLabelZh}
                                      <div className="subtext">{group.majorLabelEn}</div>
                                    </span>
                                  </button>
                                </td>
                                <td className="subtext">{collapsed ? `${group.minors.length} 个小类` : '已展开'}</td>
                                <td className={`tone-${amountTone(group.amount)}`}>
                                  {formatSignedAmount(group.amount)}
                                </td>
                              </tr>
                              {!collapsed
                                ? group.minors.map((minor) => (
                                    <tr key={minor.key}>
                                      <td />
                                      <td />
                                      <td>
                                        {minor.labelZh}
                                        <div className="subtext">{minor.labelEn}</div>
                                      </td>
                                      <td className={`tone-${amountTone(minor.amount)}`}>
                                        {formatSignedAmount(minor.amount)}
                                      </td>
                                    </tr>
                                  ))
                                : null}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                <div className="summary-side-stack">
                  <section className="surface-card reveal">
                    <div className="card-head">
                      <div>
                        <p className="eyebrow">Operating Sheet</p>
                        <h3>营运利润 / 非营运利润</h3>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>项目</th>
                            <th>金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managementView.operatingTree.map((row) => (
                            <tr key={row.key} className={row.isTotal ? 'is-group' : ''}>
                              <td>
                                <span style={{ paddingLeft: `${row.depth * 16}px` }}>
                                  {row.labelZh}
                                  <div className="subtext">{row.labelEn}</div>
                                </span>
                              </td>
                              <td className={`tone-${amountTone(row.amount)}`}>{formatSignedAmount(row.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="surface-card reveal">
                    <div className="card-head">
                      <div>
                        <p className="eyebrow">Parameter Sheet</p>
                        <h3>参数类项目单独展示</h3>
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>归属</th>
                            <th>参数项</th>
                            <th>金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managementView.parameterRows.map((row) => (
                            <tr key={row.key}>
                              <td>
                                {row.sectionLabelZh}
                                <div className="subtext">{row.sectionLabelEn}</div>
                              </td>
                              <td>
                                {row.labelZh}
                                <div className="subtext">{row.labelEn}</div>
                              </td>
                              <td className={`tone-${amountTone(row.amount)}`}>{formatSignedAmount(row.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'attribution' ? (
          <section className="view-stack">
            <ProfitAttributionTree
              tree={managementView.attributionTree}
              periodLabel={periodLabel}
              hasPendingChanges={hasPendingChanges}
              onReset={handleReset}
            />
          </section>
        ) : null}

        {activeTab === 'detail' ? (
          <section className="view-stack">
            {rawLoading && !rawSeed ? (
              <section className="surface-card reveal">
                <div className="card-head">
                  <div>
                    <p className="eyebrow">Working layer</p>
                    <h3>正在加载 working detail preview</h3>
                  </div>
                </div>
                <p className="page-description">
                  当前只读取前 1000 行 preview，避免浏览器等待完整 raw fact。
                </p>
              </section>
            ) : null}

            {rawSeed ? (
              <>
                <div className="toolbar-card reveal">
                  <div>
                    <p className="eyebrow">Working layer</p>
                    <h3>Bottom-up records and taxonomy coverage</h3>
                  </div>
                  <label className="search-field">
                    <span>搜索 Item / Driver / GOC</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="例如：CSM、OCI、重疾、HanRe"
                    />
                  </label>
                </div>

                <div className="kpi-grid kpi-grid--compact">
                  <article className="metric-card reveal">
                    <span className="metric-label">Filtered preview rows</span>
                    <strong className="metric-value">{formatAmount(workingRows.length)}</strong>
                  </article>
                  <article className="metric-card reveal">
                    <span className="metric-label">Preview rows</span>
                    <strong className="metric-value">{formatAmount(rawFilteredRecords.length)}</strong>
                  </article>
                  <article className="metric-card reveal">
                    <span className="metric-label">Profiles shown</span>
                    <strong className="metric-value">{formatAmount(detailProfileRows.length)}</strong>
                  </article>
                </div>

                <div className="detail-grid">
                  <section className="surface-card reveal">
                    <div className="card-head">
                      <div>
                        <p className="eyebrow">Profile view</p>
                        <h3>维度组合结果预览</h3>
                      </div>
                      <span className="card-note">按利润绝对值排序，仅显示前 120 个组合</span>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Profile</th>
                            <th>Profit</th>
                            <th>OCI</th>
                            <th>CSMLC</th>
                            <th>Comprehensive income</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailProfileRows.map((profile) => (
                            <tr key={profile.profileId}>
                              <td>
                                <strong>{profile.profileId}</strong>
                                <div className="subtext">{profile.label}</div>
                              </td>
                              <td className={`tone-${amountTone(profile.profit)}`}>{formatSignedAmount(profile.profit)}</td>
                              <td className={`tone-${amountTone(profile.oci)}`}>{formatSignedAmount(profile.oci)}</td>
                              <td className={`tone-${amountTone(profile.csm)}`}>{formatSignedAmount(profile.csm)}</td>
                              <td className={`tone-${amountTone(profile.comprehensiveIncome)}`}>
                                {formatSignedAmount(profile.comprehensiveIncome)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="surface-card reveal">
                    <div className="card-head">
                      <div>
                        <p className="eyebrow">Detailed records</p>
                        <h3>底层 database preview</h3>
                      </div>
                      <span className="card-note">preview 文件最多 1000 行，当前展示前 120 条</span>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Profile</th>
                            <th>Bucket</th>
                            <th>Driver</th>
                            <th>Map</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workingRows.slice(0, 120).map((record) => (
                            <tr key={record.id}>
                              <td>
                                <strong>{record.item}</strong>
                                <div className="subtext">
                                  {record.branch} / {record.channel} / {record.productType}
                                </div>
                              </td>
                              <td>{record.profileId}</td>
                              <td>{record.statementBucket}</td>
                              <td>
                                {record.driverMajor}
                                <div className="subtext">{record.driverMinor}</div>
                              </td>
                              <td>{record.mappingKey}</td>
                              <td className={`tone-${amountTone(record.amount)}`}>
                                {formatSignedAmount(record.amount, 2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <section className="surface-card reveal">
                  <div className="card-head">
                    <div>
                      <p className="eyebrow">Taxonomy coverage</p>
                      <h3>Workbook / supplemental mapping status</h3>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Item</th>
                          <th>Bucket</th>
                          <th>Driver</th>
                          <th>Mapping</th>
                          <th>Profiles</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taxonomyCoverage.slice(0, 160).map((row) => (
                          <tr key={row.id}>
                            <td>{row.source}</td>
                            <td>{row.item}</td>
                            <td>{row.statementBucket}</td>
                            <td>
                              {row.driverMajor}
                              <div className="subtext">{row.driverMinor}</div>
                            </td>
                            <td>{row.mappingKey || '未映射'}</td>
                            <td>{row.profileCount}</td>
                            <td className={`tone-${amountTone(row.total)}`}>{formatSignedAmount(row.total, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            ) : (
              <section className="surface-card reveal">
                <div className="card-head">
                  <div>
                    <p className="eyebrow">Working layer</p>
                    <h3>当前没有可用 preview</h3>
                  </div>
                </div>
                <p className="page-description">
                  你现在导入的是 management cube，本地没有对应的 working detail preview。默认项目预览会自动读取
                  `/data/ifrs17-fact-preview.json`。
                </p>
              </section>
            )}
          </section>
        ) : null}

        {activeTab === 'mapping' ? (
          <section className="view-stack">
            <div className="notes-grid">
              <section className="surface-card reveal">
                <div className="card-head">
                  <div>
                    <p className="eyebrow">Method</p>
                    <h3>编数与映射假设</h3>
                  </div>
                </div>
                <ul className="note-list">
                  {cube.dashboardNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </section>

              <section className="surface-card reveal">
                <div className="card-head">
                  <div>
                    <p className="eyebrow">Dimension Profiles</p>
                    <h3>覆盖 12 个 management filters 的全组合</h3>
                  </div>
                </div>
                <div className="profile-list">
                  {cube.dimensionProfiles.map((profile) => (
                    <article className="profile-pill" key={profile.id}>
                      <strong>{profile.id}</strong>
                      <span>{profile.label}</span>
                      <small>
                        {profile.origOrReins} / {profile.measurementModel} / {profile.goc}
                      </small>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <section className="surface-card reveal">
              <div className="card-head">
                <div>
                  <p className="eyebrow">Long Sheet Leaf Mapping</p>
                  <h3>Leaf line catalogue</h3>
                </div>
              </div>
              <div className="leaf-grid">
                {cube.longSheetLeafMeta.map((leaf) => (
                  <div className="leaf-card" key={leaf.code}>
                    <span>{leaf.code}</span>
                    <strong>{leaf.label}</strong>
                    <small className={`tone-${amountTone(managementView.leafTotals[leaf.code] || 0)}`}>
                      {formatSignedAmount(managementView.leafTotals[leaf.code] || 0)}
                    </small>
                  </div>
                ))}
              </div>
            </section>
          </section>
        ) : null}
      </main>
    </div>
  )
}

export default App
