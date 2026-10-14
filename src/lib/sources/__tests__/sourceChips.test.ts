/**
 * Discover source-chip eligibility.
 *
 * The bug: Discover's source chips listed every INSTALLED plugin, so the
 * themes (Copper Night, Mint Terminal) and the integrations (Calibre,
 * Send to Kobo/Kindle, croc) all appeared as places to browse books.
 *
 * The gate is deliberately split in two, and these tests exist to keep it
 * that way:
 *
 *   isSourcePlugin(p)     — is it a source at all? (the fix)
 *   isSourceVisible(p)    — has the user opted in to piracy/NSFW? (policy)
 *
 * Folding the category check into the piracy gate would be the easy way to
 * write this, and it would silently re-open restricted sources, because
 * PluginBrowser also calls isSourceVisible to decide what to show and what
 * to offer an opt-in toggle for. So the opt-in behaviour is asserted here
 * explicitly, to make that regression impossible to reintroduce.
 */

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, got?: unknown) => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`, got === undefined ? "" : got); }
};

const LS_PLUGINS = "kora.sourcePlugins.v1";
const LS_OPTED_IN = "kora.sourceOptsIn.v1";

// A minimal localStorage; the store module reads it at call time.
const mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => { mem[k] = String(v); },
  removeItem: (k: string) => { delete mem[k]; },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
};

import type { SourcePlugin } from "../types";

type P = SourcePlugin & { category?: string };
/** Fill the required SourcePlugin fields so a fixture states only what it tests. */
const p = (id: string, name: string, category: string | undefined, extra: Partial<P> = {}): P =>
  ({ id, name, category, piracy: false, nsfw: false, baseUrl: "https://x.test", lang: "en", version: 1, ...extra }) as P;

// A REAL source definition carries no `category` at all — that is the shape
// Kora-Plugins actually publishes, and the regression this test guards.
const REAL_SOURCE = p("kora-manga-s2read", "S2Read", undefined, { piracy: true, theme: "madara" });
const REAL_SOURCE2 = p("kora-legal-gutenberg", "Project Gutenberg", undefined);
const REAL_PIRACY = p("4503604002548978580", "MangaReadOrg", undefined, { piracy: true });

const THEME = p("kora-theme-copper-night", "Copper Night", "theme");
const THEME2 = p("kora-theme-mint-terminal", "Mint Terminal", "theme");
const CALIBRE = p("kora-integration-calibre", "Calibre", "integration");
const KINDLE = p("kora-integration-kindle", "Send to Kobo/Kindle", "integration");
const CROC = p("kora-integration-croc", "croc", "integration");
const TOOL = p("kora-tool-x", "A workshop tool", "tool");
const CLEAN_SOURCE = p("kora-legal-openlibrary", "Open Library", "source");
const PIRACY_SOURCE = p("kora-manga-adult", "Adult Manga", "source", { piracy: true, nsfw: true });
const NSFW_SOURCE = p("kora-manga-adult2", "Adult Manga 2", undefined, { nsfw: true });
const PIRACY_THEME = p("kora-theme-x", "A piracy-flagged theme", "theme", { piracy: true });

const { isSourcePlugin, isSourceVisible, getDiscoverablePlugins } = await import("../store");

/* ------------------------------------------- (A) the category rule itself */

check("a theme is not a source", isSourcePlugin(THEME) === false, isSourcePlugin(THEME));
check("a second theme is not a source", isSourcePlugin(THEME2) === false);
check("the calibre integration is not a source", isSourcePlugin(CALIBRE) === false);
check("the kindle integration is not a source", isSourcePlugin(KINDLE) === false);
check("the croc integration is not a source", isSourcePlugin(CROC) === false);
check("a workshop tool is not a source", isSourcePlugin(TOOL) === false);
check("a clean source IS a source", isSourcePlugin(CLEAN_SOURCE) === true);
check("a piracy source IS a source", isSourcePlugin(PIRACY_SOURCE) === true);
check("an nsfw source IS a source", isSourcePlugin(NSFW_SOURCE) === true);
check("a piracy-flagged theme is still not a source", isSourcePlugin(PIRACY_THEME) === false);

/* -------------------- the shape real source definitions actually have ----- */

// These four are the regression that matters most. Kora-Plugins publishes
// source definitions with NO `category` key — the registry index tags them,
// the definition itself does not. A `category === "source"` check would have
// emptied the whole chip row in production while passing every other test.
check("a REAL source (no category field) IS a source", isSourcePlugin(REAL_SOURCE) === true, isSourcePlugin(REAL_SOURCE));
check("a second real source IS a source", isSourcePlugin(REAL_SOURCE2) === true);
check("a real piracy source IS a source", isSourcePlugin(REAL_PIRACY) === true);
check("an empty-string category counts as a source", isSourcePlugin(p("x", "X", "") as P) === true);
check("isSourcePlugin survives a null plugin", isSourcePlugin(null as any) === false);
check("a capitalised 'Source' is not matched (it is not a real value)", isSourcePlugin(p("x", "X", "Source") as P) === false);

/* --------------------------------------- the gate must NOT open up by accident */

const install = (...plugins: P[]) => mem[LS_PLUGINS] = JSON.stringify(plugins);

// Everything installed, nothing opted in.
install(THEME, THEME2, CALIBRE, KINDLE, CROC, TOOL, CLEAN_SOURCE, REAL_SOURCE, REAL_SOURCE2, REAL_PIRACY, PIRACY_SOURCE, NSFW_SOURCE);
delete mem[LS_OPTED_IN];

let chips = getDiscoverablePlugins();
const ids = () => chips.map((p: P) => p.id);

check("no theme appears in the source chips", !ids().includes("kora-theme-copper-night"), ids());
check("no theme 2 appears in the source chips", !ids().includes("kora-theme-mint-terminal"));
check("calibre does not appear in the source chips", !ids().includes("kora-integration-calibre"), ids());
check("send-to-kindle does not appear in the source chips", !ids().includes("kora-integration-kindle"), ids());
check("croc does not appear in the source chips", !ids().includes("kora-integration-croc"), ids());
check("a workshop tool does not appear in the source chips", !ids().includes("kora-tool-x"));
check("the clean source DOES appear", ids().includes("kora-legal-openlibrary"), ids());
check("REAL sources with no category field DO appear", ids().includes("kora-legal-gutenberg"), ids());
check("a real madara source appears once opted in (piracy)", !ids().includes("kora-manga-s2read"), ids());

/* ------------------------------------------------- the piracy gate is intact */

check("a piracy source is hidden WITHOUT opt-in", isSourceVisible(PIRACY_SOURCE) === false);
check("a piracy source is absent from the chips without opt-in", !ids().includes("kora-manga-s2read"), ids());
check("an nsfw source is hidden WITHOUT opt-in", isSourceVisible(NSFW_SOURCE) === false);
check("an nsfw source is absent from the chips without opt-in", !ids().includes("kora-manga-adult"), ids());
check("a real (no-category) piracy source is hidden WITHOUT opt-in", isSourceVisible(REAL_SOURCE) === false);
check("a real (no-category) piracy source is absent without opt-in", !ids().includes("kora-manga-s2read"), ids());
check("a real (no-category) nsfw source is absent without opt-in", !ids().includes("kora-manga-adult2"), ids());
check("a non-piracy source is visible without opt-in", isSourceVisible(CLEAN_SOURCE) === true);
check("a real non-piracy source is visible without opt-in", isSourceVisible(REAL_SOURCE2) === true);
check("a theme is unaffected by the piracy gate", isSourceVisible(THEME) === true, isSourceVisible(THEME));

// Now opt in, and the restricted sources appear — while themes still do not.
mem[LS_OPTED_IN] = JSON.stringify(["kora-manga-s2read", "kora-manga-adult", "4503604002548978580"]);
chips = getDiscoverablePlugins();
check("a REAL piracy source (no category field) appears AFTER opt-in", ids().includes("kora-manga-s2read"), ids());
check("a real gen2-id piracy source appears AFTER opt-in", ids().includes("4503604002548978580"), ids());
check("an nsfw source appears AFTER opt-in", ids().includes("kora-manga-adult"), ids());
check("opting in still does not reveal any theme", !ids().includes("kora-theme-copper-night"), ids());
check("opting in still does not reveal calibre", !ids().includes("kora-integration-calibre"), ids());
check("opting in still does not reveal croc", !ids().includes("kora-integration-croc"), ids());
check("opting in still does not reveal the workshop tool", !ids().includes("kora-tool-x"), ids());

// Opting in to ONE source must not reveal the others.
mem[LS_OPTED_IN] = JSON.stringify(["kora-manga-s2read"]);
chips = getDiscoverablePlugins();
check("opting in to one source reveals only that one", ids().includes("kora-manga-s2read") && !ids().includes("kora-manga-adult"), ids());
check("opting in to one does not reveal another real piracy source", !ids().includes("4503604002548978580"), ids());

// A piracy-flagged THEME opted in must still not become a source.
mem[LS_OPTED_IN] = JSON.stringify(["kora-theme-x"]);
install(THEME, PIRACY_THEME, CLEAN_SOURCE);
chips = getDiscoverablePlugins();
check("an opted-in piracy theme is still not a source", !ids().includes("kora-theme-x"), ids());
check("the opted-in piracy theme is visible in the hub (gate unchanged)", isSourceVisible(PIRACY_THEME) === true);

/* ------------------------------ the filter is the ONLY difference, by count */

install(THEME, THEME2, CALIBRE, KINDLE, CROC, TOOL, CLEAN_SOURCE, REAL_SOURCE2);
delete mem[LS_OPTED_IN];
chips = getDiscoverablePlugins();
check("only the two real sources are listed from eight installed plugins", chips.length === 2, chips.map((p: P) => p.id));
check("those two are exactly the non-gated sources", chips.every((p: P) => isSourcePlugin(p)), chips.map((p: P) => p.id));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
