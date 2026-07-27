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

## Task 1: Add Capacitor iOS dependency
**Objective:** Install the iOS platform package so `npx cap add ios` works.

**Files:** `package.json` (devDependencies)

**Step 1:** Add the dependency (run on the machine that will build — macOS, or locally to record it):
```bash
npm install @capacitor/ios@^8.4.2 --save-dev
```
**Step 2:** Verify it appears in `package.json` under `devDependencies`.
**Step 3:** Commit.

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
Keep `server.androidScheme: "https"` and the `allowNavigation` list (WebSocket/Firestore hosts must be reachable — they are via https).
**Step 2:** Run `npx cap sync ios` on macOS to generate the `ios/` Xcode project.
**Step 3:** Commit the generated `ios/` folder (it's needed for builds; add `ios/App/Pods` to `.gitignore` if present).

## Task 3: Build web assets
**Objective:** Produce the `dist/` that Capacitor copies into the iOS bundle.

**Files:** `dist/` (built)

**Step 1:** `npm run build` (already verified green, 209.3kb).
**Step 2:** `npx cap copy ios` to push `dist` into the native project (macOS).

## Task 4: iOS signing — Ad Hoc provisioning profile  ⚠️ macOS
**Objective:** Create a signed archive for real devices.

**Prereqs:** Apple Developer account; registered device UDIDs.

**Step 1:** In Apple Developer portal → Certificates → create an **iOS Distribution** cert; download + install in Keychain.
**Step 2:** Identifiers → App ID `app.kora.reader` (matches `capacitor.config.ts` `appId`).
**Step 3:** Devices → register each iPhone/iPad UDID.
**Step 4:** Profiles → **Ad Hoc** provisioning profile for `app.kora.reader` including those devices; download `Kora_Distribution.mobileprovision`.
**Step 5:** In Xcode (open `ios/App/App.xcworkspace`): Signing & Capabilities → select your Team, set Provisioning Profile = the Ad Hoc one, Bundle Identifier = `app.kora.reader`.

## Task 5: Archive + export .ipa  ⚠️ macOS
**Objective:** Produce the installable `.ipa`.

**Step 1:** Clean build:
```bash
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination generic/platform=iOS \
  -archivePath build/Kora.xcarchive \
  archive
```
**Step 2:** Export with an options plist:
```bash
xcodebuild -exportArchive \
  -archivePath build/Kora.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/ipa
```
`ExportOptions.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<dict>
  <key>method</key> <string>ad-hoc</string>
  <key>signingStyle</key> <string>manual</string>
  <key>provisioningProfiles</key>
  <dict><key>app.kora.reader</key><string>Kora AdHoc Profile</string></dict>
  <key>teamID</key><string>YOUR_TEAM_ID</string>
</dict>
```
**Step 3:** Confirm `build/ipa/App.ipa` exists (~20–40 MB).

## Task 6: Host for direct install (itms-services)
**Objective:** Let users tap a link in Safari to install.

**Files:** `public/manifest.plist` (new), update `InstallView.tsx` iOS card.

**Step 1:** Create `public/manifest.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict><key>kind</key><string>software-package</string>
              <key>url</key><string>https://kora.chaoticstudio.workers.dev/downloads/Kora.ipa</string></dict>
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
```
**Step 2:** Upload `App.ipa` to `public/downloads/Kora.ipa` (via `wrangler put` or the Pages dashboard) so `https://kora.chaoticstudio.workers.dev/downloads/Kora.ipa` is reachable over **https**.
**Step 3:** Install link: `itms-services://?action=download-manifest&url=https://kora.chaoticstudio.workers.dev/manifest.plist` — must be opened in **Safari** on the device. Add this to `InstallView.tsx` next to the Android APK button.
**Step 4:** Also document the **AltStore/Sideloadly** path (user sideloads the same `.ipa` with their own free Apple ID, 7-day cert) for users not in your UDID list.

## Task 7: Verify
**Objective:** Prove install works.

**Step 1:** On a registered iPhone, open the `itms-services://` link in Safari → "Install" → Kora appears on home screen.
**Step 2:** Launch Kora → confirm library/reader/Feed load (Firestore over https works).
**Step 3:** If install is blocked, fall back to AltStore/Sideloadly with the same `.ipa`.

---

## Risks / Tradeoffs
- **No Windows build.** Steps 4–5 require macOS or a GitHub Actions macOS runner (free tier: 7 min build limit may be too short; consider a paid runner or local Mac).
- **Ad Hoc UDID cap (100/yr).** For open distribution, Enterprise ($299) or TestFlight (public link, 90-day, up to 10k testers) is preferable. TestFlight is the *easiest* "direct" path but requires email/App Store Connect upload.
- **7-day free certs** (AltStore) expire and need re-sign — acceptable for personal use only.
- **Capacitor iOS may need plugin parity** — verify all used plugins (`@capacitor/*`, any custom) have iOS support; none Android-only are assumed, but confirm `npx cap doctor` passes.

## Open questions for Luyu
- Do you have a **paid** Apple Developer account? (required for Ad Hoc/Enterprise)
- Real-device **UDIDs** of target testers? (for Ad Hoc profile)
- Prefer **TestFlight** (simplest, needs App Store Connect) over raw `.ipa` hosting?
- Do you have a **macOS** build machine, or should I scaffold a GitHub Actions workflow (needs paid runner due to build time)?
