// src/lib/urls.ts
/** Base URL for the site. On GitHub Pages project sites this is "/REPO/". */
export function baseUrl(): string {
    // Astro/Vite provides this both in server build-time and client runtime.
    return (import.meta as any).env?.BASE_URL ?? "/";
}

/** Join BASE_URL with a relative path (no leading slash required). */
export function url(path: string, base: string = baseUrl()): string {
    return base + String(path ?? "").replace(/^\/+/, "");
}

/**
 * Convert a game DB asset path like:
 *   UI/Portraits/Items/...png
 * into a site URL pointing to:
 *   <BASE_URL>/icons/UI/Portraits/Items/...png
 *
 * Your filesystem should contain:
 *   public/icons/UI/Portraits/Items/...png
 */
export function icon(gamePath: string | null | undefined, base: string = baseUrl()): string | null {
    if (!gamePath) return null;
    let p = String(gamePath).replaceAll("\\", "/").replace(/^\/+/, "");

    // Prevent double-prefixing if some values already start with "icons/"
    if (p.startsWith("icons/")) return url(p, base);

    return url(`icons/${p}`, base);
}