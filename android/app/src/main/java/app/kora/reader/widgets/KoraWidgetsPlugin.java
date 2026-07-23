package app.kora.reader.widgets;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JS bridge: push Continue / Brief / Mini-game payloads into SharedPreferences and
 * refresh any pinned home-screen widgets.
 */
@CapacitorPlugin(name = "KoraWidgets")
public class KoraWidgetsPlugin extends Plugin {
  private final ExecutorService coverExecutor = Executors.newSingleThreadExecutor();

  @PluginMethod
  public void sync(PluginCall call) {
    try {
      boolean needCoverRefresh = false;

      if (call.getData().has("continue")) {
        JSObject cont = call.getObject("continue", null);
        JSONObject payload = buildContinuePayload(cont);
        WidgetDataStore.saveContinue(getContext(), payload);
        needCoverRefresh |= enqueueCover(payload);
      }

      if (call.getData().has("continueBook")) {
        JSObject cont = call.getObject("continueBook", null);
        JSONObject payload = buildContinuePayload(cont);
        WidgetDataStore.saveContinueBook(getContext(), payload);
        needCoverRefresh |= enqueueCover(payload);
      }

      if (call.getData().has("continueAudio")) {
        JSObject cont = call.getObject("continueAudio", null);
        JSONObject payload = buildContinuePayload(cont);
        if (payload != null && cont != null) {
          payload.put("playing", cont.optBoolean("playing", false));
        }
        WidgetDataStore.saveContinueAudio(getContext(), payload);
        needCoverRefresh |= enqueueCover(payload);
      }

      if (call.getData().has("brief")) {
        JSObject brief = call.getObject("brief", null);
        if (brief == null || brief.length() == 0) {
          WidgetDataStore.saveBrief(getContext(), null);
        } else {
          JSONObject payload = new JSONObject();
          payload.put("lead", brief.optString("lead", ""));
          JSONArray headlines = new JSONArray();
          try {
            JSONArray arr = brief.optJSONArray("headlines");
            if (arr != null) {
              for (int i = 0; i < arr.length() && i < 6; i++) {
                headlines.put(arr.optString(i, ""));
              }
            }
          } catch (Exception ignored) {
            /* optional */
          }
          payload.put("headlines", headlines);
          WidgetDataStore.saveBrief(getContext(), payload);
        }
      }

      if (call.getData().has("miniGame")) {
        JSObject game = call.getObject("miniGame", null);
        if (game == null || game.length() == 0) {
          WidgetDataStore.saveMiniGame(getContext(), null);
        } else {
          JSONObject payload = new JSONObject();
          payload.put("day", game.optString("day", ""));
          payload.put("word", game.optString("word", "").toUpperCase());
          payload.put("clue", game.optString("clue", ""));
          WidgetDataStore.saveMiniGame(getContext(), payload);
          // Force puzzle refresh for a new day word from JS
          WidgetDataStore.prefs(getContext()).edit().remove("minigame_day").apply();
          MiniGameWidgetProvider.ensureDailyPuzzle(getContext());
        }
      }

      WidgetIntents.refreshAll(getContext());
      JSObject ret = new JSObject();
      ret.put("ok", true);
      ret.put("coversQueued", needCoverRefresh);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to sync widgets: " + e.getMessage(), e);
    }
  }

  private JSONObject buildContinuePayload(JSObject cont) throws Exception {
    if (cont == null || cont.length() == 0 || cont.optString("title", "").trim().isEmpty()) {
      return null;
    }
    JSONObject payload = new JSONObject();
    payload.put("title", cont.optString("title", "Continue reading"));
    payload.put("author", cont.optString("author", ""));
    payload.put("percent", cont.optDouble("percent", 0));
    payload.put("kind", cont.optString("kind", "book"));
    String coverUrl = cont.optString("coverUrl", "");
    String coverKey = cont.optString("coverKey", "");
    if (coverKey.isEmpty() && !coverUrl.isEmpty()) {
      coverKey = Integer.toHexString(coverUrl.hashCode());
    }
    if (!coverKey.isEmpty()) payload.put("coverKey", coverKey);
    if (!coverUrl.isEmpty()) payload.put("coverUrl", coverUrl);
    return payload;
  }

  /** Queue cover download; returns true if a download was scheduled. */
  private boolean enqueueCover(JSONObject payload) {
    if (payload == null) return false;
    final String key = payload.optString("coverKey", "");
    final String url = payload.optString("coverUrl", "");
    if (key.isEmpty() || url.isEmpty()) return false;
    if (WidgetCoverHelper.loadCached(getContext(), key) != null) return false;

    coverExecutor.execute(
        () -> {
          boolean ok = WidgetCoverHelper.downloadToCache(getContext(), key, url);
          if (ok) {
            WidgetIntents.refreshAll(getContext());
          }
        });
    return true;
  }

  @PluginMethod
  public void refresh(PluginCall call) {
    try {
      WidgetIntents.refreshAll(getContext());
      call.resolve();
    } catch (Exception e) {
      call.reject("Failed to refresh widgets: " + e.getMessage(), e);
    }
  }

  /**
   * Prompt the launcher to pin a Kora widget (Android 8+).
   * options.which: "continue" | "brief" | "book" | "audio" | "game"
   */
  @PluginMethod
  public void requestPin(PluginCall call) {
    try {
      String which = call.getString("which", "continue");
      boolean ok = WidgetIntents.requestPin(getContext(), which);
      JSObject ret = new JSObject();
      ret.put("ok", ok);
      ret.put("supported", ok);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to pin widget: " + e.getMessage(), e);
    }
  }
}
