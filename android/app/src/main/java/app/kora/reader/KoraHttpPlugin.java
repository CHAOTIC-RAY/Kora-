package app.kora.reader;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Native HTTP bridge for Kora.
 *
 * Android WebView (Chromium 128+) refuses cross-origin requests that originate
 * from the secure {@code https://localhost} origin to external HTTPS hosts —
 * exactly the scenario the Capacitor dev server / APK WebAsset path triggers.
 * That surfaces as {@code TypeError: Failed to fetch} in the JS console.
 *
 * This plugin performs the HTTP request with the platform {@link
 * HttpURLConnection} stack (not the WebView) and hands the result back to JS,
 * sidestepping the localhost exception entirely. It also avoids any dependency
 * on OkHttp (which Capacitor bundles internally at an uncertain version) by
 * using only the Android SDK.
 */
@CapacitorPlugin(name = "KoraHttp")
public class KoraHttpPlugin extends Plugin {
  private final ExecutorService executor = Executors.newCachedThreadPool();
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  /**
   * Perform an HTTP request. Options: { method, url, headers?, body? }.
   * The URL must already be absolute (callers resolve /api/* against the
   * worker origin on the JS side). Returns { status, statusText, headers, body }.
   *
   * {@code call.setKeepAlive(true)} keeps the call alive across the async
   * network round-trip so Capacitor does not GC the bridge callback.
   */
  @PluginMethod
  public void request(PluginCall call) {
    String method = call.getString("method", "GET");
    String url = call.getString("url");
    if (url == null || url.trim().isEmpty()) {
      call.reject("Missing url");
      return;
    }

    JSObject headersObj = call.getObject("headers");
    String body = call.getString("body");

    call.setKeepAlive(true);

    final String finalMethod = method.toUpperCase();
    final String finalUrl = url;
    final JSObject finalHeaders = headersObj != null ? headersObj : new JSObject();
    final String finalBody = body;

    executor.execute(
        () -> {
          HttpURLConnection conn = null;
          try {
            URL u = new URL(finalUrl);
            conn = (HttpURLConnection) u.openConnection();

            // PATCH is not a legal HttpURLConnection method; tunnel it as POST
            // with a method override header to match the worker's routing.
            String httpMethod = finalMethod.equals("PATCH") ? "POST" : finalMethod;
            conn.setRequestMethod(httpMethod);
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            if (finalMethod.equals("PATCH")) {
              conn.setRequestProperty("X-HTTP-Method-Override", "PATCH");
            }

            // Apply caller headers. JSObject extends JSONObject (no HashMap
            // entrySet), so iterate via keys().
            java.util.Iterator<String> keys = finalHeaders.keys();
            while (keys.hasNext()) {
              String key = keys.next();
              Object val = finalHeaders.opt(key);
              if (val == null || JSONObject.NULL.equals(val)) continue;
              conn.setRequestProperty(key, val.toString());
            }

            boolean hasBody = finalBody != null
                && (finalMethod.equals("POST")
                    || finalMethod.equals("PUT")
                    || finalMethod.equals("PATCH"));

            // Write request body for POST/PUT/PATCH.
            if (hasBody) {
              byte[] payload = finalBody.getBytes("UTF-8");
              conn.setFixedLengthStreamingMode(payload.length);
              conn.setDoOutput(true);
              OutputStream os = conn.getOutputStream();
              os.write(payload);
              os.flush();
              os.close();
            }

            int status = conn.getResponseCode();
            String statusText = conn.getResponseMessage();

            // Read the body (error stream on failure).
            InputStream is;
            try {
              is = conn.getInputStream();
            } catch (IOException e) {
              is = conn.getErrorStream();
            }
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            if (is != null) {
              byte[] buf = new byte[8 * 1024];
              int n;
              while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
              }
              is.close();
            }
            String responseBody = baos.toString("UTF-8");

            JSObject ret = new JSObject();
            ret.put("status", status);
            ret.put("statusText", statusText != null ? statusText : "");
            ret.put("body", responseBody);

            // Echo back response headers (lowercased keys).
            JSObject respHeaders = new JSObject();
            java.util.Map<String, java.util.List<String>> hdrs = conn.getHeaderFields();
            for (java.util.Map.Entry<String, java.util.List<String>> entry : hdrs.entrySet()) {
              String key = entry.getKey();
              if (key == null) continue;
              java.util.List<String> vals = entry.getValue();
              String joined = "";
              if (vals != null && !vals.isEmpty()) {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < vals.size(); i++) {
                  if (i > 0) sb.append(", ");
                  sb.append(vals.get(i));
                }
                joined = sb.toString();
              }
              respHeaders.put(key.toLowerCase(), joined);
            }
            ret.put("headers", respHeaders);

            resolveOnMain(call, ret);
          } catch (Exception e) {
            rejectOnMain(call, "Network error: " + e.getMessage());
          } finally {
            if (conn != null) conn.disconnect();
          }
        });
  }

  private void resolveOnMain(PluginCall call, JSObject ret) {
    mainHandler.post(() -> call.resolve(ret));
  }

  private void rejectOnMain(PluginCall call, String message) {
    mainHandler.post(() -> call.reject(message));
  }
}
