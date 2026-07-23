package app.kora.reader.widgets;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Download + cache cover bitmaps for home-screen widgets. */
public final class WidgetCoverHelper {
  private static final String TAG = "KoraWidgetCover";
  private static final int MAX_EDGE = 256;

  private WidgetCoverHelper() {}

  public static File coverDir(Context context) {
    File dir = new File(context.getCacheDir(), "widget_covers");
    if (!dir.exists()) dir.mkdirs();
    return dir;
  }

  public static File coverFile(Context context, String key) {
    String safe = key == null ? "cover" : key.replaceAll("[^a-zA-Z0-9._-]", "_");
    if (safe.length() > 48) safe = safe.substring(0, 48);
    return new File(coverDir(context), safe + ".jpg");
  }

  public static Bitmap loadCached(Context context, String key) {
    File f = coverFile(context, key);
    if (!f.exists() || f.length() == 0) return null;
    try {
      BitmapFactory.Options opts = new BitmapFactory.Options();
      opts.inPreferredConfig = Bitmap.Config.RGB_565;
      return BitmapFactory.decodeFile(f.getAbsolutePath(), opts);
    } catch (Exception e) {
      return null;
    }
  }

  /** Blocking download — call from a background thread. */
  public static boolean downloadToCache(Context context, String key, String url) {
    if (url == null || url.trim().isEmpty() || key == null) return false;
    String resolved = url.trim();
    if (resolved.startsWith("/")) return false;
    if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) return false;

    File out = coverFile(context, key);
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(resolved).openConnection();
      conn.setConnectTimeout(8000);
      conn.setReadTimeout(12000);
      conn.setInstanceFollowRedirects(true);
      conn.setRequestProperty(
          "User-Agent",
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36");
      int code = conn.getResponseCode();
      if (code < 200 || code >= 300) return false;

      InputStream in = conn.getInputStream();
      BitmapFactory.Options decode = new BitmapFactory.Options();
      decode.inPreferredConfig = Bitmap.Config.RGB_565;
      Bitmap raw = BitmapFactory.decodeStream(in, null, decode);
      in.close();
      if (raw == null) return false;

      Bitmap scaled = scaleDown(raw, MAX_EDGE);
      if (scaled != raw) raw.recycle();

      FileOutputStream fos = new FileOutputStream(out);
      scaled.compress(Bitmap.CompressFormat.JPEG, 85, fos);
      fos.close();
      scaled.recycle();
      return true;
    } catch (Exception e) {
      Log.w(TAG, "cover download failed: " + e.getMessage());
      return false;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private static Bitmap scaleDown(Bitmap src, int maxEdge) {
    int w = src.getWidth();
    int h = src.getHeight();
    int edge = Math.max(w, h);
    if (edge <= maxEdge) return src;
    float scale = maxEdge / (float) edge;
    int nw = Math.max(1, Math.round(w * scale));
    int nh = Math.max(1, Math.round(h * scale));
    return Bitmap.createScaledBitmap(src, nw, nh, true);
  }
}
