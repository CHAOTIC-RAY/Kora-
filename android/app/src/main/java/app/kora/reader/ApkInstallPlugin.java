package app.kora.reader;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sideload APK updates downloaded from GitHub Releases.
 */
@CapacitorPlugin(name = "ApkInstall")
public class ApkInstallPlugin extends Plugin {
  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  @PluginMethod
  public void canInstall(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("allowed", canRequestInstalls());
    call.resolve(ret);
  }

  @PluginMethod
  public void openInstallPermissionSettings(PluginCall call) {
    try {
      Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
      intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("Unable to open install permission settings: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void install(PluginCall call) {
    String path = call.getString("path");
    if (path == null || path.trim().isEmpty()) {
      call.reject("Missing path");
      return;
    }
    try {
      if (!canRequestInstalls()) {
        call.reject("Install unknown apps permission required");
        return;
      }
      File apk = resolveApkFile(path.trim());
      launchInstaller(apk);
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to start APK installer: " + e.getMessage(), e);
    }
  }

  /**
   * Download an APK URL to app cache, emit progress events, then open the installer.
   * Options: { url, fileName? }
   * Progress event: apkDownloadProgress { percent, bytes, total }
   */
  @PluginMethod
  public void downloadAndInstall(PluginCall call) {
    String url = call.getString("url");
    if (url == null || url.trim().isEmpty()) {
      call.reject("Missing url");
      return;
    }
    String fileName = call.getString("fileName", "kora-update.apk");
    if (fileName == null || fileName.trim().isEmpty()) fileName = "kora-update.apk";
    // Sanitize
    fileName = fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
    if (!fileName.toLowerCase().endsWith(".apk")) fileName = fileName + ".apk";

    if (!canRequestInstalls()) {
      call.reject("Install unknown apps permission required");
      return;
    }

    final String downloadUrl = url.trim();
    final String outName = fileName;
    call.setKeepAlive(true);

    executor.execute(
        () -> {
          HttpURLConnection conn = null;
          try {
            File dir = new File(getContext().getCacheDir(), "updates");
            if (!dir.exists() && !dir.mkdirs()) {
              rejectOnMain(call, "Unable to create updates cache");
              return;
            }
            File out = new File(dir, outName);

            URL u = new URL(downloadUrl);
            conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(120000);
            conn.setRequestProperty("User-Agent", "Kora-Android-Updater");
            conn.connect();

            int code = conn.getResponseCode();
            // Follow one more hop manually if needed
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
              String loc = conn.getHeaderField("Location");
              conn.disconnect();
              conn = (HttpURLConnection) new URL(loc).openConnection();
              conn.setInstanceFollowRedirects(true);
              conn.setConnectTimeout(30000);
              conn.setReadTimeout(120000);
              conn.setRequestProperty("User-Agent", "Kora-Android-Updater");
              conn.connect();
              code = conn.getResponseCode();
            }

            if (code < 200 || code >= 300) {
              rejectOnMain(call, "Download failed (HTTP " + code + ")");
              return;
            }

            long total = conn.getContentLengthLong();
            InputStream in = new BufferedInputStream(conn.getInputStream());
            FileOutputStream fos = new FileOutputStream(out);
            byte[] buf = new byte[64 * 1024];
            long readTotal = 0;
            int n;
            int lastPct = -1;
            while ((n = in.read(buf)) != -1) {
              fos.write(buf, 0, n);
              readTotal += n;
              if (total > 0) {
                int pct = (int) Math.min(99, (readTotal * 100) / total);
                if (pct != lastPct) {
                  lastPct = pct;
                  final long bytes = readTotal;
                  final long tot = total;
                  final int percent = pct;
                  bridge
                      .getActivity()
                      .runOnUiThread(
                          () -> {
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            progress.put("bytes", bytes);
                            progress.put("total", tot);
                            notifyListeners("apkDownloadProgress", progress);
                          });
                }
              }
            }
            fos.flush();
            fos.close();
            in.close();

            launchInstaller(out);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("path", out.getAbsolutePath());
            ret.put("bytes", readTotal);
            resolveOnMain(call, ret);
          } catch (Exception e) {
            rejectOnMain(call, "Download/install failed: " + e.getMessage());
          } finally {
            if (conn != null) conn.disconnect();
          }
        });
  }

  private boolean canRequestInstalls() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      PackageManager pm = getContext().getPackageManager();
      return pm != null && pm.canRequestPackageInstalls();
    }
    return true;
  }

  private void launchInstaller(File apk) throws Exception {
    if (apk == null || !apk.exists() || !apk.canRead()) {
      throw new IllegalStateException("APK file not found");
    }
    Uri uri =
        FileProvider.getUriForFile(
            getContext(), getContext().getPackageName() + ".fileprovider", apk);
    Intent intent = new Intent(Intent.ACTION_VIEW);
    intent.setDataAndType(uri, "application/vnd.android.package-archive");
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(intent);
  }

  private File resolveApkFile(String path) {
    try {
      if (path.startsWith("file:")) {
        Uri uri = Uri.parse(path);
        String filePath = uri.getPath();
        return filePath != null ? new File(filePath) : null;
      }
      return new File(path);
    } catch (Exception e) {
      return null;
    }
  }

  private void resolveOnMain(PluginCall call, JSObject ret) {
    bridge.getActivity().runOnUiThread(() -> call.resolve(ret));
  }

  private void rejectOnMain(PluginCall call, String message) {
    bridge.getActivity().runOnUiThread(() -> call.reject(message));
  }
}
