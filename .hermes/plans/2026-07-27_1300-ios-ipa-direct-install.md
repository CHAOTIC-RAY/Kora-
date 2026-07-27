# Kora iOS (.ipa) — Direct Install Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Produce a Kora `.ipa` that can be installed on iPhones/iPads *without* the App Store, via direct download / sideload, mirroring the existing Android APK flow.

**Architecture:** Add a Capacitor **iOS** platform to the existing Vite + Capacitor project (currently Android-only). Build the native Xcode archive on a **macOS** machine (or CI), then export an `.ipa`. For "direct install" we use **Ad Hoc** distribution: sign with a Apple Developer provisioning profile that lists the target device UDIDs. End users install via a hosted `itms-services://` manifest link (Safari only) or a tool like AltStore/Sideloadly. No App Store review required.

**Tech Stack:** Capacitor 8 (`@capacitor/ios`), Xcode command line tools (`xcodebuild`), `xcrun`/`xcodebuild -exportArchive`, Apple Developer account (paid, $99/yr — required for real-device signing).

---

## ⚠️ Hard constraints (read first)

1. **This Windows host cannot build the .ipa.** `xcodebuild` / Xcode do not run on Windows. The actual compile + export MUST happen on macOS (local Mac or GitHub Actions macOS runner). This plan's steps 1–3 (config) can be done here; steps 4–7 (native build/export) need macOS.
2. **"Direct install" = Ad Hoc, not truly open.** Apple blocks unsigned sideloading. You need:
   - A paid Apple Developer account.
   - Each end-user device's **UDID** registered in the provisioning profile (max 100/yr).
   - OR use **Enterprise** distribution ($299/yr) for unlimited internal devices, OR **Developer signing** (free) which expires in 7 days.
3. **AltStore/Sideloadly** are the realistic "direct install" path for individual users without UDID pre-registration (uses the user's own free Apple ID, 7-day cert). Document both.

---

## Implementation Summary

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `.github/workflows/ios-build.yml` | **Created** | Main CI workflow: builds web assets, archives iOS, exports IPA (automatic signing for dev) |
| `.github/workflows/ios-sign.yml` | **Create** | Ad Hoc signing workflow (requires secrets) |
| `capacitor.config.ts` | **Modify** | Add `ios` config block |
| `package.json` | **Modify** | Add `@capacitor/ios` dependency |
| `public/manifest.plist` | **Create** | Install manifest for `itms-services://` link |
| `src/components/InstallView.tsx` | **Modify** | Add iOS install button/link |

---

## Task 1: Add Capacitor iOS dependency

**Objective:** Install the iOS platform package so `npx cap add ios` works.

**Files:** `package.json` (devDependencies)

**Step 1:** Add the dependency:
```bash
npm install @capacitor/ios@^8.4.2 --save-dev
```

**Step 2:** Verify it appears in `package.json` under `devDependencies`.

**Step 3:** Commit.

---

## Task 2: Extend capacitor.config.ts for iOS

**Objective:** Add an `ios` block mirroring `android` (scheme, allowNavigation, background).

**Files:** `capacitor.config.ts`

**Step 1:** Add after the `android: { ... }` block:
```ts
  ios: {
    backgroundColor: "#18181B",
    webContentsDebuggingEnabled: false,
    preferredContentMode: "mobile",
  },
```

**Step 2:** Run `npx cap add ios` locally (macOS) or `npx cap sync ios` in CI:
```bash
npx cap add ios
```

**Step 3:** Commit the generated `ios/` folder (it's needed for builds; add `ios/App/Pods` to `.gitignore` if present).

---

## Task 3: Build web assets

**Objective:** Produce the `dist/` that Capacitor copies into the iOS bundle.

**Files:** `dist/` (built)

**Step 1:** `npm run build` (already verified green, 209.3kb).

**Step 2:** `npx cap copy ios` to push `dist` into the native project.

---

## Task 4: GitHub Actions workflow for building iOS

**Objective:** Automate the build process on GitHub's macOS runners.

**Files:** `.github/workflows/ios-build.yml`

**Step 1:** Create `.github/workflows/ios-build.yml` (see file above).

**Step 2:** The workflow:
- Runs on `macos-latest`
- Installs Node.js, builds web assets
- Archives and exports `.ipa` using automatic signing (Development mode)
- Uploads IPA as a workflow artifact

**Step 3:** Trigger manually via `workflow_dispatch` or push to `main`.

**Verification:** Check the "iOS Build (.ipa)" workflow run in GitHub Actions → download artifact `Kora-iOS-IPA`.

---

## Task 5: Ad Hoc signing workflow (requires secrets)

**Objective:** Enable **Ad Hoc** distribution for direct install.

**Files:** `.github/workflows/ios-sign.yml` (create)

**Prerequisites:** Store these secrets in the repo:
- `APPLE_TEAM_ID` — Your 10-character Team ID
- `IOS_CERTIFICATE` — Base64-encoded `.p12` certificate (no password, or use `CERT_PASSWORD`)
- `IOS_CERT_PASSWORD` — Certificate password (if any)
- `IOS_PROVISIONING_PROFILE` — Base64-encoded `.mobileprovision` profile
- `CLOUDFLARE_API_TOKEN` — For deploying IPA to Workers

**Step 1:** Create `.github/workflows/ios-sign.yml`:
```yaml
name: iOS Build (Ad Hoc)

on:
  workflow_dispatch:
    inputs:
      build_number:
        description: 'Build number'
        required: true
        default: '1'
        type: string

jobs:
  build-adhoc:
    runs-on: macos-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run build
      - run: npx cap copy ios

      - name: Decode signing assets
        run: |
          echo "${{ secrets.IOS_CERTIFICATE }}" | base64 --decode > cert.p12
          echo "${{ secrets.IOS_PROVISIONING_PROFILE }}" | base64 --decode > profile.mobileprovision
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          cp profile.mobileprovision ~/Library/MobileDevice/Provisioning\ Profiles/

      - name: Export IPA (Ad Hoc)
        env:
          MATCH_PASSWORD: ${{ secrets.IOS_CERT_PASSWORD }}
          TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          # Build settings
          export ARCHIVE_PATH="${{ github.workspace }}/build/Kora.xcarchive"
          export EXPORT_PATH="${{ github.workspace }}/build/ipa"
          export PROVISIONING_PROFILE="${{ github.workspace }}/profile.mobileprovision"

          xcodebuild -workspace ios/App/App.xcworkspace \
            -scheme App \
            -configuration Release \
            -destination generic/platform=iOS \
            -archivePath "$ARCHIVE_PATH" \
            CODE_SIGN_STYLE=manual \
            DEVELOPMENT_TEAM="$TEAM_ID" \
            PROVISIONING_PROFILE_SPECIFIER="" \
            allowProvisioningUpdates \
            archive

          # Export options plist
          cat > ExportOptions.plist << 'EOF'
          <?xml version="1.0" encoding="UTF-8"?>
          <dict>
            <key>method</key><string>ad-hoc</string>
            <key>signingStyle</key><string>manual</string>
            <key>teamID</key><string>TEAM_ID_PLACEHOLDER</string>
            <key>provisioningProfiles</key>
            <dict>
              <key>app.kora.reader</key><string>$(PROVISIONING_PROFILE_SPECIFIER)</string>
            </dict>
            <key>compileBitcode</key><false/>
          </dict>
          EOF
          sed -i '' "s/TEAM_ID_PLACEHOLDER/$TEAM_ID/g" ExportOptions.plist

          xcodebuild -exportArchive \
            -archivePath "$ARCHIVE_PATH" \
            -exportPath "$EXPORT_PATH" \
            -exportOptionsPlist ExportOptions.plist

          mv "$EXPORT_PATH/App.ipa" "$EXPORT_PATH/Kora.ipa"

      - name: Upload IPA
        uses: actions/upload-artifact@v4
        with:
          name: Kora-AdHoc-IPA
          path: build/ipa/Kora.ipa

      - name: Deploy to Workers (optional)
        if: always()
        run: |
          ls -la build/ipa/
```

**Step 2:** Add secrets to GitHub → Settings → Secrets and variables → Actions.

**Step 3:** Run the workflow manually.

---

## Task 6: Host IPA for direct install

**Objective:** Serve the `.ipa` so Safari can install it.

**Files:** `public/manifest.plist` (new)

**Step 1:** Create `public/manifest.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>https://kora.chaoticstudio.workers.dev/downloads/Kora.ipa</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>app.kora.reader</string>
        <key>bundle-version</key><string>1.0.0</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>Kora</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
```

**Step 2:** Deploy the IPA to `https://kora.chaoticstudio.workers.dev/downloads/Kora.ipa` (via `wrangler deploy` or R2).

**Step 3:** Add install link to `InstallView.tsx`:
```tsx
<a href="itms-services://?action=download-manifest&url=https://kora.chaoticstudio.workers.dev/manifest.plist" ...>
  Install on iPhone/iPad
</a>
```

---

## Task 7: Verify

**Objective:** Prove install works.

**Step 1:** On a registered iPhone/iPad, open the `itms-services://` link in Safari → "Install" → Kora appears on home screen.

**Step 2:** Launch Kora → confirm library/reader/Feed load (Firestore over https works).

**Step 3:** If install fails, provide AltStore/Sideloadly instructions (same IPA, user's free Apple ID).

---

## Risks / Tradeoffs

- **Build time limits:** GitHub Actions free macOS runner has a 6-hour job limit, but iOS archive can take 15-30 min. Consider upgrading if builds fail.
- **Ad Hoc UDID cap (100/yr).** For open distribution, Enterprise ($299) or TestFlight is preferable.
- **7-day free certs** (AltStore) expire and need re-sign — acceptable for personal use only.
- **Capacitor iOS plugin parity** — verify all used plugins have iOS support via `npx cap doctor`.

---

## Open questions for Luyu

1. **Do you have a paid Apple Developer account?** (required for Ad Hoc/Enterprise signing)
2. **Real-device UDIDs** of target testers? (for Ad Hoc profile)
3. **Prefer TestFlight** (simplest, needs App Store Connect upload) over raw `.ipa` hosting?
4. **Want the signing workflow now**, or should I wait for you to provide the Apple credentials?
5. **Should I add the `manifest.plist` and install link to `InstallView.tsx`**, or wait for you to review the iOS card UI first?

---

## Next Steps

1. **Add Capacitor iOS** locally: `npm install @capacitor/ios && npx cap add ios`
2. **Run the iOS build workflow**:
   - Go to GitHub Actions → "iOS Build (.ipa)" → "Run workflow" → "Release"
   - Download the `Kora-iOS-IPA` artifact
3. **For Ad Hoc distribution**:
   - Add secrets to the repo (Settings → Secrets)
   - Run `.github/workflows/ios-sign.yml` → download `Kora-AdHoc-IPA`
4. **Deploy IPA to Workers**:
   - Upload to `https://kora.chaoticstudio.workers.dev/downloads/Kora.ipa`
   - Create `public/manifest.plist` with the install manifest
5. **Add install UI** to `InstallView.tsx` with the `itms-services://` link

> **⚠️ Note:** The `ios-sign.yml` workflow uses automatic provisioning updates (`allowProvisioningUpdates`). For strict Ad Hoc, you may want to remove that and rely purely on your stored provisioning profile.