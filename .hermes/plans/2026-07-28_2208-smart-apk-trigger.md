# Smart APK CI Trigger Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Stop the Android APK GitHub Action from building/releasing on every push to `main`/`beta` — only run it when a change actually affects the APK (native `android/` code, web `src/`/`public/` assets, or build config).

**Architecture:** Add a `paths:` filter to the existing `push` (and `pull_request`) trigger in `.github/workflows/android-apk.yml`. The APK is assembled from (a) the native Android project under `android/` and (b) the web bundle produced by `npm run build:apk-web` from `src/`, `public/`, `index.html`, `capacitor.config.ts`, `vite.config.ts`, and JS deps in `package.json`/`package-lock.json`. Any other file (README, `.github/`, `firestore.rules`, `wrangler.toml`, `PLAN.md`, `replit.md`, `scripts/`, `functions/`, `server.ts`, `*.cjs`/`*.mjs` root helpers, `dict-en-en`, `contrib.json`, `metadata.json`, `assets/`, `dist/`, `node_modules/`, `tmp/`) does NOT change the APK and must not trigger a build. Manual `workflow_dispatch` stays always-on so we can still force a release.

**Tech Stack:** GitHub Actions YAML (`on.push.paths` / `on.pull_request.paths`), existing Capacitor/Android build pipeline (unchanged).

---

## Current Context / Assumptions

- Trigger block (lines 3-18 of `.github/workflows/android-apk.yml`):
  ```yaml
  on:
    workflow_dispatch:
      inputs:
        api_base_url: ...
        publish_release: ...
    push:
      branches: [main, beta]
    pull_request:
      branches: [main]
  ```
- The job `build-apk` runs `npm ci` → `npm run build:apk-web` → `npx cap sync android` → `gradle assembleRelease` → publishes a GitHub Release (tag `apk-v*`).
- `concurrency` already cancels in-progress runs for the same ref (`cancel-in-progress: true`) — keep it.
- Every push to `main` currently mints a new APK + a new `apk-v*` tag + release, even for README/typo edits. This is the waste to eliminate.

## Proposed Approach

1. Add a `paths:` include-list to the `push` trigger so the workflow only runs when an APK-relevant path changes.
2. Add the same `paths:` filter to the `pull_request` trigger (so PRs that don't touch app code don't burn CI minutes), keeping `workflow_dispatch` unrestricted.
3. Add an explicit `paths-ignore` safety net is NOT needed — an include-list (`paths:`) alone is sufficient and clearer.
4. Verify the filter with `gh workflow view` / a dry run by pushing a README-only change to a branch and confirming the workflow is skipped (GitHub shows "skipped" when `paths` excludes the change).

## Files Likely To Change

- Modify: `.github/workflows/android-apk.yml` (lines 3-18, the `on:` block only)

## Step-by-Step Plan

### Task 1: Replace the `on:` trigger block with a path-filtered version

**Objective:** Gate the APK build on changes to APK-affecting paths while keeping manual dispatch.

**Files:**
- Modify: `.github/workflows/android-apk.yml:3-18`

**Step 1: Write the new `on:` block**

Replace the entire `on:` section (currently lines 3-18) with:

```yaml
on:
  workflow_dispatch:
    inputs:
      api_base_url:
        description: "Cloudflare Worker / API origin (no trailing slash)"
        required: false
        default: ""
      publish_release:
        description: "Publish GitHub Release"
        required: true
        default: true
        type: boolean
  push:
    branches: [main, beta]
    # Only rebuild the APK when a change can actually affect it.
    paths:
      - 'android/**'
      - 'src/**'
      - 'public/**'
      - 'assets/**'
      - 'index.html'
      - 'capacitor.config.ts'
      - 'vite.config.ts'
      - 'package.json'
      - 'package-lock.json'
      - 'bun.lock'
      - '.github/workflows/android-apk.yml'
  pull_request:
    branches: [main]
    paths:
      - 'android/**'
      - 'src/**'
      - 'public/**'
      - 'assets/**'
      - 'index.html'
      - 'capacitor.config.ts'
      - 'vite.config.ts'
      - 'package.json'
      - 'package-lock.json'
      - 'bun.lock'
      - '.github/workflows/android-apk.yml'
```

Notes:
- `workflow_dispatch` stays unfiltered → manual releases always work (important: a workflow file change under `.github/workflows/` would otherwise be blocked by its own `paths` filter on `push`; we keep `.github/workflows/android-apk.yml` in the list so editing the workflow itself still re-runs, and manual dispatch is unaffected regardless).
- `bun.lock` / `package-lock.json` included because a dependency change can change the web bundle.
- `assets/**` included because web assets are bundled into `dist` at build time.

**Step 2: Validate YAML parses correctly**

Run:
```bash
python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/android-apk.yml')); print('on.push.paths:', d['on']['push'].get('paths')); print('dispatch unfiltered:', 'paths' not in d['on']['workflow_dispatch'])"
```
Expected: prints the `paths` list for `push`, and `dispatch unfiltered: True`.

**Step 3: Confirm the job/concurrency block below is untouched**

Run:
```bash
sed -n '19,23p' .github/workflows/android-apk.yml
```
Expected: still shows
```
concurrency:
  group: android-apk-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**Step 4: Commit**

```bash
git add .github/workflows/android-apk.yml
git commit -m "ci: only build APK on changes that affect it (path filter)"
```

### Task 2: Verify the filter skips irrelevant pushes

**Objective:** Prove a non-APK change (e.g. README edit) does NOT trigger the APK workflow.

**Step 1: Create a throwaway branch with a README-only change**

```bash
git checkout -b ci-skip-test main
echo "<!-- trigger test -->" >> README.md
git add README.md
git commit -m "docs: trigger-skip probe"
git push -u origin ci-skip-test
```

**Step 2: Open a PR from `ci-skip-test` → `main` and observe**

In GitHub: the "Build Android APK" check should appear as **skipped** (gray, not queued/running) because `paths` excludes `README.md`.
Expected: workflow shows "This workflow has been skipped because the workflow file has changed or the branch filter/paths filter do not match."

**Step 3: Clean up the probe branch**

```bash
git checkout main
git push origin --delete ci-skip-test
git branch -D ci-skip-test
```

**Step 4: Confirm a real APK-affecting change still builds**

Make ANY small edit under `src/` (e.g. a one-line comment in `src/components/InstallView.tsx`), push to `main`, and confirm the "Build Android APK" workflow runs (not skipped) and publishes a new `apk-v*` release.

## Tests / Validation

- YAML parse check (Task 1 Step 2) passes.
- `push` to `main` with only `README.md` / `.github/`-unrelated doc change → APK workflow **skipped**.
- `push` to `main` touching `src/**` or `android/**` → APK workflow **runs** and releases.
- `workflow_dispatch` (manual "Run workflow") → APK workflow **always runs** regardless of paths.

## Risks, Tradeoffs, Open Questions

- **Missed trigger path:** if a future change outside the listed globs affects the APK (e.g. a new root build file, or `tsconfig.json` altering output), the build won't run automatically. Mitigation: `workflow_dispatch` is always available for manual runs, and `tsconfig.json` could be added to the list if it's later found to matter. Keep the list minimal but cover the known inputs to `npm run build:apk-web` + `cap sync`.
- **Workflow self-edit:** edits to `.github/workflows/android-apk.yml` are included in `paths` so the pipeline re-runs after we change the filter (the first push of this plan will itself build once, which is expected/acceptable).
- **`pull_request` from forks:** path filters work for fork PRs too; fork PRs that don't touch app code won't consume CI minutes.
- **Open question:** do we also want to gate the *release publish* (the `softprops/action-gh-release` step) separately from the *build*? Not necessary — if the build doesn't run, nothing publishes. Keep it simple.
