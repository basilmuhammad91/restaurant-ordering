import { ImageOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

/** Small photos look soft on a till card, so they get a gentle warning. */
const SMALL_WIDTH = 400;

/**
 * Shows the picture behind an "image link" box as soon as one is typed or pasted, and says so plainly when the
 * link does not give a picture. A photo is cropped like the POS card (so you see what staff will see); a logo is
 * shown whole. Waits a moment after typing so half-typed links are not requested.
 */
export function ImagePreview({ url, fit = "photo" }: { url: string | null | undefined; fit?: "photo" | "logo" }) {
  const value = (url ?? "").trim();
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 400);
    return () => clearTimeout(timer);
  }, [value]);

  if (!value) return null;
  if (!/^https?:\/\/\S+$/i.test(value)) return <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Paste a full link that starts with https:// to see a preview.</p>;
  if (settled !== value) return <Frame fit={fit}><Loader2 className="size-5 animate-spin" aria-label="Loading preview" /></Frame>;
  // the key starts a fresh load, with fresh state, whenever the link changes
  return <Loaded key={settled} url={settled} fit={fit} />;
}

function Frame({ fit, children }: { fit: "photo" | "logo"; children: React.ReactNode }) {
  return <div className={`relative mt-2 grid w-full place-items-center overflow-hidden rounded-lg border bg-muted text-muted-foreground ${fit === "logo" ? "h-28 max-w-52" : "aspect-[16/10] max-w-64"}`}>{children}</div>;
}

function Loaded({ url, fit }: { url: string; fit: "photo" | "logo" }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  if (state === "error") {
    return (
      <div role="alert" className="mt-2 flex max-w-64 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
        <ImageOff className="mt-0.5 size-4 shrink-0" />
        <span>This link did not load a picture. Use a link that opens the image itself (often ending in .jpg, .png or .webp), not a web page.</span>
      </div>
    );
  }
  return (
    <>
      <Frame fit={fit}>
        {state === "loading" && <Loader2 className="size-5 animate-spin" aria-label="Loading preview" />}
        <img
          src={url}
          alt="Preview of the picture at this link"
          className={`absolute inset-0 size-full ${fit === "logo" ? "object-contain p-2" : "object-cover"} ${state === "ok" ? "" : "opacity-0"}`}
          onLoad={(e) => { setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setState("ok"); }}
          onError={() => setState("error")}
        />
      </Frame>
      {state === "ok" && size && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {fit === "photo" ? "Preview, cropped as on the till" : "Preview"} · {size.w} × {size.h} px
          {fit === "photo" && size.w < SMALL_WIDTH && <span className="block text-amber-700 dark:text-amber-400">This picture is small and may look blurry. Use one at least {SMALL_WIDTH} px wide.</span>}
        </p>
      )}
    </>
  );
}
