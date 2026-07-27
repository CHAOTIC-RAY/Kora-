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
 * Lounge "Annotate & notes" home-screen widget — mirrors the Lounge notes list
 * (highlight/note count + up to 3 recent annotations).
 */
public class NotesWidgetProvider extends AppWidgetProvider {
  private static final int[] ROW_IDS = {
    R.id.widget_notes_row0,
    R.id.widget_notes_row1,
    R.id.widget_notes_row2
  };
  private static final int[] DOT_IDS = {
    R.id.widget_notes_dot0,
    R.id.widget_notes_dot1,
    R.id.widget_notes_dot2
  };
  private static final int[] TEXT_IDS = {
    R.id.widget_notes_text0,
    R.id.widget_notes_text1,
    R.id.widget_notes_text2
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
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, NotesWidgetProvider.class));
    if (ids.length > 0) updateAll(context, manager, ids);
  }

  static RemoteViews buildViews(Context context) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_notes);
    JSONObject payload = WidgetDataStore.getNotes(context);

    views.setTextViewText(R.id.widget_notes_eyebrow, "ANNOTATE & NOTES");

    if (payload == null) {
      views.setTextViewText(R.id.widget_notes_sub, "Highlights & chapter notes");
      views.setViewVisibility(R.id.widget_notes_list, View.GONE);
      views.setViewVisibility(R.id.widget_notes_empty, View.VISIBLE);
      views.setOnClickPendingIntent(
          R.id.widget_notes_root, WidgetIntents.openApp(context, 1079, "go=annotations"));
      return views;
    }

    int highlights = payload.optInt("highlights", 0);
    int notes = payload.optInt("notes", 0);
    views.setTextViewText(
        R.id.widget_notes_sub, highlights + " highlights · " + notes + " notes");

    JSONArray items = payload.optJSONArray("items");
    if (items == null || items.length() == 0) {
      views.setViewVisibility(R.id.widget_notes_list, View.GONE);
      views.setViewVisibility(R.id.widget_notes_empty, View.VISIBLE);
    } else {
      views.setViewVisibility(R.id.widget_notes_list, View.VISIBLE);
      views.setViewVisibility(R.id.widget_notes_empty, View.GONE);
      int n = Math.min(items.length(), ROW_IDS.length);
      for (int i = 0; i < ROW_IDS.length; i++) {
        if (i < n) {
          JSONObject it = items.optJSONObject(i);
          String kind = it != null ? it.optString("kind", "highlight") : "highlight";
          String text = it != null ? it.optString("text", "") : "";
          String color = it != null ? it.optString("color", "yellow") : "yellow";
          if (text.length() > 120) text = text.substring(0, 120).trim() + "…";
          views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
          views.setTextViewText(TEXT_IDS[i], "“" + text + "”");
          views.setInt(DOT_IDS[i], "setBackgroundColor", dotColor(color));
        } else {
          views.setViewVisibility(ROW_IDS[i], View.GONE);
        }
      }
    }

    views.setOnClickPendingIntent(
        R.id.widget_notes_root, WidgetIntents.openApp(context, 1079, "go=annotations"));
    return views;
  }

  private static int dotColor(String color) {
    switch (color) {
      case "green": return 0xFF34D399;
      case "blue": return 0xFF38BDF8;
      case "pink": return 0xFFF472B6;
      default: return 0xFFFACC15; // yellow
    }
  }
}
