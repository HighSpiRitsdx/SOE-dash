import { memo, useMemo, useState } from 'react'
import { Expand, Minimize2, ZoomIn } from 'lucide-react'
import type { AttributionNode } from '../lib/management-cube'
import { formatSignedAmount } from '../lib/ifrs17'

type LayoutNode = AttributionNode & {
  x: number
  y: number
}

type LayoutLink = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  cx1: number
  cx2: number
  color: string
  strokeWidth: number
}

function getAllExpandableNodeIds(node: AttributionNode): string[] {
  const current = node.children.length ? [node.id] : []
  return current.concat(...node.children.map((child) => getAllExpandableNodeIds(child)))
}

function toggleNodeSet(current: Set<string>, id: string) {
  const next = new Set(current)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

function layoutAttributionTree(tree: AttributionNode, expandedIds: Set<string>) {
  const levelGap = 258
  const verticalGap = 92
  const rootX = 112
  const nodes: LayoutNode[] = []
  const links: LayoutLink[] = []

  function leafCount(node: AttributionNode): number {
    if (!node.children.length || !expandedIds.has(node.id)) return 1
    return node.children.reduce((sum, child) => sum + leafCount(child), 0)
  }

  function walk(node: AttributionNode, depth: number, top: number) {
    const leaves = leafCount(node)
    const centerY = top + ((leaves - 1) * verticalGap) / 2 + 70
    const x = rootX + depth * levelGap
    nodes.push({ ...node, x, y: centerY })

    if (node.children.length && expandedIds.has(node.id)) {
      let cursor = top

      node.children.forEach((child) => {
        const childLeaves = leafCount(child)
        const childLayout = walk(child, depth + 1, cursor)

        links.push({
          id: `${node.id}-${child.id}`,
          x1: x + 10,
          y1: centerY,
          x2: childLayout.x - 10,
          y2: childLayout.y,
          cx1: x + 88,
          cx2: childLayout.x - 88,
          color: child.value >= 0 ? '#9FB6FF' : '#FFBC74',
          strokeWidth: 5,
        })

        cursor += childLeaves * verticalGap
      })
    }

    return { x, y: centerY, leaves }
  }

  const totalLeaves = leafCount(tree)
  const height = Math.max(260, totalLeaves * verticalGap + 90)
  const top = totalLeaves === 1 ? Math.max(30, height / 2 - 70) : 14
  walk(tree, 0, top)

  return {
    nodes,
    links,
    width: 130 + Math.max(...nodes.map((node) => node.x), rootX) + 360,
    height,
  }
}

type ProfitAttributionTreeProps = {
  tree: AttributionNode
  periodLabel: string
  hasPendingChanges: boolean
  onReset: () => void
}

export const ProfitAttributionTree = memo(function ProfitAttributionTree({
  tree,
  periodLabel,
  hasPendingChanges,
  onReset,
}: ProfitAttributionTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set([tree.id, ...tree.children.map((child) => child.id)]),
  )
  const [isFullscreen, setIsFullscreen] = useState(false)

  const layout = useMemo(() => layoutAttributionTree(tree, expandedIds), [tree, expandedIds])

  const svgCanvas = useMemo(
    () => (
      <>
        {layout.links.map((link) => (
          <path
            key={link.id}
            d={`M ${link.x1} ${link.y1} C ${link.cx1} ${link.y1}, ${link.cx2} ${link.y2}, ${link.x2} ${link.y2}`}
            stroke={link.color}
            strokeWidth={link.strokeWidth}
            fill="none"
            strokeLinecap="round"
            opacity="0.8"
          />
        ))}

        {layout.nodes.map((node) => {
          const expandable = node.children.length > 0
          const expanded = expandedIds.has(node.id)

          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`} className="tree-node-group">
              <circle
                r={expandable ? 10 : 8}
                fill="#ffffff"
                stroke={node.color}
                strokeWidth="3"
                className={expandable ? 'tree-node clickable' : 'tree-node'}
                onClick={() => {
                  if (!expandable) return
                  setExpandedIds((current) => toggleNodeSet(current, node.id))
                }}
              />

              {expandable ? (
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="tree-node-toggle"
                  onClick={() => setExpandedIds((current) => toggleNodeSet(current, node.id))}
                >
                  {expanded ? '−' : '+'}
                </text>
              ) : null}

              <text x={14} y={-8} className="tree-node-label">
                {node.label}
              </text>
              <text x={14} y={10} className="tree-node-value">
                {formatSignedAmount(node.value)}
              </text>
            </g>
          )
        })}
      </>
    ),
    [expandedIds, layout.links, layout.nodes],
  )

  const renderSvg = (fullscreen = false) => (
    <svg
      width="100%"
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className={`attribution-svg${fullscreen ? ' is-fullscreen' : ''}`}
      role="img"
      aria-label="利源归因图"
    >
      {svgCanvas}
    </svg>
  )

  return (
    <section className="surface-card reveal attribution-card">
      <div className="card-head attribution-head">
        <div>
          <p className="eyebrow">Driver Tree</p>
          <h3>利源归因</h3>
          <p className="card-note">本页共享左侧 management filters，仅展示已应用筛选结果。</p>
        </div>

        <div className="attribution-toolbar">
          <span className="toolbar-pill">{periodLabel}</span>
          {hasPendingChanges ? <span className="toolbar-pill toolbar-pill--pending">有未应用筛选</span> : null}
          <button type="button" onClick={() => setExpandedIds(new Set(getAllExpandableNodeIds(tree)))}>
            <Expand size={14} />
            一键展开
          </button>
          <button type="button" className="secondary-btn" onClick={() => setExpandedIds(new Set([tree.id]))}>
            <Minimize2 size={14} />
            收起明细
          </button>
          <button type="button" className="secondary-btn" onClick={onReset}>
            重置筛选
          </button>
        </div>
      </div>

      <div className="attribution-shell-wrap">
        <button
          type="button"
          className="attribution-expand-btn"
          aria-label={isFullscreen ? '缩小利源归因图' : '放大利源归因图'}
          onClick={() => setIsFullscreen((current) => !current)}
        >
          <ZoomIn size={16} />
        </button>
        <div className={`attribution-shell ${expandedIds.size > 3 ? 'is-expanded' : 'is-collapsed'}`.trim()}>
          {renderSvg(false)}
        </div>
      </div>

      {isFullscreen ? (
        <div className="attribution-modal-backdrop" onClick={() => setIsFullscreen(false)}>
          <div className="attribution-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="attribution-expand-btn attribution-expand-btn--modal"
              aria-label="缩小利源归因图"
              onClick={() => setIsFullscreen(false)}
            >
              <Minimize2 size={16} />
            </button>
            <div className="attribution-modal-canvas">{renderSvg(true)}</div>
          </div>
        </div>
      ) : null}
    </section>
  )
})
