package app.kora.reader.widgets;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JS bridge: push Continue / Brief payloads into SharedPreferences and
 * refresh any pinned home-screen widgets.
 */
@CapacitorPlugin(name = "KoraWidgets")
public class KoraWidgetsPlugin extends Plugin {

  @PluginMethod
  public void sync(PluginCall call) {
    try {
      if (call.getData().has("continue")) {
        JSObject cont = call.getObject("continue", null);
        if (cont == null || cont.length() == 0 || cont.optString("title", "").trim().isEmpty()) {
          WidgetDataStore.saveContinue(getContext(), null);
        } else {
          JSONObject payload = new JSONObject();
          payload.put("title", cont.optString("title", "Continue reading"));
          payload.put("author", cont.optString("author", ""));
          payload.put("percent", cont.optDouble("percent", 0));
          payload.put("kind", cont.optString("kind", "book"));
          WidgetDataStore.saveContinue(getContext(), payload);
        }
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
            JSArray arr = brief.getJSArray("headlines");
            if (arr != null) {
              for (int i = 0; i < arr.length() && i < 3; i++) {
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

      WidgetIntents.refreshAll(getContext());
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to sync widgets: " + e.getMessage(), e);
    }
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
   * options.which: "continue" | "brief"
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
