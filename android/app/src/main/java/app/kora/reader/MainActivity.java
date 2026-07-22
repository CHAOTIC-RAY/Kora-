package app.kora.reader;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import app.kora.reader.widgets.BriefWidgetProvider;
import app.kora.reader.widgets.ContinueWidgetProvider;
import app.kora.reader.widgets.KoraWidgetsPlugin;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

/**
 * Main Capacitor activity.
 * Installs the Android 12+ splash screen before super.onCreate so the system
 * never falls back to a white Capacitor default.
 */
public class MainActivity extends BridgeActivity {
  private static final int KORA_SURFACE = Color.parseColor("#18181B");

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // MUST run before super.onCreate — keeps the themed splash until WebView is ready.
    SplashScreen.installSplashScreen(this);

    registerPlugin(KoraWidgetsPlugin.class);
    registerPlugin(ApkInstallPlugin.class);
    super.onCreate(savedInstanceState);
    applyDarkSystemBars();
    enableHomeScreenWidgets();
    handleWidgetDeepLink(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleWidgetDeepLink(intent);
  }

  /** Ensure widget providers stay enabled so OEMs list them in the picker. */
  private void enableHomeScreenWidgets() {
    try {
      PackageManager pm = getPackageManager();
      if (pm == null) return;
      ComponentName[] widgets =
          new ComponentName[] {
            new ComponentName(this, ContinueWidgetProvider.class),
            new ComponentName(this, BriefWidgetProvider.class),
          };
      for (ComponentName widget : widgets) {
        pm.setComponentEnabledSetting(
            widget,
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP);
      }
    } catch (Exception ignored) {
      /* ignore */
    }
  }

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
