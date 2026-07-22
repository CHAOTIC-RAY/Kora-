package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;
import app.kora.reader.R;

/** Medium "Continue reading" home-screen widget. */
public class ContinueWidgetProvider extends AppWidgetProvider {
  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    updateAll(context, appWidgetManager, appWidgetIds);
  }

  @Override
  public void onEnabled(Context context) {
    // no-op — data is pushed from the WebView via KoraWidgetsPlugin
  }

  static void updateAll(Context context, AppWidgetManager manager, int[] appWidgetIds) {
    for (int id : appWidgetIds) {
      manager.updateAppWidget(id, buildViews(context));
    }
  }

  static RemoteViews buildViews(Context context) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_continue);

    String title = WidgetDataStore.continueTitle(context);
    String author = WidgetDataStore.continueAuthor(context);
    int percent = WidgetDataStore.continuePercent(context);
    String kind = WidgetDataStore.continueKind(context);
    boolean isAudio = "audio".equalsIgnoreCase(kind);

    if (title == null || title.trim().isEmpty()) {
      views.setTextViewText(R.id.widget_continue_eyebrow, "KORA");
      views.setTextViewText(R.id.widget_continue_title, "Open Kora to start reading");
      views.setTextViewText(R.id.widget_continue_author, "Your next chapter is waiting");
      views.setTextViewText(R.id.widget_continue_progress, "—");
      views.setTextViewText(R.id.widget_continue_kind, "LIBRARY");
    } else {
      views.setTextViewText(R.id.widget_continue_eyebrow, isAudio ? "CONTINUE LISTENING" : "CONTINUE READING");
      views.setTextViewText(R.id.widget_continue_title, title);
      views.setTextViewText(
          R.id.widget_continue_author,
          author == null || author.isEmpty() ? "Unknown author" : author);
      views.setTextViewText(
          R.id.widget_continue_progress,
          Math.max(0, Math.min(100, percent)) + "%");
      views.setTextViewText(R.id.widget_continue_kind, isAudio ? "AUDIO" : "BOOK");
    }

    views.setOnClickPendingIntent(
        R.id.widget_continue_root,
        WidgetIntents.openApp(context, 1001, "go=continue"));
    return views;
  }
}
