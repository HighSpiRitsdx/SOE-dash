import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatSignedAmount } from '../lib/ifrs17'

type MixRow = {
  key: string
  label: string
  value: number
  share: number
}

type DimensionPieCardProps = {
  eyebrow: string
  title: string
  data: MixRow[]
  colors: string[]
}

export function DimensionPieCard({ eyebrow, title, data, colors }: DimensionPieCardProps) {
  const chartData = data.map((row) => ({
    ...row,
    chartValue: Math.abs(row.value),
  }))

  return (
    <section className="surface-card reveal">
      <div className="card-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="dimension-pie-card">
        <div className="chart-wrap chart-wrap--pie">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="chartValue"
                nameKey="label"
                innerRadius={52}
                outerRadius={88}
                paddingAngle={2}
              >
                {chartData.map((entry, index) => (
                  <Cell key={entry.key} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value, _name, payload) => formatSignedAmount(Number(payload?.payload?.value ?? value ?? 0))} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="dimension-legend">
          {data.map((row, index) => (
            <div className="dimension-legend-row" key={row.key}>
              <span className="dimension-dot" style={{ backgroundColor: colors[index % colors.length] }} />
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
