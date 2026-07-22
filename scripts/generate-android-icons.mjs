#!/usr/bin/env node
/**
 * Generate Android launcher + notification icons from the Kora "K" wordmark.
 * Prefer public/favicon.svg (serif K on dark squircle). Optionally refresh
 * public/icon-512.png so PWA / APK stay aligned.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const resDir = path.join(root, "android/app/src/main/res");

const SOURCE_PNG = path.join(root, "public/icon-512.png");
const SOURCE_SVG = path.join(root, "public/favicon.svg");
// Force K mark: set KORA_ICON_SOURCE=png to use the legacy book icon instead.
const FORCE_PNG = process.env.KORA_ICON_SOURCE === "png";

const DENSITIES = [
  { name: "mdpi", size: 48, fg: 108 },
  { name: "hdpi", size: 72, fg: 162 },
  { name: "xhdpi", size: 96, fg: 216 },
  { name: "xxhdpi", size: 144, fg: 324 },
  { name: "xxxhdpi", size: 192, fg: 432 },
];

async function loadSource() {
  if (!FORCE_PNG && fs.existsSync(SOURCE_SVG)) {
    console.log("icon source → public/favicon.svg (Kora K)");
    return sharp(SOURCE_SVG, { density: 512 }).ensureAlpha();
  }
  if (fs.existsSync(SOURCE_PNG)) {
    console.log("icon source → public/icon-512.png");
    return sharp(SOURCE_PNG).ensureAlpha();
  }
  throw new Error("No icon source found (public/favicon.svg or public/icon-512.png)");
}

async function writePng(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  console.log("wrote", path.relative(root, filePath));
}

async function main() {
  const source = await loadSource();
  const master = await source
    .resize(512, 512, {
      fit: "cover",
      position: "centre",
      background: { r: 15, g: 15, b: 16, alpha: 1 },
    })
    .png()
    .toBuffer();

  // Keep PWA / manifest icon in sync with the APK K mark
  if (!FORCE_PNG && fs.existsSync(SOURCE_SVG)) {
    await writePng(SOURCE_PNG, master);
    const apple = await sharp(master).resize(180, 180).png().toBuffer();
    await writePng(path.join(root, "public/apple-touch-icon.png"), apple);
    const pwa192 = await sharp(master).resize(192, 192).png().toBuffer();
    await writePng(path.join(root, "public/icon-192.png"), pwa192);
  }

  // Full-bleed legacy launchers (square + round mask)
  for (const d of DENSITIES) {
    const dir = path.join(resDir, `mipmap-${d.name}`);
    const square = await sharp(master)
      .resize(d.size, d.size, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();

    await writePng(path.join(dir, "ic_launcher.png"), square);
    await writePng(path.join(dir, "ic_launcher_round.png"), square);

    // Adaptive foreground: logo inset ~12% — K mark already has squircle padding
    const inset = Math.round(d.fg * 0.12);
    const inner = d.fg - inset * 2;
    const logo = await sharp(master)
      .resize(inner, inner, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const foreground = await sharp({
      create: {
        width: d.fg,
        height: d.fg,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: logo, gravity: "centre" }])
      .png()
      .toBuffer();
    await writePng(path.join(dir, "ic_launcher_foreground.png"), foreground);
  }

  // Notification small icon (white silhouette on transparent)
  const notifSizes = [
    { dir: "drawable-mdpi", size: 24 },
    { dir: "drawable-hdpi", size: 36 },
    { dir: "drawable-xhdpi", size: 48 },
    { dir: "drawable-xxhdpi", size: 72 },
    { dir: "drawable-xxxhdpi", size: 96 },
  ];
  for (const n of notifSizes) {
    const mono = await sharp(master)
      .resize(n.size, n.size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = mono;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      // Keep light logo pixels as white; dark bg becomes transparent
      if (a < 16 || lum < 40) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      } else {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
    }
    const out = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
    await writePng(path.join(resDir, n.dir, "ic_stat_kora.png"), out);
  }

  // Splash: dark #18181B canvas with centered K mark (all density / orientation folders)
  const splashBg = { r: 24, g: 24, b: 27, alpha: 1 };
  const splashLogo = await sharp(master)
    .resize(220, 220, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const splashSquare = await sharp({
    create: { width: 512, height: 512, channels: 4, background: splashBg },
  })
    .composite([{ input: splashLogo, gravity: "centre" }])
    .png()
    .toBuffer();
  await writePng(path.join(resDir, "drawable", "splash.png"), splashSquare);
  await writePng(
    path.join(resDir, "drawable", "ic_stat_kora.png"),
    await sharp(master).resize(48, 48).png().toBuffer()
  );

  // Android 12+ Theme.SplashScreen animated icon: cream K on transparent
  // (system masks to circle; never use Capacitor default / adaptive FG here).
  async function makeSplashIcon(size) {
    const logo = await sharp(master)
      .resize(Math.round(size * 0.72), Math.round(size * 0.72), {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = logo;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (a < 16 || lum < 40) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      } else {
        // Match brand cream on the dark splash background
        data[i] = 247;
        data[i + 1] = 243;
        data[i + 2] = 227;
        data[i + 3] = 255;
      }
    }
    const cutout = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: cutout, gravity: "centre" }])
      .png()
      .toBuffer();
  }

  const splashIconSizes = [
    { dir: "drawable", size: 288 },
    { dir: "drawable-mdpi", size: 192 },
    { dir: "drawable-hdpi", size: 288 },
    { dir: "drawable-xhdpi", size: 384 },
    { dir: "drawable-xxhdpi", size: 576 },
    { dir: "drawable-xxxhdpi", size: 768 },
  ];
  for (const s of splashIconSizes) {
    await writePng(
      path.join(resDir, s.dir, "ic_splash_kora.png"),
      await makeSplashIcon(s.size)
    );
  }

  const splashSizes = {
    "drawable-port-mdpi": [320, 480],
    "drawable-port-hdpi": [480, 800],
    "drawable-port-xhdpi": [720, 1280],
    "drawable-port-xxhdpi": [1080, 1920],
    "drawable-port-xxxhdpi": [1440, 2560],
    "drawable-land-mdpi": [480, 320],
    "drawable-land-hdpi": [800, 480],
    "drawable-land-xhdpi": [1280, 720],
    "drawable-land-xxhdpi": [1920, 1080],
    "drawable-land-xxxhdpi": [2560, 1440],
  };
  for (const [dir, [w, h]] of Object.entries(splashSizes)) {
    const logoSize = Math.round(Math.min(w, h) * 0.28);
    const scaled = await sharp(master)
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const buf = await sharp({
      create: { width: w, height: h, channels: 4, background: splashBg },
    })
      .composite([{ input: scaled, gravity: "centre" }])
      .png()
      .toBuffer();
    await writePng(path.join(resDir, dir, "splash.png"), buf);
  }

  // Adaptive background color
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0F0F10</color>
</resources>
`;
  fs.writeFileSync(path.join(resDir, "values/ic_launcher_background.xml"), bgXml);
  console.log("updated values/ic_launcher_background.xml → #0F0F10");

  // Ensure adaptive XML references mipmap foreground
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  fs.mkdirSync(path.join(resDir, "mipmap-anydpi-v26"), { recursive: true });
  fs.writeFileSync(path.join(resDir, "mipmap-anydpi-v26/ic_launcher.xml"), adaptive);
  fs.writeFileSync(path.join(resDir, "mipmap-anydpi-v26/ic_launcher_round.xml"), adaptive);
  console.log("updated adaptive icon XML");
  console.log("Done — Android icons generated from Kora K logo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
