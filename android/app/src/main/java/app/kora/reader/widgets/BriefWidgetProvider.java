package app.kora.reader.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;

/**
 * Resizable Daily Brief widget.
 * Lead marquees only when it won't fit; headlines flip slowly when the widget is too short.
 */
public class BriefWidgetProvider extends AppWidgetProvider {
  private static final int[] STATIC_LINES = {
    R.id.widget_brief_line1,
    R.id.widget_brief_line2,
    R.id.widget_brief_line3,
    R.id.widget_brief_line4,
    R.id.widget_brief_line5
  };
  private static final int[] FLIP_LINES = {
    R.id.widget_brief_flip1,
    R.id.widget_brief_flip2,
    R.id.widget_brief_flip3,
    R.id.widget_brief_flip4,
    R.id.widget_brief_flip5,
    R.id.widget_brief_flip6
  };

  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    updateAll(context, appWidgetManager, appWidgetIds);
  }

  @Override
  public void onAppWidgetOptionsChanged(
      Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
    appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, newOptions));
  }

  static void updateAll(Context context, AppWidgetManager manager, int[] appWidgetIds) {
    for (int id : appWidgetIds) {
      Bundle options = manager.getAppWidgetOptions(id);
      manager.updateAppWidget(id, buildViews(context, options));
    }
  }

  static RemoteViews buildViews(Context context, Bundle options) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_brief);

    String lead = WidgetDataStore.briefLead(context);
    String[] headlines = WidgetDataStore.briefHeadlines(context);

    int minWidth = options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180) : 180;
    int minHeight =
        options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110) : 110;

    views.setTextViewText(R.id.widget_brief_eyebrow, "DAILY BRIEF");

    if (headlines.length == 0 && (lead == null || lead.trim().isEmpty())) {
      views.setTextViewText(
          R.id.widget_brief_lead, "Subscribe to feeds in Read to fill today's brief");
      setLeadScroll(views, false);
      views.setViewVisibility(R.id.widget_brief_static, View.GONE);
      views.setViewVisibility(R.id.widget_brief_flipper, View.GONE);
      views.setOnClickPendingIntent(
          R.id.widget_brief_root,
          WidgetIntents.openApp(context, 1002, "go=feed&briefs=1"));
      return views;
    }

    String leadText =
        lead != null && !lead.trim().isEmpty() ? lead.trim() : "Today across your feeds";
    views.setTextViewText(R.id.widget_brief_lead, leadText);

    // Rough fit estimate: ~6.5dp per character at 14sp
    int approxChars = Math.max(12, (int) (minWidth / 6.5f));
    boolean leadOverflows = leadText.length() > approxChars * 2 || (minHeight < 90 && leadText.length() > approxChars);
    setLeadScroll(views, leadOverflows);

    // How many static headline rows fit under the lead
    int usable = Math.max(40, minHeight - 54);
    int linesThatFit = Math.max(1, usable / 18);
    boolean needFlip = headlines.length > linesThatFit || minHeight < 100;

    if (needFlip && headlines.length > 0) {
      views.setViewVisibility(R.id.widget_brief_static, View.GONE);
      views.setViewVisibility(R.id.widget_brief_flipper, View.VISIBLE);
      for (int i = 0; i < FLIP_LINES.length; i++) {
        if (i < headlines.length && headlines[i] != null && !headlines[i].isEmpty()) {
          views.setTextViewText(FLIP_LINES[i], "• " + headlines[i]);
          views.setViewVisibility(FLIP_LINES[i], View.VISIBLE);
        } else {
          views.setTextViewText(FLIP_LINES[i], "");
          views.setViewVisibility(FLIP_LINES[i], View.GONE);
        }
      }
      // Slow cycle through overflowing headlines
      views.setInt(R.id.widget_brief_flipper, "setFlipInterval", 4500);
      views.setBoolean(R.id.widget_brief_flipper, "setAutoStart", true);
      try {
        views.setBoolean(R.id.widget_brief_flipper, "startFlipping", true);
      } catch (Exception ignored) {
        /* some launchers ignore startFlipping via reflection helpers */
      }
    } else {
      views.setViewVisibility(R.id.widget_brief_flipper, View.GONE);
      views.setViewVisibility(R.id.widget_brief_static, View.VISIBLE);
      views.setBoolean(R.id.widget_brief_flipper, "setAutoStart", false);
      for (int i = 0; i < STATIC_LINES.length; i++) {
        setLine(views, STATIC_LINES[i], headlines, i);
      }
    }

    views.setOnClickPendingIntent(
        R.id.widget_brief_root,
        WidgetIntents.openApp(context, 1002, "go=feed&briefs=1"));
    return views;
  }

  private static void setLeadScroll(RemoteViews views, boolean scroll) {
    if (scroll) {
      views.setBoolean(R.id.widget_brief_lead, "setSingleLine", true);
      views.setInt(R.id.widget_brief_lead, "setMaxLines", 1);
      views.setBoolean(R.id.widget_brief_lead, "setHorizontallyScrolling", true);
      views.setBoolean(R.id.widget_brief_lead, "setSelected", true);
    } else {
      views.setBoolean(R.id.widget_brief_lead, "setSingleLine", false);
      views.setInt(R.id.widget_brief_lead, "setMaxLines", 2);
      views.setBoolean(R.id.widget_brief_lead, "setSelected", false);
    }
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
