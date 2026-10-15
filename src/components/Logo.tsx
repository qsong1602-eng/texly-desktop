export default function Logo({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="TeXly">
    <svg viewBox="0 0 46 46" aria-hidden="true">
      <path d="M8.5 9.5h29v27h-29z" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M16 16.5h14M23 16.5v15M16 31.5h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
      <path d="m33.5 6.5 6 6" stroke="#e2b96c" strokeWidth="3" strokeLinecap="square" />
    </svg>
    {!compact && <div><strong>TeXly</strong><span>LOCAL TYPESETTER</span></div>}
  </div>
}
