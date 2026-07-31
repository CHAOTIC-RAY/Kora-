# EPUB Creator & Templates Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let users create their own EPUB inside Kora, starting from multiple built-in templates, with AI-assisted or style-transfer cover generation.

**Architecture:** Add a new `EpubCreator` flow on top of the existing EPUB metadata injection in `src/App.tsx`. Store the generated `.epub` blob in app storage as a new `BookMetadata` entry using the existing library flow, so the new book appears in the library and opens in `BookReaderEPUB`. Covers are generated client-side via a canvas/text pipeline or an optional AI image provider, saved as PNG then embedded in the EPUB zip.

**Tech Stack:** React, TypeScript, Tailwind, JSZip, Vite. Optional: AI image provider endpoint if user enables one.

---

## Inventory Checklist

- [ ] Verify EPUB dependency stack: JSZip present in `package.json`, or add it.
- [ ] Locate/create reusable EPUB generation utilities (`injectMetadataIntoEpub` already exists).
- [ ] Identify library collection entry points so generated books can be added to the user library.
- [ ] Identify where to wire a new `+ Create EPUB` action from the library/discover UI.
- [ ] Verify cover bitmap handling works on Android + Web storage paths.

## Task Breakdown

### Task 1: Scaffold EPUB creator module

**Objective:** Add a minimal `src/lib/epubCreator.ts` that builds a valid EPUB zip from text, optional HTML chapters, metadata, and cover bytes.

**Files:**
- Create: `src/lib/epubCreator.ts`
- Modify: `src/App.tsx` (imports only)

**Step 1:** Add file implementing `createBlankEpub({ title, author, chapters, coverPng })` using JSZip, mimetype, container.xml, OPF, NCX, chapter HTML files, and cover insert.

```typescript
export interface EpubChapter {
  title: string;
  html: string;
}
export interface EpubOptions {
  title: string;
  author: string;
  chapters: EpubChapter[];
  coverPng?: Blob;
}
export async function createBlankEpub(opts: EpubOptions): Promise<Blob> { ... }
```

**Step 2:** Run `npx tsc --noEmit --pretty`.
Expected: TSC_OK.

**Step 3:** Commit.

```bash
git add src/lib/epubCreator.ts src/App.tsx
git commit -m "feat(epub): add minimal epub creator utility"
```

### Task 2: Add built-in templates data and selection UI

**Objective:** Provide 3 starter templates in `src/lib/epubTemplates.ts` and a template picker in the Epuc Creator UI.

**Files:**
- Create: `src/lib/epubTemplates.ts`
- Modify: `src/components/EpubCreatorView.tsx` (new component)
- Modify: `src/App.tsx` (routing/tab)

**Step 1:** Add templates:

```typescript
export interface EpubTemplate {
  id: string;
  name: string;
  description: string;
  chapters: EpubChapter[];
}
export const EPUB_TEMPLATES: EpubTemplate[] = [...];
```

Include:
- "Blank Novel" — title page + blank body chapters
- "Journal" — dated chapter entries
- "Poetry Collection" — title + poem per chapter

**Step 2:** Create `EpubCreatorView.tsx` with a 3-step flow: Template → Edit Metadata → Preview/Generate. Use Tailwind + existing `kindle-*` theme tokens.

**Step 3:** Run `npm run build`.
Expected: PASS.

**Step 4:** Commit.

```bash
git add src/lib/epubTemplates.ts src/components/EpubCreatorView.tsx src/App.tsx
git commit -m "feat(epub): add template picker and creator view"
```

### Task 3: Add cover generation UI and style presets

**Objective:** Let users generate a creative cover from text, solid gradient, noise texture, or optional AI image prompt, then save it as PNG bytes for EPUB embedding.

**Files:**
- Modify: `src/components/EpubCreatorView.tsx`

**Step 1:** Add cover canvas pipeline using `<canvas>`:
- presets: "Ink Sketch", "Watercolor", "Neon Glitch", "Minimalist"
- always include title/author overlay

**Step 2:** Export canvas to PNG Blob, pass into `createBlankEpub` cover field.

**Step 3:** Build, commit.

```bash
git add src/components/EpubCreatorView.tsx
git commit -m "feat(epub): add canvas cover generation with style presets"
```

### Task 4: Add EPUB creator entry point in Library

**Objective:** Add a Floating Action Button or toolbar action "Create EPUB" that opens the new creator.

**Files:**
- Modify: `src/components/LibraryManager.tsx` or discover top bar depending on UX review.

**Step 1:** Add action button.

**Step 2:** On submit from `EpubCreatorView`, write the resulting EPUB blob to library via existing import/metadata helper so it opens in `BookReaderEPUB`.

**Step 3:** Build, commit + push.

```bash
git add src/components/LibraryManager.tsx src/components/EpubCreatorView.tsx
git commit -m "feat(epub): wire creator into library UI"
```

## Tests / Validation

- Run `npm run build` after each task; expect no new warnings.
- Run `npx tsc --noEmit --pretty`; expect `TSC_OK`.
- Manual validation: create a book from each template on Web + Android APK build; verify it opens in reader and cover displays.
- Confirm generated EPUB is valid zipped XML structure; open in external reader as control.

## Risks, Tradeoffs, and Open Questions

- AI-generated covers require optional backend; default to deterministic canvas generation if none provided.
- EPUB authors vary robustness; keep generated markup minimal to maximize reader compatibility.
- Large cover PNGs inflate EPUB size; resize to 1200px wide before embedding.
- File save location differs between Web (IndexedDB via Storage) and Android; reuse existing blob import flow.
