# iOS (.ipa) — NOT SUPPORTED

Direct iOS install requires a **paid Apple Developer account** ($99/yr) to sign an
Ad Hoc / Enterprise provisioning profile, plus registering each device UDID.

As of 2026-07-27 the owner has **no Apple Developer account** and does not want
one, so the `.ipa` GitHub Actions workflows (`ios-build.yml`, `ios-sign.yml`)
have been removed.

## What works instead

- **Android APK** — `android-apk.yml` builds + signs + publishes a release APK.
- **Web / PWA** — `kora.chaoticstudio.workers.dev` installs as a standalone
  app on iOS Safari ("Add to Home Screen"), Android Chrome, Windows, macOS,
  and ChromeOS. This is the recommended path for iPhone/iPad users.

If an Apple Developer account is obtained later, the plan + removed workflows are
archived in `.hermes/plans/2026-07-27_1300-ios-ipa-direct-install.md`.
