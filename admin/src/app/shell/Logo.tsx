import { BRAND, markSvg } from "@restoflux/contracts";

/** Logo mark + wordmark, from the shared brand definition. */
export function Logo({ size = 32, wordmark = true, className = "" }: { size?: number; wordmark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* trusted static markup from the shared brand module (no user input) */}
      <span className="inline-flex shrink-0" aria-hidden={wordmark} dangerouslySetInnerHTML={{ __html: markSvg(size) }} />
      {wordmark && (
        <span className="text-lg font-extrabold tracking-tight">
          {BRAND.lead}
          <span className="text-primary">{BRAND.accent}</span>
        </span>
      )}
    </span>
  );
}
