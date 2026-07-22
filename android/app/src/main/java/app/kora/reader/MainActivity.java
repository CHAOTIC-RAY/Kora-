package app.kora.reader;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Main Capacitor activity. Forces a dark system navigation bar so Android's
 * gesture indicator / contrast scrim does not paint a bright white strip under
 * the floating tab bar.
 */
public class MainActivity extends BridgeActivity {
  private static final int KORA_SURFACE = Color.parseColor("#18181B");

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applyDarkSystemBars();
  }

  private void applyDarkSystemBars() {
    Window window = getWindow();
    if (window == null) return;

    window.setStatusBarColor(KORA_SURFACE);
    window.setNavigationBarColor(KORA_SURFACE);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Prevent Android from drawing a translucent light scrim behind the nav bar.
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
      // Dark chrome → light status/nav glyphs (including gesture handle tone).
      controller.setAppearanceLightStatusBars(false);
      controller.setAppearanceLightNavigationBars(false);
    }
  }
}
