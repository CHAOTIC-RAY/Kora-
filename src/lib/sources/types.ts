/**
 * Kora Source Plugins — type contract, modelled on Tachiyomi **Gen 2**
 * (keiyoushi/extensions-source + keiyoushi/extensions registry).
 *
 * A plugin is *data*, not code: a JSON document describing how to reach a
 * website and pull titles, chapters and page images out of it. The shape
 * deliberately mirrors the Tachiyomi source contract (Source / CatalogueSource
 * / HttpSource) because that API is a functional interface — the shape is not
 * copyrightable, and keeping it means sources stay mechanical to write and easy
 * to recognise for anyone who knows Tachiyomi.
 *
 * Gen 2 is the base, not Gen 1 (timschneeb/tachiyomi-extensions). Gen 1 has had
 * zero commits since Sept 2023; Gen 2 is the live channel with ~2,336 sources.
 * Concretely that means our ids/names line up with the Keiyoushi registry, and
 * `versionCode` follows its positional string format (see parseVersionCode).
 *
 * Kora fetches from the origin site and relays bytes. It never hosts or
 * re-publishes content. See docs/PLUGIN-CREATION.md.
 */

/** A source as listed in a Gen-2 registry index.json `sources[]` entry. */
export interface RegistrySource {
  id: string; // Gen 2 serialises the Long id as a *string*
  name: string;
  language: string; // note: `language`, not `lang`
  homeUrl?: string;
}

export interface RegistryExtension {
  name: string;
  packageName: string;
  resources: {
    apkUrl: string;
    /** Present on all Gen 2 entries — a plain JVM class bundle, no dex. */
    jarUrl?: string;
    iconUrl: string;
  };
  extensionLib: string; // e.g. "1.6"
  /** Positional string: libVersion "1.6" -> 1_06, plus extVersionCode "004". */
  versionCode: string;
  versionName: string;
  contentWarning?: string; // e.g. "CONTENT_WARNING_NSFW"
  sources: RegistrySource[];
}

export interface RegistryIndex {
  name: string;
  badgeLabel?: string;
  /** SHA-256 of the signing cert. Keiyoushi publishes one; we treat any
   *  user-added repo as self-trusted per explicit product decision. */
  signingKey?: string;
  contact?: { website?: string; discord?: string };
  extensionList: { extensions: RegistryExtension[] };
}

/**
 * Split a Gen 2 `versionCode` into its parts, positionally.
 *
 * `"106004"` with `extensionLib: "1.6"` means libVersion 1.6 (-> 1_06) and
 * extVersionCode 4 (-> 004). Casting to int loses that split, so we parse it
 * from the end: the trailing group is the extension's own code.
 */
export function parseVersionCode(
  versionCode: string,
  extensionLib: string
): { libVersion: string; extVersionCode: number } {
  const libDigits = extensionLib.replace(/\./g, ""); // "1.6" -> "16"
  // Strip the leading lib portion if present, then read the remainder.
  const trimmed = versionCode.startsWith(libDigits)
    ? versionCode.slice(libDigits.length)
    : versionCode;
  const tail = trimmed.replace(/^0+/, "");
  return { libVersion: extensionLib, extVersionCode: tail ? parseInt(tail, 10) : 0 };
}

/** Map Gen 2's `contentWarning` onto our own flags. */
export function isNsfwExtension(ext: RegistryExtension): boolean {
  return (ext.contentWarning || "").includes("NSFW");
}


/** How a field value is read out of a matched element. */
export type FieldSelector =
  | string // shorthand, same grammar as `selector`
  | {
      selector: string;
      /** Read `textContent` instead of `attr`. */
      text?: boolean;
      /** Read this attribute instead of text. */
      attr?: string;
      /** Attribute whose value is itself a url to resolve against the page. */
      resolve?: boolean;
      /** Literal value, ignoring the DOM entirely. */
      literal?: string;
      /** Regex capture group index applied to the extracted string. */
      capture?: number;
      /** Split text on this separator, e.g. genres. */
      split?: string;
    };

/** One listing page: a container element plus how to read a card from it. */
export interface ListingRule {
  /** Container selector for each result card. */
  selector: string;
  title: FieldSelector;
  url: FieldSelector;
  thumb?: FieldSelector;
  author?: FieldSelector;
  /** Presence of this selector anywhere in the document => another page exists. */
  nextPage?: string;
}

export interface FilterDef {
  type: "select" | "text" | "sort";
  key: string;
  name: string;
  values?: string[];
  default?: string;
}

export interface StatusRule {
  selector: string;
  /** Raw text -> SManga status code (1 ongoing, 2 completed, 3 licensed, 4 publishing, 5 hiatus, 6 cancelled). */
  map?: Record<string, number>;
}

export interface SourceEndpoints {
  /**
   * JSON-API variant, used when the source sets `api: "json"`.
   *
   * `path` is a dot/bracket path into the decoded response — e.g. `data`,
   * `data.0`, `data.attributes.title`, `data[].relationships`. HTML selectors
   * are not involved, which is the only reliable way to consume sources like
   * MangaDex and OpenLibrary.
   */
  json?: {
    popular?: JsonListing;
    latest?: JsonListing;
    search?: JsonListing;
    details?: JsonRule;
    chapters?: JsonListing;
    /** Image page list. `{pageId}` is the chapter id, `{mangaId}` the series id. */
    pages?: JsonRule;
  };

  popular?: { url: string; nextPage?: string; mangas: ListingRule };
  latest?: { url: string; nextPage?: string; mangas: ListingRule };
  search?: { url: string; nextPage?: string; mangas: ListingRule };
  details?: {
    url: string;
    title?: FieldSelector;
    author?: FieldSelector;
    artist?: FieldSelector;
    description?: FieldSelector;
    thumbnail?: FieldSelector;
    status?: StatusRule;
    genres?: FieldSelector;
  };
  chapters?: {
    url: string;
    selector: string;
    name: FieldSelector;
    url_: FieldSelector;
    /** Post-processing on the parsed list, e.g. `reverse`, `distinct`. */
    transform?: "reverse" | "distinct" | "reverse,distinct" | "distinct,reverse";
  };
  pages?: {
    /** Chapter page to fetch. Supports `{chapterUrl}` / `{mangaUrl}`. */
    url: string;
    selector: string;
    /** How to get the image url out of each match. Usually `img@src`. */
    image: FieldSelector;
    /** Literal prefix applied to the raw value, e.g. `"https:"` for `//cdn/...`. */
    prefix?: string;
  };
}

/** A listing over a JSON array, with a mapping for each field. */
export interface JsonListing {
  url: string;
  /** Dot path to the array. `data` or `results` or `docs`. */
  path: string;
  title: string;
  url_: string;
  thumb?: string;
  author?: string;
  description?: string;
  /** Page-number param, e.g. `page` or `offset`. */
  pageParam?: string;
  /** How many items per page. */
  limit?: number;
  /** True when the response reports more results. */
  hasMore?: string;
  transform?: "reverse" | "distinct";
}

/** A single JSON object, or an array mapped into one. */
export interface JsonRule {
  url: string;
  path: string;
  title?: string;
  author?: string;
  artist?: string;
  description?: string;
  thumbnail?: string;
  status?: { path: string; map: Record<string, number> };
  genres?: string;
  /** For page lists: path to the image url on each entry. */
  image?: string;
  pageParam?: string;
  limit?: number;
}

export interface SourcePlugin {
  /**
   * Source id.
   *
   * Declared as a string deliberately. Tachiyomi Gen 2 ids are 64-bit hashes
   * (e.g. "6289731484943315811") which do NOT survive a JSON number round
   * trip — `Number("6289731484943315811")` collapses to 6289731484943316000.
   * Sources that carry their own upstream id therefore declare it as a
   * string; our own sources use a shorter numeric-range id for the same
   * reason.
   */
  id: string;
  name: string;
  lang: string;
  /** Bump when selectors break — used to cache-bust cached pages. */
  version: number;
  icon?: string;
  nsfw: boolean;
  /**
   * Gen 2 provenance, so a plugin can be traced back to the upstream extension
   * it was ported from. `packageName` is the `eu.kanade.tachiyomi.extension.*`
   * / `keiyoushi.*` coordinate.
   */
  gen2?: {
    packageName: string;
    versionName: string;
    versionCode: string;
    homeUrl?: string;
  };
  /**
   * True when this source points at a piracy / shadow-library site. Such
   * sources are hidden behind an explicit, per-source opt-in so the choice is
   * the user's, not a default.
   */
  piracy?: boolean;
  baseUrl: string;
  headers?: Record<string, string>;
  /** Bot-wall hint. `cloudflare` routes through the Worker relay. */
  client?: "default" | "cloudflare" | "custom";
  /**
   * Shared site engine. `madara` covers the WordPress `madara` plugin, which
   * ~248 of the Tachiyomi source list runs — one port, hundreds of sites.
   * A theme plugin needs no `endpoints`; the engine supplies them.
   */
  theme?: "madara" | "json";
  /** Present on Madara sources; see MadaraOverride. */
  madara?: MadaraOverride;
  /**
   * What this source returns.
   *  - `manga`  — comics/graphic novels, read in the page reader
   *  - `book`   — text, read in the EPUB/text reader
   *  - `mixed`  — a site carrying both (most scanlation sites)
   *
   * Discover uses this to route a result to the right reader, so one search
   * can return books and manga side by side.
   */
  kind?: "manga" | "book" | "mixed";
  /** Marks a source that speaks JSON rather than HTML. See `json` on endpoints. */
  api?: "json";
  filters?: FilterDef[];
  endpoints: SourceEndpoints;
}

/**
 * What a plugin *does*.
 *
 * A source is only one kind of plugin. Kora also takes themes (which restyle
 * the reader) and integrations (which move a library in and out of another
 * app), so `category` decides how the hub renders and what the runtime
 * expects to find on the definition.
 *
 * A `source` carries `baseUrl` + `endpoints`/`theme` and is fetchable. The
 * others carry configuration for their own runtime and are not — which is
 * why `endpoints` is optional here rather than required.
 */
export type PluginCategory = "source" | "theme" | "integration" | "tool";

/** Integrations a plugin can bridge to, for display and permission copy. */
export type IntegrationTarget = "kindle" | "calibre" | "croc";

/**
 * A theme plugin's palette.
 *
 * These map 1:1 onto the CSS custom properties `index.css` already declares
 * (`--theme-bg` … `--toast-bg`), so a theme plugin writes the same variables a
 * built-in `.theme-*` class would. `toastBg` is optional; the rest are not,
 * because a theme missing them is a broken theme, not a partial one.
 */
export interface ThemeTokens {
  bg: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  card: string;
  /** Toast surface tint. Falls back to the built-in value when omitted. */
  toastBg?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  category: PluginCategory;
  /** Author or maintainer, shown on the detail sheet. */
  author?: string;
  description?: string;
  icon?: string;
  website?: string;
  /** Legal flag, as on a source: true points at a site with no clear right. */
  piracy?: boolean;
  nsfw?: boolean;
  /** Only for `integration`: which external app this bridges to. */
  target?: IntegrationTarget;
  /** Only for `theme`: the theme token set id it applies. */
  themeId?: string;
  /** Only for `theme`: the palette to write. See ThemeTokens. */
  tokens?: ThemeTokens;
  /**
   * Only for `theme`: whether this theme is a dark scheme.
   *
   * Kora drives Tailwind's `dark:` variant and the system status bar off this
   * one flag, so a theme has to declare it or the app will render dark
   * surfaces with light-mode components.
   */
  dark?: boolean;
  /**
   * Honest status for an integration that is not yet functional.
   *
   * `unavailable` means the plugin cannot work as shipped. The UI says so
   * plainly instead of offering an install that silently does nothing.
   */
  availability?: "ready" | "unavailable";
  /** Why it is unavailable, or what the user must supply. Shown verbatim. */
  availabilityNote?: string;
  /**
   * What the plugin needs before it runs. The hub uses this to show an
   * honest prerequisite instead of failing at first use.
   *  - `permission` — needs an explicit user grant
   *  - `device`     — needs the native app
   *  - `network`    — needs a reachable remote
   */
  requires?: ("permission" | "device" | "network")[];
  /** Source-only payload; see SourcePlugin. */
  source?: SourcePlugin;
}

export type MangaStatus = 1 | 2 | 3 | 4 | 5 | 6;

export interface Manga {
  /** Path relative to baseUrl — mirrors Tachiyomi's setUrlWithoutDomain. */
  url: string;
  title: string;
  thumbnailUrl?: string;
  author?: string;
  artist?: string;
  description?: string;
  status?: MangaStatus;
  genres?: string[];
  /** False until details/chapters have been fetched, so the UI can show a placeholder. */
  initialized: boolean;
  sourceId: string;
}

export interface Chapter {
  url: string;
  name: string;
  /** -1 for one-shots with no numbering, matching Tachiyomi. */
  chapterNumber: number;
  dateUpload?: number;
}

export interface Page {
  /** Positional advisory, exactly as Tachiyomi documents it. */
  index: number;
  /**
   * The panel image.
   *
   * Tachiyomi names this `image`, with `url` reserved for the chapter page it
   * was scraped from. The field is required because a page with no image is
   * not a page — a caller must never have to null-check before rendering.
   */
  image: string;
  /** The page this image was found on. Informational. */
  url?: string;
}

export interface MangasPage {
  mangas: Manga[];
  hasNextPage: boolean;
}

/** A plugin the user has installed, with its local state. */
export interface InstalledSource {
  source: SourcePlugin;
  installedAt: number;
  enabled: boolean;
  /** Set when the user has acknowledged the piracy notice for this source. */
  piracyAcceptedAt?: number;
}

/** A third-party repository the user pointed Kora at. */
export interface ExternalRepo {
  id: string;
  name: string;
  url: string;
  addedAt: number;
  lastFetchedAt?: number;
  lastError?: string;
  /** Plugins this repo advertises that are not in the official registry. */
  sourceCount?: number;
}

/** Result envelope for a registry fetch. */
export interface RegistryFile {
  repo: string;
  name?: string;
  updatedAt?: string;
  sources: SourcePlugin[];
}

/**
 * Madara theme overrides.
 *
 * Only needed when a site deviates from the WordPress `madara` plugin's
 * default markup. Omit a field to inherit the base selector.
 */
export interface MadaraSelectors {
  listingCard?: string;
  listingUrl?: string;
  listingTitle?: string;
  listingThumb?: string;
  nextPage?: string;
  detailsTitle?: string;
  detailsAuthor?: string;
  detailsArtist?: string;
  detailsStatus?: string;
  detailsDescription?: string;
  detailsThumbnail?: string;
  detailsGenre?: string;
  chapterList?: string;
  chapterUrl?: string;
  chapterName?: string;
  chapterDate?: string;
  pageList?: string;
  pageImage?: string;
  pageImageLazy?: string;
}

export interface MadaraOverride {
  /** Path segment for the listing. Most sites use `manga`; some use `serie`. */
  mangaSubString?: string;
  popularOrderBy?: string;
  latestOrderBy?: string;
  selectors?: MadaraSelectors;
}

export interface MadaraPlugin extends SourcePlugin {
  theme: "madara";
  madara?: MadaraOverride;
}
