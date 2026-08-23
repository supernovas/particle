/**
 * The git mechanism, visually: per-actor append-only refs folding into one
 * deterministic view. Animates on slide entry (CSS keys off .deck-slide.active).
 */
export function GitRefs() {
  const rows = [
    {
      y: 96,
      label: 'refs/particle/prj_01J8…/actors/github-kate',
      commits: 6,
      color: 'var(--accent)',
    },
    {
      y: 206,
      label: 'refs/particle/prj_01J8…/actors/agent-planner-run_4',
      commits: 4,
      color: 'var(--st-executing)',
    },
    {
      y: 316,
      label: 'refs/particle/prj_01J8…/actors/agent-impl-run_7',
      commits: 5,
      color: 'var(--st-converged)',
    },
  ];
  const x0 = 44;
  const step = 58;
  const boxX = 660;
  const entryY = [184, 206, 228];

  return (
    <svg
      className="gitrefs"
      viewBox="0 0 980 400"
      role="img"
      aria-label="Per-actor git refs fold into one deterministic view"
    >
      <defs>
        <marker
          id="arr"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="var(--text-3)" />
        </marker>
      </defs>

      {rows.map((row, r) => {
        const tipX = x0 + (row.commits - 1) * step;
        return (
          <g key={row.y}>
            <text x={x0 - 2} y={row.y - 32} className="gr-label">
              {row.label}
            </text>
            <line
              x1={x0}
              y1={row.y}
              x2={tipX}
              y2={row.y}
              stroke="var(--border-strong)"
              strokeWidth="2.5"
            />
            {Array.from({ length: row.commits }, (_, i) => {
              const tip = i === row.commits - 1;
              return (
                <circle
                  key={i}
                  className="gr-dot"
                  style={{ animationDelay: `${r * 0.25 + i * 0.09}s` }}
                  cx={x0 + i * step}
                  cy={row.y}
                  r={tip ? 10 : 7}
                  fill={tip ? row.color : 'var(--border-strong)'}
                  stroke={tip ? 'var(--panel)' : 'none'}
                  strokeWidth={tip ? 2 : 0}
                />
              );
            })}
            <path
              className="gr-link"
              d={`M ${tipX + 16} ${row.y} C ${tipX + 150} ${row.y}, ${boxX - 130} ${entryY[r]}, ${boxX - 8} ${entryY[r]}`}
              fill="none"
              stroke="var(--text-3)"
              strokeWidth="1.75"
              markerEnd="url(#arr)"
            />
          </g>
        );
      })}

      <g className="gr-fold-box">
        <rect
          x={boxX}
          y="160"
          width="140"
          height="92"
          rx="18"
          fill="color-mix(in srgb, var(--accent) 9%, transparent)"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        <text x={boxX + 70} y="201" textAnchor="middle" className="gr-fold">
          fold
        </text>
        <text x={boxX + 70} y="228" textAnchor="middle" className="gr-label">
          deterministic
        </text>
      </g>

      <line
        className="gr-link gr-link-out"
        x1={boxX + 148}
        y1="206"
        x2="854"
        y2="206"
        stroke="var(--text-3)"
        strokeWidth="1.75"
        markerEnd="url(#arr)"
      />
      <g className="gr-view">
        <circle
          cx="884"
          cy="206"
          r="11"
          fill="var(--st-converged)"
          stroke="var(--panel)"
          strokeWidth="2"
        />
        <text x="884" y="248" textAnchor="middle" className="gr-label">
          …/view
        </text>
        <text x="884" y="272" textAnchor="middle" className="gr-note">
          byte-identical
        </text>
        <text x="884" y="292" textAnchor="middle" className="gr-note">
          on every replica
        </text>
      </g>
    </svg>
  );
}
