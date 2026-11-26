/**
 * JiMail mark: a petrol tile whose saffron chevron is an envelope flap folding into the hook of a "J".
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="JiMail">
      <rect width="64" height="64" rx="16" fill="#0F5257" />
      <path d="M14 22 L32 35 L50 22" fill="none" stroke="#F0A23A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M41 28 V40 a9 9 0 0 1 -18 0" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 28, className, inverted }: { size?: number; className?: string; inverted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark size={size} />
      <span className={`font-display text-[19px] font-bold tracking-tight ${inverted ? 'text-white' : 'text-ink'}`}>JiMail</span>
    </span>
  );
}
