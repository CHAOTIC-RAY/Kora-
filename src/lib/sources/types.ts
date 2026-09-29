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

export interface SourcePlugin {
  id: number;
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
  filters?: FilterDef[];
  endpoints: SourceEndpoints;
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
  sourceId: number;
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
  url: string;
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
