package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;
import org.json.JSONObject;

/** Medium "Continue reading" home-screen widget with cover art. */
public class ContinueWidgetProvider extends AppWidgetProvider {
  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    updateAll(context, appWidgetManager, appWidgetIds);
  }

  static void updateAll(Context context, AppWidgetManager manager, int[] appWidgetIds) {
    for (int id : appWidgetIds) {
      manager.updateAppWidget(id, buildViews(context));
    }
  }

  static RemoteViews buildViews(Context context) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_continue);
    JSONObject payload = WidgetDataStore.getContinue(context);

    String title = payload == null ? null : payload.optString("title", null);
    String author = payload == null ? "" : payload.optString("author", "");
    int percent = payload == null ? 0 : (int) Math.round(payload.optDouble("percent", 0));
    String kind = payload == null ? "book" : payload.optString("kind", "book");
    boolean isAudio = "audio".equalsIgnoreCase(kind);

    if (title == null || title.trim().isEmpty()) {
      views.setTextViewText(R.id.widget_continue_eyebrow, "KORA");
      views.setTextViewText(R.id.widget_continue_title, "Open Kora to start reading");
      views.setTextViewText(R.id.widget_continue_author, "Your next chapter is waiting");
      views.setTextViewText(R.id.widget_continue_progress, "—");
      views.setTextViewText(R.id.widget_continue_kind, "LIBRARY");
      views.setViewVisibility(R.id.widget_continue_cover, View.GONE);
      views.setViewVisibility(R.id.widget_continue_cover_fallback, View.VISIBLE);
      views.setTextViewText(R.id.widget_continue_cover_fallback, "K");
    } else {
      views.setTextViewText(
          R.id.widget_continue_eyebrow, isAudio ? "CONTINUE LISTENING" : "CONTINUE READING");
      views.setTextViewText(R.id.widget_continue_title, title);
      views.setTextViewText(
          R.id.widget_continue_author,
          author == null || author.isEmpty() ? "Unknown author" : author);
      views.setTextViewText(
          R.id.widget_continue_progress, Math.max(0, Math.min(100, percent)) + "%");
      views.setTextViewText(R.id.widget_continue_kind, isAudio ? "AUDIO" : "BOOK");
      WidgetContinueBinder.bindCover(
          context,
          views,
          payload,
          R.id.widget_continue_cover,
          R.id.widget_continue_cover_fallback,
          isAudio);
    }

    views.setOnClickPendingIntent(
        R.id.widget_continue_root,
        WidgetIntents.openApp(context, 1001, "go=continue"));
    return views;
  }
}
