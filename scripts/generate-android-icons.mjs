#!/usr/bin/env node
/**
 * Generate Android launcher + notification icons from the Kora logo.
 * Source: public/icon-512.png (preferred) or public/favicon.svg via sharp.
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

const DENSITIES = [
  { name: "mdpi", size: 48, fg: 108 },
  { name: "hdpi", size: 72, fg: 162 },
  { name: "xhdpi", size: 96, fg: 216 },
  { name: "xxhdpi", size: 144, fg: 324 },
  { name: "xxxhdpi", size: 192, fg: 432 },
];

const BG = { r: 15, g: 15, b: 16, alpha: 1 }; // #0F0F10

async function loadSource() {
  if (fs.existsSync(SOURCE_PNG)) {
    return sharp(SOURCE_PNG).ensureAlpha();
  }
  if (fs.existsSync(SOURCE_SVG)) {
    return sharp(SOURCE_SVG, { density: 384 }).ensureAlpha();
  }
  throw new Error("No icon source found (public/icon-512.png or public/favicon.svg)");
}

async function writePng(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  console.log("wrote", path.relative(root, filePath));
}

async function main() {
  const source = await loadSource();
  const master = await source.png().toBuffer();

  // Full-bleed legacy launchers (square + round mask)
  for (const d of DENSITIES) {
    const dir = path.join(resDir, `mipmap-${d.name}`);
    const square = await sharp(master)
      .resize(d.size, d.size, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();

    await writePng(path.join(dir, "ic_launcher.png"), square);
    await writePng(path.join(dir, "ic_launcher_round.png"), square);

    // Adaptive foreground: logo inset ~18% safe zone on transparent canvas
    const inset = Math.round(d.fg * 0.18);
    const inner = d.fg - inset * 2;
    const logo = await sharp(master)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
      .resize(n.size, n.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
    const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
    await writePng(path.join(resDir, n.dir, "ic_stat_kora.png"), out);
  }

  // Splash-friendly full logo
  const splash = await sharp(master)
    .resize(512, 512, { fit: "cover" })
    .png()
    .toBuffer();
  await writePng(path.join(resDir, "drawable", "splash.png"), splash);

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
  console.log("Done — Android icons generated from Kora logo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
