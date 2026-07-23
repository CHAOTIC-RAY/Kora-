package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;
import org.json.JSONObject;

/** Books-only continue widget with cover. */
public class BookContinueWidgetProvider extends AppWidgetProvider {
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
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_book_continue);
    JSONObject payload = WidgetDataStore.getContinueBook(context);

    String title = payload == null ? null : payload.optString("title", null);
    if (title == null || title.trim().isEmpty()) {
      views.setTextViewText(R.id.widget_book_eyebrow, "CONTINUE BOOK");
      views.setTextViewText(R.id.widget_book_title, "No ebook in progress");
      views.setTextViewText(R.id.widget_book_author, "Open a book in Kora");
      views.setTextViewText(R.id.widget_book_progress, "—");
      views.setViewVisibility(R.id.widget_book_cover, View.GONE);
      views.setViewVisibility(R.id.widget_book_cover_fallback, View.VISIBLE);
      views.setTextViewText(R.id.widget_book_cover_fallback, "B");
    } else {
      views.setTextViewText(R.id.widget_book_eyebrow, "CONTINUE BOOK");
      views.setTextViewText(R.id.widget_book_title, title);
      String author = payload.optString("author", "");
      views.setTextViewText(
          R.id.widget_book_author, author.isEmpty() ? "Unknown author" : author);
      int percent = (int) Math.round(payload.optDouble("percent", 0));
      views.setTextViewText(R.id.widget_book_progress, Math.max(0, Math.min(100, percent)) + "%");
      WidgetContinueBinder.bindCover(
          context,
          views,
          payload,
          R.id.widget_book_cover,
          R.id.widget_book_cover_fallback,
          false);
    }

    views.setOnClickPendingIntent(
        R.id.widget_book_root,
        WidgetIntents.openApp(context, 1011, "go=continue&kind=book"));
    return views;
  }
}
