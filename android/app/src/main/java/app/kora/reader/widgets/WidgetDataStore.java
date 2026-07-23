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
  public static final String KEY_CONTINUE_BOOK_JSON = "continue_book_json";
  public static final String KEY_CONTINUE_AUDIO_JSON = "continue_audio_json";
  public static final String KEY_BRIEF_JSON = "brief_json";
  public static final String KEY_MINIGAME_JSON = "minigame_json";
  public static final String KEY_UPDATED_AT = "updated_at";

  private WidgetDataStore() {}

  public static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static void saveContinue(Context context, JSONObject payloadOrNull) {
    writeJson(context, KEY_CONTINUE_JSON, payloadOrNull);
  }

  public static void saveContinueBook(Context context, JSONObject payloadOrNull) {
    writeJson(context, KEY_CONTINUE_BOOK_JSON, payloadOrNull);
  }

  public static void saveContinueAudio(Context context, JSONObject payloadOrNull) {
    writeJson(context, KEY_CONTINUE_AUDIO_JSON, payloadOrNull);
  }

  public static void saveBrief(Context context, JSONObject payloadOrNull) {
    writeJson(context, KEY_BRIEF_JSON, payloadOrNull);
  }

  public static void saveMiniGame(Context context, JSONObject payloadOrNull) {
    writeJson(context, KEY_MINIGAME_JSON, payloadOrNull);
  }

  private static void writeJson(Context context, String key, JSONObject payloadOrNull) {
    SharedPreferences.Editor editor = prefs(context).edit();
    if (payloadOrNull == null) {
      editor.remove(key);
    } else {
      editor.putString(key, payloadOrNull.toString());
    }
    editor.putLong(KEY_UPDATED_AT, System.currentTimeMillis());
    editor.apply();
  }

  public static JSONObject getContinue(Context context) {
    return readObject(prefs(context).getString(KEY_CONTINUE_JSON, null));
  }

  public static JSONObject getContinueBook(Context context) {
    JSONObject o = readObject(prefs(context).getString(KEY_CONTINUE_BOOK_JSON, null));
    if (o != null) return o;
    JSONObject any = getContinue(context);
    if (any != null && !"audio".equalsIgnoreCase(any.optString("kind", "book"))) return any;
    return null;
  }

  public static JSONObject getContinueAudio(Context context) {
    JSONObject o = readObject(prefs(context).getString(KEY_CONTINUE_AUDIO_JSON, null));
    if (o != null) return o;
    JSONObject any = getContinue(context);
    if (any != null && "audio".equalsIgnoreCase(any.optString("kind", "book"))) return any;
    return null;
  }

  public static JSONObject getBrief(Context context) {
    return readObject(prefs(context).getString(KEY_BRIEF_JSON, null));
  }

  public static JSONObject getMiniGame(Context context) {
    return readObject(prefs(context).getString(KEY_MINIGAME_JSON, null));
  }

  public static String continueTitle(Context context) {
    return optString(getContinue(context), "title", null);
  }

  public static String continueAuthor(Context context) {
    return optString(getContinue(context), "author", "");
  }

  public static int continuePercent(Context context) {
    JSONObject o = getContinue(context);
    if (o == null) return 0;
    return (int) Math.round(o.optDouble("percent", 0));
  }

  public static String continueKind(Context context) {
    return optString(getContinue(context), "kind", "book");
  }

  public static String continueCoverKey(Context context) {
    return optString(getContinue(context), "coverKey", null);
  }

  public static String briefLead(Context context) {
    return optString(getBrief(context), "lead", null);
  }

  public static String[] briefHeadlines(Context context) {
    JSONObject o = getBrief(context);
    if (o == null) return new String[0];
    JSONArray arr = o.optJSONArray("headlines");
    if (arr == null || arr.length() == 0) return new String[0];
    int n = Math.min(arr.length(), 6);
    String[] out = new String[n];
    for (int i = 0; i < n; i++) {
      out[i] = arr.optString(i, "");
    }
    return out;
  }

  public static String optString(JSONObject o, String key, String fallback) {
    if (o == null) return fallback;
    String v = o.optString(key, fallback);
    return v;
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
