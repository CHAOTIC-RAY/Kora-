package app.kora.reader.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import app.kora.reader.MainActivity;

/** Shared helpers for Kora home-screen widgets. */
public final class WidgetIntents {
  private WidgetIntents() {}

  public static PendingIntent openApp(Context context, int requestCode, String goQuery) {
    Intent intent = new Intent(context, MainActivity.class);
    intent.setAction(Intent.ACTION_VIEW);
    intent.setData(Uri.parse("https://localhost/?" + goQuery + "&source=widget"));
    intent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getActivity(context, requestCode, intent, flags);
  }

  public static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] continueIds =
        manager.getAppWidgetIds(new ComponentName(context, ContinueWidgetProvider.class));
    if (continueIds.length > 0) {
      ContinueWidgetProvider.updateAll(context, manager, continueIds);
    }
    int[] briefIds =
        manager.getAppWidgetIds(new ComponentName(context, BriefWidgetProvider.class));
    if (briefIds.length > 0) {
      BriefWidgetProvider.updateAll(context, manager, briefIds);
    }
  }

  /** Returns true if the pin request was accepted by the launcher. */
  public static boolean requestPin(Context context, String which) {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) {
      return false;
    }
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    if (manager == null || !manager.isRequestPinAppWidgetSupported()) {
      return false;
    }
    Class<?> provider =
        "brief".equalsIgnoreCase(which)
            ? BriefWidgetProvider.class
            : ContinueWidgetProvider.class;
    ComponentName name = new ComponentName(context, provider);
    return manager.requestPinAppWidget(name, null, null);
  }
}
