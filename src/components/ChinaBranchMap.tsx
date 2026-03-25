import { useEffect, useMemo, useState } from 'react'
import { geoMercator, geoPath, type GeoProjection } from 'd3-geo'
import { formatSignedAmount } from '../lib/ifrs17'

type BranchRow = {
  key: string
  label: string
  value: number
  share: number
}

type ChinaBranchMapProps = {
  data: BranchRow[]
}

type ChinaFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  {
    name?: string
    center?: [number, number]
    centroid?: [number, number]
  }
>

const branchProvinceMap: Record<string, string> = {
  '\u4e0a\u6d77\u5206': '\u4e0a\u6d77\u5e02',
  '\u6c5f\u82cf\u5206': '\u6c5f\u82cf\u7701',
  '\u5317\u4eac\u5206': '\u5317\u4eac\u5e02',
  '\u5929\u6d25\u5206': '\u5929\u6d25\u5e02',
  '\u91cd\u5e86\u5206': '\u91cd\u5e86\u5e02',
}

function resolveProvinceName(branchLabel: string) {
  if (branchProvinceMap[branchLabel]) return branchProvinceMap[branchLabel]
  if (branchLabel.endsWith('\u5206')) return `${branchLabel.slice(0, -1)}\u7701`
  return branchLabel
}

function provinceFill(isActive: boolean) {
  return isActive ? 'rgba(0, 94, 184, 0.22)' : 'rgba(0, 94, 184, 0.07)'
}

export function ChinaBranchMap({ data }: ChinaBranchMapProps) {
  const [mapData, setMapData] = useState<ChinaFeatureCollection | null>(null)

  useEffect(() => {
    let active = true

    fetch('/maps/china-provinces.json')
      .then((response) => response.json() as Promise<ChinaFeatureCollection>)
      .then((payload) => {
        if (!active) return
        setMapData(payload)
      })
      .catch(() => {
        if (!active) return
        setMapData(null)
      })

    return () => {
      active = false
    }
  }, [])

  const maxValue = Math.max(...data.map((row) => Math.abs(row.value)), 1)
  const highlightedProvinces = useMemo(
    () =>
      new Map(
        data.map((row) => [
          resolveProvinceName(row.label),
          {
            ...row,
            province: resolveProvinceName(row.label),
          },
        ]),
      ),
    [data],
  )

  const projectedMap = useMemo(() => {
    if (!mapData) return null

    const width = 760
    const height = 500
    const projection: GeoProjection = geoMercator().fitSize([width, height], mapData)
    const pathBuilder = geoPath(projection)

    const provinces = mapData.features.map((feature) => {
      const properties = feature.properties || {}
      const provinceName = properties.name || ''
      const highlight = highlightedProvinces.get(provinceName)
      const centroid = properties.centroid || properties.center || pathBuilder.centroid(feature)

      return {
        id: provinceName,
        provinceName,
        path: pathBuilder(feature) || '',
        centroid,
        highlight,
      }
    })

    return { width, height, provinces }
  }, [highlightedProvinces, mapData])

  return (
    <section className="surface-card reveal china-map-section">
      <div className="card-head">
        <div>
          <p className="eyebrow">Branch</p>
          <h3>{'\u5229\u6da6\u6309\u673a\u6784\u5206\u5e03'}</h3>
        </div>
      </div>

      <div className="china-map-card">
        {projectedMap ? (
          <svg
            viewBox={`0 0 ${projectedMap.width} ${projectedMap.height}`}
            className="china-map-svg"
            role="img"
            aria-label={('\u4e2d\u56fd\u673a\u6784\u5229\u6da6\u5730\u56fe')}
          >
            {projectedMap.provinces.map((province) => (
              <path
                key={province.id}
                d={province.path}
                className="china-province-shape"
                style={{ fill: provinceFill(Boolean(province.highlight)) }}
              />
            ))}

            {projectedMap.provinces
              .filter((province) => province.highlight)
              .map((province) => {
                const [x, y] = province.centroid || [0, 0]
                const radius = 10 + (Math.abs(province.highlight?.value || 0) / maxValue) * 14

                return (
                  <g key={`${province.id}-bubble`} transform={`translate(${x}, ${y})`}>
                    <circle r={radius} className="china-branch-bubble" />
                    <text x={radius + 10} y={-5} className="china-branch-label">
                      {province.highlight?.label}
                    </text>
                    <text x={radius + 10} y={14} className="china-branch-value">
                      {formatSignedAmount(province.highlight?.value || 0)} /{' '}
                      {(province.highlight?.share || 0).toFixed(1)}%
                    </text>
                  </g>
                )
              })}
          </svg>
        ) : (
          <div className="china-map-loading">{'\u6b63\u5728\u52a0\u8f7d\u4e2d\u56fd\u5730\u56fe\u2026'}</div>
        )}

        <div className="dimension-legend">
          {data.map((row) => (
            <div className="dimension-legend-row" key={row.key}>
              <span className="dimension-dot dimension-dot--map" />
              <span className="dimension-label">{row.label}</span>
              <span className="dimension-value">
                {formatSignedAmount(row.value)} / {row.share.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
