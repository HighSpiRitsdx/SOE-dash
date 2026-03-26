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

const markerPositions: Record<string, { x: number; y: number; dx: number; dy: number }> = {
  江苏分: { x: 66.58, y: 47.61, dx: 18, dy: -72 },
  上海分: { x: 68.71, y: 51.36, dx: 22, dy: -18 },
}

export function ChinaBranchMap({ data }: ChinaBranchMapProps) {
  return (
    <section className="surface-card reveal china-map-section">
      <div className="card-head">
        <div>
          <p className="eyebrow">Branch</p>
          <h3>利润按机构分布</h3>
        </div>
      </div>

      <div className="china-map-business-card">
        <div className="china-map-image-stage">
          <img
            src="/images/china-business-map.svg"
            alt="中国机构利润地图"
            className="china-map-image"
          />

          {data.map((row) => {
            const marker = markerPositions[row.label]
            if (!marker) return null

            return (
              <div
                key={row.key}
                className="china-image-marker"
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
              >
                <span className="china-image-marker-ring" />
                <span className="china-image-marker-core" />
                <svg
                  className="china-image-marker-link"
                  style={{ left: 0, top: marker.dy }}
                  width={Math.max(marker.dx + 8, 12)}
                  height={Math.abs(marker.dy) + 28}
                  viewBox={`0 0 ${Math.max(marker.dx + 8, 12)} ${Math.abs(marker.dy) + 28}`}
                >
                  <path
                    d={`M 6 ${Math.abs(marker.dy) + 24} C 10 ${Math.abs(marker.dy) + 10}, ${marker.dx - 8} 18, ${marker.dx} 10`}
                    className="china-image-link-path"
                  />
                </svg>
                <div
                  className="china-image-callout"
                  style={{ left: marker.dx, top: marker.dy - 10 }}
                >
                  <strong>{row.label}</strong>
                  <span>{formatSignedAmount(row.value)}</span>
                  <small>{row.share.toFixed(1)}%</small>
                </div>
              </div>
            )
          })}
        </div>

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
