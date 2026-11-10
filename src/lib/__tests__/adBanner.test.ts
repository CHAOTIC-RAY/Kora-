/**
 * Ad banner config + iframe document (enabled / disabled / failure sizing).
 */
import {
  adSlotDimensions,
  resolveAdBannerConfig,
  resolveZoneKeyForViewport,
  shouldShowAdBanner,
  type AdBannerRuntimeConfig,
} from "../ads/adConfig";
import { buildAdIframeSrcdoc } from "../ads/adIframe";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL ", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const disabledConfig: AdBannerRuntimeConfig = {
  enabled: false,
  provider: "adsterra",
  mobileZoneKey: "",
  desktopZoneKey: "",
  desktopSize: "728x90",
  scriptOrigin: "https://www.highperformanceformat.com",
  allowOnNative: false,
  cspExtraOrigins: [],
};

ok("disabled config does not show ads", !shouldShowAdBanner(disabledConfig));

const enabledNoKeys: AdBannerRuntimeConfig = {
  ...disabledConfig,
  enabled: true,
};
ok("enabled without zone keys does not show", !shouldShowAdBanner(enabledNoKeys));

const placeholderConfig: AdBannerRuntimeConfig = {
  ...enabledNoKeys,
  provider: "placeholder",
};
ok("placeholder provider shows without keys", shouldShowAdBanner(placeholderConfig));
ok("placeholder hidden on native without flag", !shouldShowAdBanner(placeholderConfig, { nativeApp: true }));

const nativeAllowed: AdBannerRuntimeConfig = { ...placeholderConfig, allowOnNative: true };
ok("placeholder shows on native when allowed", shouldShowAdBanner(nativeAllowed, { nativeApp: true }));

ok("mobile slot is 320x50", adSlotDimensions("mobile", "728x90").height === 50);
ok("desktop leaderboard is 728x90", adSlotDimensions("desktop", "728x90").width === 728);
ok("desktop banner is 468x60", adSlotDimensions("desktop", "468x60").width === 468);

ok(
  "mobile zone resolves",
  resolveZoneKeyForViewport({ ...enabledNoKeys, mobileZoneKey: "m1", desktopZoneKey: "d1" }, "mobile") === "m1",
);

const srcdoc = buildAdIframeSrcdoc(placeholderConfig, "mobile", "placeholder");
ok("placeholder srcdoc contains Sponsored", srcdoc.includes("Sponsored"));

const failSrcdoc = buildAdIframeSrcdoc(enabledNoKeys, "mobile", "");
ok("empty zone yields minimal doc", failSrcdoc.length < 120);

// Default build (no VITE_ADS_ENABLED in test env) should be off.
const envConfig = resolveAdBannerConfig();
ok("resolveAdBannerConfig defaults enabled=false", envConfig.enabled === false);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
