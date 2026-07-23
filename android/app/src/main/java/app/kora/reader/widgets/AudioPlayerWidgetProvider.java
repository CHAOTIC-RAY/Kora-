package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;
import org.json.JSONObject;

/** Audiobook continue widget with cassette cover + play/pause controls. */
public class AudioPlayerWidgetProvider extends AppWidgetProvider {
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
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_audio_player);
    JSONObject payload = WidgetDataStore.getContinueAudio(context);

    String title = payload == null ? null : payload.optString("title", null);
    boolean playing = payload != null && payload.optBoolean("playing", false);

    if (title == null || title.trim().isEmpty()) {
      views.setTextViewText(R.id.widget_audio_eyebrow, "AUDIOBOOK");
      views.setTextViewText(R.id.widget_audio_title, "No audiobook yet");
      views.setTextViewText(R.id.widget_audio_author, "Start one in Kora");
      views.setTextViewText(R.id.widget_audio_progress, "—");
      views.setViewVisibility(R.id.widget_audio_cover, View.GONE);
      views.setViewVisibility(R.id.widget_audio_cover_fallback, View.VISIBLE);
      views.setTextViewText(R.id.widget_audio_cover_fallback, "♪");
    } else {
      views.setTextViewText(
          R.id.widget_audio_eyebrow, playing ? "NOW PLAYING" : "CONTINUE LISTENING");
      views.setTextViewText(R.id.widget_audio_title, title);
      String author = payload.optString("author", "");
      views.setTextViewText(
          R.id.widget_audio_author, author.isEmpty() ? "Unknown author" : author);
      int percent = (int) Math.round(payload.optDouble("percent", 0));
      views.setTextViewText(R.id.widget_audio_progress, Math.max(0, Math.min(100, percent)) + "%");
      WidgetContinueBinder.bindCover(
          context,
          views,
          payload,
          R.id.widget_audio_cover,
          R.id.widget_audio_cover_fallback,
          true);
    }

    views.setOnClickPendingIntent(
        R.id.widget_audio_root,
        WidgetIntents.openApp(context, 1020, "go=continue&kind=audio"));
    views.setOnClickPendingIntent(
        R.id.widget_audio_play,
        WidgetIntents.openApp(context, 1021, "go=continue&kind=audio&action=play"));
    views.setOnClickPendingIntent(
        R.id.widget_audio_pause,
        WidgetIntents.openApp(context, 1022, "go=continue&kind=audio&action=pause"));
    views.setOnClickPendingIntent(
        R.id.widget_audio_open,
        WidgetIntents.openApp(context, 1023, "go=continue&kind=audio"));

    views.setViewVisibility(R.id.widget_audio_play, playing ? View.GONE : View.VISIBLE);
    views.setViewVisibility(R.id.widget_audio_pause, playing ? View.VISIBLE : View.GONE);

    return views;
  }
}
