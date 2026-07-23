package app.kora.reader.widgets;

import android.content.Context;
import android.graphics.Bitmap;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** Shared cover + text binding for continue-style widgets. */
public final class WidgetContinueBinder {
  private WidgetContinueBinder() {}

  public static void bindCover(
      Context context,
      RemoteViews views,
      JSONObject payload,
      int coverViewId,
      int fallbackViewId,
      boolean cassette) {
    String key = payload == null ? null : payload.optString("coverKey", null);
    Bitmap bmp = key == null ? null : WidgetCoverHelper.loadCached(context, key);
    if (bmp != null) {
      views.setImageViewBitmap(coverViewId, bmp);
      views.setViewVisibility(coverViewId, View.VISIBLE);
      views.setViewVisibility(fallbackViewId, View.GONE);
    } else {
      views.setViewVisibility(coverViewId, View.GONE);
      views.setViewVisibility(fallbackViewId, View.VISIBLE);
      String title = payload == null ? "" : payload.optString("title", "K");
      String letter =
          title.trim().isEmpty() ? (cassette ? "♪" : "K") : title.trim().substring(0, 1).toUpperCase();
      views.setTextViewText(fallbackViewId, letter);
    }
  }
}
