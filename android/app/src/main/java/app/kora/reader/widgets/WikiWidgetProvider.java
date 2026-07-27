package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;

/**
 * "Wiki of the Hour" home-screen widget — mirrors the Lounge Wiki widget:
 * lead article title, description, extract, and a Read-in-Hub action.
 */
public class WikiWidgetProvider extends AppWidgetProvider {
  private static final int MAX_EXTRACT = 180;

  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    updateAll(context, appWidgetManager, appWidgetIds);
  }

  static void updateAll(Context context, AppWidgetManager manager, int[] appWidgetIds) {
    for (int id : appWidgetIds) {
      manager.updateAppWidget(id, buildViews(context));
    }
  }

  static void refresh(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, WikiWidgetProvider.class));
    if (ids.length > 0) updateAll(context, manager, ids);
  }

  static RemoteViews buildViews(Context context) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_wiki);
    JSONObject article = WidgetDataStore.getWiki(context);

    views.setTextViewText(R.id.widget_wiki_eyebrow, "WIKI OF THE HOUR");

    if (article == null || article.optString("title", "").trim().isEmpty()) {
      views.setTextViewText(R.id.widget_wiki_title, "No article loaded yet");
      views.setTextViewText(
          R.id.widget_wiki_extract, "Open Kora and visit the Lounge to refresh this widget.");
      views.setViewVisibility(R.id.widget_wiki_desc, View.GONE);
      views.setViewVisibility(R.id.widget_wiki_thumb, View.GONE);
      views.setOnClickPendingIntent(
          R.id.widget_wiki_root, WidgetIntents.openApp(context, 1050, "go=lounge&wiki=1"));
      return views;
    }

    String title = article.optString("title", "");
    String desc = article.optString("description", "");
    String extract = article.optString("extract", "");
    if (extract.length() > MAX_EXTRACT) {
      extract = extract.substring(0, MAX_EXTRACT).trim() + "…";
    }
    String thumbKey = article.optString("thumbnailKey", "");
    String thumbUrl = article.optString("thumbnailUrl", "");

    views.setTextViewText(R.id.widget_wiki_title, title);
    views.setTextViewText(R.id.widget_wiki_extract, extract);
    if (desc.isEmpty()) {
      views.setViewVisibility(R.id.widget_wiki_desc, View.GONE);
    } else {
      views.setViewVisibility(R.id.widget_wiki_desc, View.VISIBLE);
      views.setTextViewText(R.id.widget_wiki_desc, desc.toUpperCase());
    }

    // Thumbnail (reuse the cover cache / downloader)
    if (!thumbKey.isEmpty() && !thumbUrl.isEmpty()) {
      android.graphics.Bitmap bmp = WidgetCoverHelper.loadCached(context, thumbKey);
      if (bmp != null) {
        views.setViewVisibility(R.id.widget_wiki_thumb, View.VISIBLE);
        views.setImageViewBitmap(R.id.widget_wiki_thumb, bmp);
      } else {
        views.setViewVisibility(R.id.widget_wiki_thumb, View.GONE);
        final String fKey = thumbKey;
        final String fUrl = thumbUrl;
        new Thread(() -> {
          boolean ok = WidgetCoverHelper.downloadToCache(context, fKey, fUrl);
          if (ok) refresh(context);
        }).start();
      }
    } else {
      views.setViewVisibility(R.id.widget_wiki_thumb, View.GONE);
    }

    views.setOnClickPendingIntent(
        R.id.widget_wiki_root, WidgetIntents.openApp(context, 1050, "go=lounge&wiki=1"));
    views.setOnClickPendingIntent(
        R.id.widget_wiki_read,
        WidgetIntents.openApp(context, 1051, "go=wiki&title=" + Uri.encode(title)));
    return views;
  }
}
