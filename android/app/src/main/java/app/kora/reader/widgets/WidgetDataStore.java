package app.kora.reader.widgets;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * SharedPreferences-backed payload for home-screen App Widgets.
 * Written by {@link KoraWidgetsPlugin}, read by widget providers.
 */
public final class WidgetDataStore {
  public static final String PREFS = "kora_widgets";

  public static final String KEY_CONTINUE_JSON = "continue_json";
  public static final String KEY_BRIEF_JSON = "brief_json";
  public static final String KEY_UPDATED_AT = "updated_at";

  private WidgetDataStore() {}

  public static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static void saveContinue(Context context, JSONObject payloadOrNull) {
    SharedPreferences.Editor editor = prefs(context).edit();
    if (payloadOrNull == null) {
      editor.remove(KEY_CONTINUE_JSON);
    } else {
      editor.putString(KEY_CONTINUE_JSON, payloadOrNull.toString());
    }
    editor.putLong(KEY_UPDATED_AT, System.currentTimeMillis());
    editor.apply();
  }

  public static void saveBrief(Context context, JSONObject payloadOrNull) {
    SharedPreferences.Editor editor = prefs(context).edit();
    if (payloadOrNull == null) {
      editor.remove(KEY_BRIEF_JSON);
    } else {
      editor.putString(KEY_BRIEF_JSON, payloadOrNull.toString());
    }
    editor.putLong(KEY_UPDATED_AT, System.currentTimeMillis());
    editor.apply();
  }

  public static JSONObject getContinue(Context context) {
    return readObject(prefs(context).getString(KEY_CONTINUE_JSON, null));
  }

  public static JSONObject getBrief(Context context) {
    return readObject(prefs(context).getString(KEY_BRIEF_JSON, null));
  }

  public static String continueTitle(Context context) {
    JSONObject o = getContinue(context);
    if (o == null) return null;
    return o.optString("title", null);
  }

  public static String continueAuthor(Context context) {
    JSONObject o = getContinue(context);
    if (o == null) return "";
    return o.optString("author", "");
  }

  public static int continuePercent(Context context) {
    JSONObject o = getContinue(context);
    if (o == null) return 0;
    return (int) Math.round(o.optDouble("percent", 0));
  }

  public static String continueKind(Context context) {
    JSONObject o = getContinue(context);
    if (o == null) return "book";
    return o.optString("kind", "book");
  }

  public static String briefLead(Context context) {
    JSONObject o = getBrief(context);
    if (o == null) return null;
    return o.optString("lead", null);
  }

  public static String[] briefHeadlines(Context context) {
    JSONObject o = getBrief(context);
    if (o == null) return new String[0];
    JSONArray arr = o.optJSONArray("headlines");
    if (arr == null || arr.length() == 0) return new String[0];
    String[] out = new String[Math.min(arr.length(), 3)];
    for (int i = 0; i < out.length; i++) {
      out[i] = arr.optString(i, "");
    }
    return out;
  }

  private static JSONObject readObject(String raw) {
    if (raw == null || raw.isEmpty()) return null;
    try {
      return new JSONObject(raw);
    } catch (Exception e) {
      return null;
    }
  }
}
