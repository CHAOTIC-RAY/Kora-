/**
 * A dead source must not look healthy.
 *
 * MangaZin lists series, shows a synopsis and returns a real chapter list, and
 * 404s on every panel. Nothing in the app said so, so the whole experience read
 * as a working source until the reader came up blank. The registry has said
 * `readable: false` the whole time; the index carried it and the app threw it
 * away.
 *
 * These cover the three things that can regress:
 *   1. the verdict survives index -> RepoEntry,
 *   2. a MISSING verdict defaults to readable (the direction that matters),
 *   3. the badge renders for a dead source, and only for a dead source, and is
 *      visually distinct from the piracy amber.
 *
 * The cards are rendered for real (react-dom/server) rather than pattern-
 * matched, because "renders a badge" is a claim about what the user sees.
 */

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

// ── A registry shaped like the live one, plus one unreadable source ────────
const INDEX = {
  name: "Kora Plugins",
  badgeLabel: "KORA",
  extensionList: {
    extensions: [
      {
        name: "Mangazin",
        packageName: "kora.source.mangazin",
        resources: {
          apkUrl: "https://kora.test/mangazin.json",
          iconUrl: "https://kora.test/mangazin.png",
        },
        versionCode: "1000",
        versionName: "1.0.0",
        sources: [
          {
            id: "4503604003186470944",
            name: "MangaZin",
            language: "en",
            piracy: true,
            nsfw: false,
            category: "source",
            homeUrl: "https://mangazin.org",
            // The verdict the registry already records.
            readable: false,
            readableNote: "panels: panel not served for 3 chapter(s)",
            readableCheckedAt: "2026-09-30T07:19:29.097Z",
          },
        ],
      },
      {
        name: "Mangareadorg",
        packageName: "kora.source.mangareadorg",
        resources: {
          apkUrl: "https://kora.test/mangaread-org.json",
          iconUrl: "https://kora.test/mangaread-org.png",
        },
        versionCode: "1000",
        versionName: "1.0.0",
        // No `readable` at all — an older/partial registry entry.
        sources: [
          {
            id: "4503604002548978580",
            name: "MangaReadOrg",
            language: "en",
            piracy: true,
            nsfw: false,
            category: "source",
            homeUrl: "https://mangaread.org",
          },
        ],
      },
    ],
  },
};

(globalThis as any).fetch = (async (url: string) => {
  if (url === "https://kora.test/index.json") {
    return { ok: true, status: 200, json: async () => INDEX, clone: () => ({ text: async () => "" }) } as any;
  }
  return { ok: false, status: 404 } as any;
}) as any;

const { fetchRegistry, isUnreadableSource, readableNoteFor } = await import("../store");
const entries = await fetchRegistry("https://kora.test/index.json");
const mz = entries.find((e) => e.plugin.id === "4503604003186470944")!;
const mr = entries.find((e) => e.plugin.id === "4503604002548978580")!;

// ── 1. The verdict survives the index -> RepoEntry mapping ────────────────
check("registry entry with readable:false is flagged unreadable", isUnreadableSource(mz) === true);
check("RepoEntry.readable is false", mz.readable === false, mz.readable);
check("the registry note is carried through", mz.readableNote === "panels: panel not served for 3 chapter(s)", mz.readableNote);
check("note is also readable off the plugin", readableNoteFor(mz) === "panels: panel not served for 3 chapter(s)");
check("note reads off the plugin alone", readableNoteFor(mz.plugin) === "panels: panel not served for 3 chapter(s)");

// ── 2. THE REGRESSION GUARD: absent means readable ─────────────────────────
// If this ever inverts, every source in every pre-flag registry is painted as
// broken. That is the failure mode worth a test.
check("MISSING readable defaults to readable", isUnreadableSource(mr) === false);
check("missing verdict yields RepoEntry.readable true", mr.readable === true, mr.readable);
check("missing verdict carries no note", readableNoteFor(mr) === "", readableNoteFor(mr));
check("null subject is not unreadable", isUnreadableSource(null) === false);
check("undefined subject is not unreadable", isUnreadableSource(undefined) === false);
check("no note when none recorded", readableNoteFor(null) === "");

// Direct predicate checks, independent of the registry plumbing.
check("bare plugin readable:false -> unreadable", isUnreadableSource({ readable: false }) === true);
check("bare plugin readable:true -> readable", isUnreadableSource({ readable: true }) === false);
check("bare plugin no field -> readable", isUnreadableSource({}) === false);
check("readable:false on the entry wins", isUnreadableSource({ readable: false, plugin: { readable: true } }) === true);
check("entry readable:true with dead plugin -> dead", isUnreadableSource({ readable: true, plugin: { readable: false } }) === true);
check("a piracy source is not thereby dead", isUnreadableSource({ readable: true }) === false);

// ── 3. The surfaces ──────────────────────────────────────────────────────
const { renderToStaticMarkup } = await import("react-dom/server");
const React = (await import("react")).default;
const { SourceCard } = await import("../../../components/PluginBrowser");
const { SourceDetail } = await import("../../../components/SourceDetailSheet");

function card(entry: any) {
  return renderToStaticMarkup(
    React.createElement(SourceCard as any, {
      entry,
      installed: false,
      allowed: true,
      onOpen: () => {},
      onInstall: () => {},
      onUninstall: () => {},
      onToggleAllow: () => {},
    })
  );
}
const deadCard = card(mz);
const liveCard = card(mr);

check("hub card badges an unreadable source", deadCard.includes("Images unavailable"));
check("hub badge carries the note as a tooltip", deadCard.includes("panel not served for 3 chapter(s)"));
check("hub card shows NO badge for a readable source", !liveCard.includes("Images unavailable"));
check("a dead source is still listed, not hidden", deadCard.includes("MangaZin"));

// The two badges must not be mistakable for one another: amber means
// "restricted but working", slate means "serves nothing".
const amberOnDead = deadCard.includes("Shadow library");
check("piracy badge still renders on a dead piracy source", amberOnDead === true);
/**
 * The opening `<span ...>` that contains a badge label, so the assertion is
 * about that badge's own classes and not about whatever markup happens to sit
 * a few hundred characters earlier.
 */
function badgeTag(html: string, label: string): string {
  const at = html.indexOf(label);
  if (at < 0) return "";
  const start = html.lastIndexOf("<span", at);
  return start < 0 ? "" : html.slice(start, at);
}
const piracyChunk = badgeTag(deadCard, "Shadow library");
const deadChunk = badgeTag(deadCard, "Images unavailable");
check("piracy badge is amber", piracyChunk.includes("amber"), piracyChunk.slice(-160));
check("unreadable badge is NOT amber", !deadChunk.includes("amber"), deadChunk.slice(-160));
check("unreadable badge is slate", deadChunk.includes("slate"), deadChunk.slice(-160));
check(
  "the two badges use different colours",
  piracyChunk.includes("amber") && deadChunk.includes("slate") && !deadChunk.includes("amber")
);

// Detail sheet.
function detail(entry: any) {
  return renderToStaticMarkup(
    React.createElement(SourceDetail as any, {
      plugin: entry.plugin,
      installed: false,
      active: true,
      readable: isUnreadableSource(entry),
      readableNote: readableNoteFor(entry),
      onInstall: () => {},
      onUninstall: () => {},
      onToggleAllow: () => {},
      onClose: () => {},
    })
  );
}
const deadSheet = detail(mz);
const liveSheet = detail(mr);
check("detail sheet states the source cannot serve page images", deadSheet.includes("cannot serve page images"));
check("detail sheet quotes the registry note", deadSheet.includes("panels: panel not served for 3 chapter(s)"));
check("detail sheet badges the dead source", deadSheet.includes("Images unavailable"));
check("detail sheet shows no warning for a readable source", !liveSheet.includes("cannot serve page images"));
// The capability list is derived from `theme`, which the INDEX does not carry
// (build-index.mjs emits no theme), so it is exercised on the definition shape
// the sheet also receives once a source is installed. Asserting on the index
// stub instead would test the `endpoints` branch that nothing ships through.
{
  const madara = { ...mz.plugin, theme: "madara" as const };
  const dead = renderToStaticMarkup(
    React.createElement(SourceDetail as any, {
      plugin: madara,
      installed: true,
      active: true,
      readable: true,
      readableNote: mz.readableNote,
      onInstall: () => {},
      onUninstall: () => {},
      onToggleAllow: () => {},
      onClose: () => {},
    })
  );
  check(
    "a dead source does not claim it serves page images",
    dead.includes("page images unavailable") && !dead.includes("chapters and page images"),
    dead.includes("chapters and page images") ? "still claims page images" : ""
  );

  const live = renderToStaticMarkup(
    React.createElement(SourceDetail as any, {
      plugin: { ...mr.plugin, theme: "madara" as const },
      installed: true,
      active: true,
      onInstall: () => {},
      onUninstall: () => {},
      onToggleAllow: () => {},
      onClose: () => {},
    })
  );
  check("a working source still claims page images", live.includes("chapters and page images"));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);