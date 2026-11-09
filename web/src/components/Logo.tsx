import { BRAND, markSvg } from "../brand";

// Mark + wordmark. `onDark` picks the text colours for dark bars (header, footer, admin bar).
export function Logo({ onDark = false, size = 32, wordmark = true, className = "" }: { onDark?: boolean; size?: number; wordmark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* Static, trusted markup from brand.ts (no user input) */}
      <span className="inline-flex shrink-0" aria-hidden={wordmark} dangerouslySetInnerHTML={{ __html: markSvg(size) }} />
      {wordmark && (
        <span className={`text-xl font-extrabold tracking-tight ${onDark ? "text-white" : "text-ink"}`}>
          {BRAND.lead}
          <span className={onDark ? "text-red-400" : "text-brand"}>{BRAND.accent}</span>
        </span>
      )}
    </span>
  );
}
