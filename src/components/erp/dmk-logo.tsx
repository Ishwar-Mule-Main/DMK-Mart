"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART — OFFICIAL LOGO COMPONENT
// Brand mark: yellow disc + black tree of prosperity + "DMK"
// Used across login gate, header, sidebar, boot screen, footer
// and the A4 invoice print header.
// ═══════════════════════════════════════════════════════════════

interface DmkLogoProps {
  /** Tailwind size classes, e.g. "h-10 w-10" */
  className?: string;
  /** Wrap in a rounded ring for dark surfaces (default true) */
  ring?: boolean;
}

export function DmkLogo({ className = "h-10 w-10", ring = true }: DmkLogoProps) {
  return (
    <span
      className={
        ring
          ? `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/95 shadow-[0_0_0_1px_rgba(255,214,10,0.35),0_2px_8px_rgba(2,6,17,0.55)] ${className}`
          : `inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`
      }
    >
      <img
        src="/dmk-logo.png"
        alt="DMK Mart logo"
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}

/** Compact wordmark pairing the logo disc with the brand name. */
export function DmkBrand({
  logoClass = "h-9 w-9",
  compact = false,
}: {
  logoClass?: string;
  compact?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <DmkLogo className={logoClass} />
      {!compact && (
        <span className="leading-tight min-w-0">
          <p className="text-[15px] font-bold text-dmk-text-primary truncate">DMK Mart</p>
          <p className="text-[11px] uppercase tracking-widest text-dmk-gold font-semibold">
            ERP Platform
          </p>
        </span>
      )}
    </span>
  );
}
