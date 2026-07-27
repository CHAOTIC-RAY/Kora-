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
    refreshProvider(context, manager, ContinueWidgetProvider.class);
    refreshProvider(context, manager, BriefWidgetProvider.class);
    refreshProvider(context, manager, BookContinueWidgetProvider.class);
    refreshProvider(context, manager, AudioPlayerWidgetProvider.class);
    refreshProvider(context, manager, MiniGameWidgetProvider.class);
    refreshProvider(context, manager, WikiWidgetProvider.class);
    refreshProvider(context, manager, GuidesWidgetProvider.class);
    refreshProvider(context, manager, NotesWidgetProvider.class);
  }

  private static void refreshProvider(
      Context context, AppWidgetManager manager, Class<?> providerClass) {
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, providerClass));
    if (ids.length == 0) return;
    try {
      if (providerClass == ContinueWidgetProvider.class) {
        ContinueWidgetProvider.updateAll(context, manager, ids);
      } else if (providerClass == BriefWidgetProvider.class) {
        BriefWidgetProvider.updateAll(context, manager, ids);
      } else if (providerClass == BookContinueWidgetProvider.class) {
        BookContinueWidgetProvider.updateAll(context, manager, ids);
      } else if (providerClass == AudioPlayerWidgetProvider.class) {
        AudioPlayerWidgetProvider.updateAll(context, manager, ids);
      } else if (providerClass == MiniGameWidgetProvider.class) {
        MiniGameWidgetProvider.updateAll(context, manager, ids);
      } else if (providerClass == WikiWidgetProvider.class) {
        WikiWidgetProvider.updateAll(context, manager, ids);
      } else if (providerClass == GuidesWidgetProvider.class) {
        GuidesWidgetProvider.updateAll(context, manager, ids);
      } else if (providerClass == NotesWidgetProvider.class) {
        NotesWidgetProvider.updateAll(context, manager, ids);
      }
    } catch (Exception ignored) {
      /* provider may not be registered yet during upgrade */
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
    Class<?> provider = ContinueWidgetProvider.class;
    if ("brief".equalsIgnoreCase(which)) {
      provider = BriefWidgetProvider.class;
    } else if ("book".equalsIgnoreCase(which) || "continue-book".equalsIgnoreCase(which)) {
      provider = BookContinueWidgetProvider.class;
    } else if ("audio".equalsIgnoreCase(which) || "continue-audio".equalsIgnoreCase(which)) {
      provider = AudioPlayerWidgetProvider.class;
    } else if ("game".equalsIgnoreCase(which) || "minigame".equalsIgnoreCase(which)) {
      provider = MiniGameWidgetProvider.class;
    } else if ("wiki".equalsIgnoreCase(which) || "wiki-of-the-hour".equalsIgnoreCase(which)) {
      provider = WikiWidgetProvider.class;
    } else if ("guides".equalsIgnoreCase(which)) {
      provider = GuidesWidgetProvider.class;
    } else if ("notes".equalsIgnoreCase(which) || "annotations".equalsIgnoreCase(which)) {
      provider = NotesWidgetProvider.class;
    }
    ComponentName name = new ComponentName(context, provider);
    return manager.requestPinAppWidget(name, null, null);
  }
}
