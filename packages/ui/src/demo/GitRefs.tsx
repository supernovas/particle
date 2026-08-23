/** The git mechanism, visually: per-actor append-only refs folding into a view. */
export function GitRefs() {
  const rows = [
    { y: 96, label: 'refs/particle/prj_01J8…/actors/github-kate', commits: 6 },
    { y: 206, label: 'refs/particle/prj_01J8…/actors/agent-planner-run_4', commits: 4 },
    { y: 316, label: 'refs/particle/prj_01J8…/actors/agent-impl-run_7', commits: 5 },
  ];
  const x0 = 42;
  const step = 54;

  return (
    <svg
      className="gitrefs"
      viewBox="0 0 980 400"
      role="img"
      aria-label="Per-actor git refs fold into one view"
    >
      <defs>
        <marker
          id="arr"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="var(--text-3)" />
        </marker>
      </defs>

      {rows.map((row) => {
        const tipX = x0 + (row.commits - 1) * step;
        return (
          <g key={row.y}>
            <text x={x0 - 2} y={row.y - 30} className="gr-label">
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
            {Array.from({ length: row.commits }, (_, i) => (
              <circle
                key={i}
                cx={x0 + i * step}
                cy={row.y}
                r={i === row.commits - 1 ? 9 : 6.5}
                fill={i === row.commits - 1 ? 'var(--accent)' : 'var(--border-strong)'}
              />
            ))}
            <line
              x1={tipX + 14}
              y1={row.y}
              x2={636}
              y2={206 + (row.y - 206) * 0.22}
              stroke="var(--text-3)"
              strokeWidth="1.75"
              markerEnd="url(#arr)"
              opacity="0.9"
            />
          </g>
        );
      })}

      <rect
        x="648"
        y="164"
        width="132"
        height="84"
        rx="14"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
      <text x="714" y="201" textAnchor="middle" className="gr-fold">
        fold
      </text>
      <text x="714" y="226" textAnchor="middle" className="gr-label">
        deterministic
      </text>

      <line
        x1="780"
        y1="206"
        x2="852"
        y2="206"
        stroke="var(--text-3)"
        strokeWidth="1.75"
        markerEnd="url(#arr)"
      />
      <circle cx="878" cy="206" r="10" fill="var(--st-converged)" />
      <text x="878" y="246" textAnchor="middle" className="gr-label">
        …/view
      </text>
      <text x="878" y="270" textAnchor="middle" className="gr-note">
        byte-identical
      </text>
      <text x="878" y="290" textAnchor="middle" className="gr-note">
        on every replica
      </text>
    </svg>
  );
}
