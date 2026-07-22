package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;

/** "Daily news brief" home-screen widget. */
public class BriefWidgetProvider extends AppWidgetProvider {
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
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_brief);

    String lead = WidgetDataStore.briefLead(context);
    String[] headlines = WidgetDataStore.briefHeadlines(context);

    views.setTextViewText(R.id.widget_brief_eyebrow, "DAILY BRIEF");

    if (headlines.length == 0 && (lead == null || lead.trim().isEmpty())) {
      views.setTextViewText(R.id.widget_brief_lead, "Subscribe to feeds in Read to fill today's brief");
      views.setViewVisibility(R.id.widget_brief_line1, View.GONE);
      views.setViewVisibility(R.id.widget_brief_line2, View.GONE);
      views.setViewVisibility(R.id.widget_brief_line3, View.GONE);
    } else {
      views.setTextViewText(
          R.id.widget_brief_lead,
          lead != null && !lead.trim().isEmpty() ? lead : "Today across your feeds");
      setLine(views, R.id.widget_brief_line1, headlines, 0);
      setLine(views, R.id.widget_brief_line2, headlines, 1);
      setLine(views, R.id.widget_brief_line3, headlines, 2);
    }

    views.setOnClickPendingIntent(
        R.id.widget_brief_root,
        WidgetIntents.openApp(context, 1002, "go=feed&briefs=1"));
    return views;
  }

  private static void setLine(RemoteViews views, int viewId, String[] headlines, int index) {
    if (index < headlines.length && headlines[index] != null && !headlines[index].isEmpty()) {
      views.setViewVisibility(viewId, View.VISIBLE);
      views.setTextViewText(viewId, "• " + headlines[index]);
    } else {
      views.setViewVisibility(viewId, View.GONE);
    }
  }
}
