interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
}

export function IconX({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconSun({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" />
    </svg>
  );
}

export function IconMoon({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M13.5 9.8A5.7 5.7 0 0 1 6.2 2.5a5.7 5.7 0 1 0 7.3 7.3Z" />
    </svg>
  );
}

export function IconCopy({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" />
    </svg>
  );
}

export function IconCheck({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M2.5 8.5l3.5 3.5 7-8" />
    </svg>
  );
}

export function IconPause({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M5.5 3v10M10.5 3v10" />
    </svg>
  );
}

export function IconPlay({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M5 3l8 5-8 5V3Z" />
    </svg>
  );
}

export function IconSend({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  );
}

export function IconBranch({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="4.5" cy="3.5" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.8" />
      <circle cx="11.5" cy="5.5" r="1.8" />
      <path d="M4.5 5.3v5.4M11.5 7.3c0 2.5-3 3-5 3.2" />
    </svg>
  );
}

export function IconIssueDot({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPR({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="4.2" cy="4" r="1.9" />
      <circle cx="4.2" cy="12" r="1.9" />
      <circle cx="11.8" cy="12" r="1.9" />
      <path d="M4.2 5.9v4.2M8.4 3.5h1.9a1.5 1.5 0 0 1 1.5 1.5v5.1M8.9 1.8l-1.7 1.7 1.7 1.7" />
    </svg>
  );
}

export function IconMerge({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="4.2" cy="3.6" r="1.9" />
      <circle cx="4.2" cy="12.4" r="1.9" />
      <circle cx="12" cy="8" r="1.9" />
      <path d="M4.2 5.5v5M4.4 6.5c1 2 3 3.4 5.6 3.5" />
    </svg>
  );
}

export function IconComment({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M2.5 3.8A1.3 1.3 0 0 1 3.8 2.5h8.4a1.3 1.3 0 0 1 1.3 1.3v6a1.3 1.3 0 0 1-1.3 1.3H8l-3.2 2.6v-2.6H3.8a1.3 1.3 0 0 1-1.3-1.3v-6Z" />
    </svg>
  );
}

/** The particle mark: three dots, one bright. */
export function Logo({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="9.5" r="5.2" fill="var(--accent)" />
      <circle cx="9.8" cy="21.5" r="5.2" fill="var(--accent)" opacity="0.55" />
      <circle cx="22.2" cy="21.5" r="5.2" fill="var(--accent)" opacity="0.3" />
    </svg>
  );
}
