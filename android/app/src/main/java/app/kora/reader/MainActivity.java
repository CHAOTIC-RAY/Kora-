package app.kora.reader;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import app.kora.reader.widgets.KoraWidgetsPlugin;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

/**
 * Main Capacitor activity. Forces a dark system navigation bar so Android's
 * gesture indicator / contrast scrim does not paint a bright white strip under
 * the floating tab bar. Registers the home-screen widgets plugin.
 */
public class MainActivity extends BridgeActivity {
  private static final int KORA_SURFACE = Color.parseColor("#18181B");

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(KoraWidgetsPlugin.class);
    super.onCreate(savedInstanceState);
    applyDarkSystemBars();
    // Cold start: Capacitor loads the intent URL; also notify SPA for query routing.
    handleWidgetDeepLink(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleWidgetDeepLink(intent);
  }

  /**
   * Widget / shortcut VIEW intents → dispatch kora-deeplink so the SPA can route
   * without a full WebView reload (works for warm starts with singleTask).
   */
  private void handleWidgetDeepLink(Intent intent) {
    if (intent == null) return;
    Uri data = intent.getData();
    if (data == null) return;
    if (!"https".equalsIgnoreCase(data.getScheme())) return;
    if (!"localhost".equalsIgnoreCase(data.getHost())) return;

    String query = data.getEncodedQuery();
    if (query == null || query.isEmpty()) return;
    if (!query.contains("go=") && !query.contains("briefs=")) return;

    final String href = "/?" + query;
    try {
      if (getBridge() == null || getBridge().getWebView() == null) return;
      final String js =
          "(function(){try{window.dispatchEvent(new CustomEvent('kora-deeplink',{detail:{href:"
              + JSONObject.quote(href)
              + "}}));}catch(e){}})();";
      getBridge()
          .getWebView()
          .postDelayed(
              () -> {
                try {
                  getBridge().getWebView().evaluateJavascript(js, null);
                } catch (Exception ignored) {
                  /* bridge may not be ready */
                }
              },
              400);
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  private void applyDarkSystemBars() {
    Window window = getWindow();
    if (window == null) return;

    window.setStatusBarColor(KORA_SURFACE);
    window.setNavigationBarColor(KORA_SURFACE);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.setNavigationBarContrastEnforced(false);
      window.setStatusBarContrastEnforced(false);
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.setNavigationBarDividerColor(Color.TRANSPARENT);
    }

    WindowCompat.setDecorFitsSystemWindows(window, true);
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(window, window.getDecorView());
    if (controller != null) {
      controller.setAppearanceLightStatusBars(false);
      controller.setAppearanceLightNavigationBars(false);
    }
  }
}
