/**
 * Vite plugin: post-process index.html for the Capacitor APK build.
 *
 * APK white-screen root cause addressed:
 *
 *   Vite hardcodes `crossorigin` on ALL output <script>/<link> tags.
 *   Inside the APK WebView (file:///android_asset/ or https://localhost)
 *   a cross-origin fetch of the stylesheet/script can fail silently on some
 *   Android WebView versions, so the CSS/JS never loads → blank white screen.
 *
 * Fix: strip every `crossorigin` attribute from <script> and <link> tags.
 * We deliberately KEEP the normal <link rel="stylesheet"> and modulepreload
 * tags (just without the crossorigin attr) so CSS still loads via the
 * standard, reliable <link> mechanism — both on the web and inside the APK.
 *
 * NOTE: We do NOT inline the CSS. Inlining dropped the stylesheet entirely in
 * an earlier iteration (inline step silently failed), which is itself a white
 * screen. Keeping the external <link> is the safer, well-tested path.
 */

import type { Plugin } from 'vite';

export default function apkHtmlPlugin(): Plugin {
  return {
    name: 'vite:apk-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        // Remove the `crossorigin` attribute from every tag that has it.
        // Matches: crossorigin, crossorigin="anonymous", crossorigin="use-credentials"
        return html.replace(/\s+crossorigin(?:=["'][^"']*["'])?/gi, '');
      },
    },
  } as Plugin;
}
