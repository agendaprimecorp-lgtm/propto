/** Símbolo da marca — telhado sobre três barras de voz (brand/MARCA.md). */
export function Symbol({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Propto">
      <path
        d="M9 31.5 32 11l23 20.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="18.5" y="40" width="6.5" height="13" rx="3.25" fill="currentColor" />
      <rect x="28.75" y="33.5" width="6.5" height="19.5" rx="3.25" fill="currentColor" />
      <rect x="39" y="37" width="6.5" height="16" rx="3.25" fill="currentColor" />
    </svg>
  );
}

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <a className="logo" href={href}>
      <Symbol />
      <span className="wm">
        Pr<i>o</i>pto
      </span>
    </a>
  );
}
