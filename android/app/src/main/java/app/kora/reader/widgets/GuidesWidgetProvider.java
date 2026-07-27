package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Lounge "Guides" home-screen widget — mirrors the Lounge Guides list
 * (up to 3 guide tiles, each opens its tour in-app).
 */
public class GuidesWidgetProvider extends AppWidgetProvider {
  private static final int[] TITLE_IDS = {
    R.id.widget_guides_title0,
    R.id.widget_guides_title1,
    R.id.widget_guides_title2
  };
  private static final int[] ROW_IDS = {
    R.id.widget_guides_row0,
    R.id.widget_guides_row1,
    R.id.widget_guides_row2
  };

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
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, GuidesWidgetProvider.class));
    if (ids.length > 0) updateAll(context, manager, ids);
  }

  static RemoteViews buildViews(Context context) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_guides);
    JSONObject payload = WidgetDataStore.getGuides(context);
    JSONArray guides = payload != null ? payload.optJSONArray("guides") : null;

    views.setTextViewText(R.id.widget_guides_eyebrow, "GUIDES");

    if (guides == null || guides.length() == 0) {
      views.setViewVisibility(R.id.widget_guides_list, View.GONE);
      views.setViewVisibility(R.id.widget_guides_empty, View.VISIBLE);
    } else {
      views.setViewVisibility(R.id.widget_guides_list, View.VISIBLE);
      views.setViewVisibility(R.id.widget_guides_empty, View.GONE);
      int n = Math.min(guides.length(), TITLE_IDS.length);
      for (int i = 0; i < TITLE_IDS.length; i++) {
        if (i < n) {
          JSONObject g = guides.optJSONObject(i);
          String title = g != null ? g.optString("title", "") : "";
          views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
          views.setTextViewText(TITLE_IDS[i], title);
          final int idx = i;
          views.setOnClickPendingIntent(
              ROW_IDS[i],
              WidgetIntents.openApp(context, 1060 + idx, "go=guide&id=" + (g != null ? g.optString("id", "") : "")));
        } else {
          views.setViewVisibility(ROW_IDS[i], View.GONE);
        }
      }
    }

    views.setOnClickPendingIntent(
        R.id.widget_guides_root, WidgetIntents.openApp(context, 1069, "go=lounge&guides=1"));
    return views;
  }
}
