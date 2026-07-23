package app.kora.reader.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;
import app.kora.reader.R;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import org.json.JSONObject;

/**
 * Playable mini crossword clue on the home screen.
 * Tap letter tiles to spell today's word; open full Crossword from the chip.
 */
public class MiniGameWidgetProvider extends AppWidgetProvider {
  public static final String ACTION_LETTER = "app.kora.reader.widgets.MINIGAME_LETTER";
  public static final String ACTION_BACKSPACE = "app.kora.reader.widgets.MINIGAME_BACKSPACE";
  public static final String EXTRA_LETTER = "letter";

  private static final int[] LETTER_IDS = {
    R.id.widget_game_letter0,
    R.id.widget_game_letter1,
    R.id.widget_game_letter2,
    R.id.widget_game_letter3,
    R.id.widget_game_letter4,
    R.id.widget_game_letter5
  };

  /** Compact offline clue bank for the widget (mirrors reading-themed words). */
  private static final String[][] BANK = {
    {"BOOK", "Bound pages you read"},
    {"PAGE", "One side of a leaf in a book"},
    {"READ", "What you do with a novel"},
    {"INK", "Dark fluid for pens"},
    {"MAP", "Chart of lands and roads"},
    {"MOON", "Night sky companion"},
    {"STAR", "Twinkle in the night"},
    {"TREE", "Woody plant with leaves"},
    {"BIRD", "Feathered flyer"},
    {"CAKE", "Sweet baked dessert"},
    {"RAIN", "Falls from clouds"},
    {"SNOW", "Frozen white flakes"},
    {"SHIP", "Large seagoing vessel"},
    {"HOME", "Where you live"},
    {"STORY", "Tale with a plot"},
    {"POEM", "Verse writing"},
    {"DREAM", "Mind movie while asleep"},
    {"LIGHT", "Opposite of dark"},
    {"NIGHT", "Time after sunset"},
    {"RIVER", "Flowing freshwater"},
    {"STONE", "Hard rock piece"},
    {"CLOUD", "Sky vapor puff"},
    {"OCEAN", "Vast salt water"},
    {"BEACH", "Sandy shore"},
    {"GOLD", "Precious yellow metal"},
    {"QUEEN", "Female monarch"},
    {"SWORD", "Bladed weapon"},
    {"PEACE", "Calm without conflict"},
    {"HOPE", "Wish for good things"},
    {"WORD", "Unit of language"}
  };

  @Override
  public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
    ensureDailyPuzzle(context);
    updateAll(context, appWidgetManager, appWidgetIds);
  }

  @Override
  public void onEnabled(Context context) {
    ensureDailyPuzzle(context);
  }

  static void updateAll(Context context, AppWidgetManager manager, int[] appWidgetIds) {
    ensureDailyPuzzle(context);
    for (int id : appWidgetIds) {
      manager.updateAppWidget(id, buildViews(context));
    }
  }

  static void refresh(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, MiniGameWidgetProvider.class));
    if (ids.length > 0) updateAll(context, manager, ids);
  }

  static RemoteViews buildViews(Context context) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_minigame);
    PuzzleState state = loadState(context);

    views.setTextViewText(R.id.widget_game_eyebrow, "MINI CROSSWORD");
    views.setTextViewText(R.id.widget_game_clue, state.clue);
    views.setTextViewText(R.id.widget_game_answer, formatAnswer(state));

    if (state.solved) {
      views.setTextViewText(R.id.widget_game_status, "Solved · open full game");
    } else if (state.guess.length() >= state.word.length()) {
      views.setTextViewText(R.id.widget_game_status, "Not quite · backspace & retry");
    } else {
      views.setTextViewText(
          R.id.widget_game_status,
          state.guess.isEmpty() ? "Tap letters to spell" : "Keep going…");
    }

    for (int i = 0; i < LETTER_IDS.length; i++) {
      if (i < state.letters.size()) {
        String letter = state.letters.get(i);
        views.setViewVisibility(LETTER_IDS[i], View.VISIBLE);
        views.setTextViewText(LETTER_IDS[i], letter);
        Intent intent = new Intent(context, MiniGameClickReceiver.class);
        intent.setAction(ACTION_LETTER);
        intent.putExtra(EXTRA_LETTER, letter);
        intent.putExtra("slot", i);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
          flags |= PendingIntent.FLAG_MUTABLE;
        } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
          flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(context, 2000 + i, intent, flags);
        views.setOnClickPendingIntent(LETTER_IDS[i], pi);
      } else {
        views.setViewVisibility(LETTER_IDS[i], View.GONE);
      }
    }

    Intent back = new Intent(context, MiniGameClickReceiver.class);
    back.setAction(ACTION_BACKSPACE);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
      flags |= PendingIntent.FLAG_MUTABLE;
    } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    views.setOnClickPendingIntent(
        R.id.widget_game_backspace, PendingIntent.getBroadcast(context, 2099, back, flags));

    views.setOnClickPendingIntent(
        R.id.widget_game_open,
        WidgetIntents.openApp(context, 1030, "go=crossword"));
    views.setOnClickPendingIntent(
        R.id.widget_game_root,
        WidgetIntents.openApp(context, 1031, "go=crossword"));

    return views;
  }

  private static String formatAnswer(PuzzleState state) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < state.word.length(); i++) {
      if (i > 0) sb.append(' ');
      if (state.solved) {
        sb.append(state.word.charAt(i));
      } else if (i < state.guess.length()) {
        sb.append(state.guess.charAt(i));
      } else {
        sb.append('_');
      }
    }
    return sb.toString();
  }

  static void ensureDailyPuzzle(Context context) {
    SharedPreferences prefs = WidgetDataStore.prefs(context);
    String day = dayKey();
    String savedDay = prefs.getString("minigame_day", "");
    JSONObject synced = WidgetDataStore.getMiniGame(context);

    if (day.equals(savedDay) && prefs.contains("minigame_word")) {
      return;
    }

    String word;
    String clue;
    if (synced != null
        && day.equals(synced.optString("day", ""))
        && synced.optString("word", "").length() >= 3) {
      word = synced.optString("word").toUpperCase(Locale.US);
      clue = synced.optString("clue", "Daily word");
    } else {
      int index = Math.floorMod(day.hashCode(), BANK.length);
      word = BANK[index][0];
      clue = BANK[index][1];
    }

    List<String> letters = new ArrayList<>();
    for (int i = 0; i < word.length(); i++) {
      letters.add(String.valueOf(word.charAt(i)));
    }
    Collections.shuffle(letters, new Random(day.hashCode()));

    prefs
        .edit()
        .putString("minigame_day", day)
        .putString("minigame_word", word)
        .putString("minigame_clue", clue)
        .putString("minigame_letters", join(letters))
        .putString("minigame_guess", "")
        .putBoolean("minigame_solved", false)
        .apply();
  }

  static PuzzleState loadState(Context context) {
    ensureDailyPuzzle(context);
    SharedPreferences prefs = WidgetDataStore.prefs(context);
    PuzzleState s = new PuzzleState();
    s.word = prefs.getString("minigame_word", "BOOK");
    s.clue = prefs.getString("minigame_clue", "Bound pages you read");
    s.guess = prefs.getString("minigame_guess", "");
    s.solved = prefs.getBoolean("minigame_solved", false);
    s.letters = split(prefs.getString("minigame_letters", "B,O,O,K"));
    return s;
  }

  static void saveGuess(Context context, String guess, boolean solved) {
    WidgetDataStore.prefs(context)
        .edit()
        .putString("minigame_guess", guess)
        .putBoolean("minigame_solved", solved)
        .apply();
  }

  private static String dayKey() {
    Calendar c = Calendar.getInstance();
    return c.get(Calendar.YEAR)
        + "-"
        + (c.get(Calendar.MONTH) + 1)
        + "-"
        + c.get(Calendar.DAY_OF_MONTH);
  }

  private static String join(List<String> letters) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < letters.size(); i++) {
      if (i > 0) sb.append(',');
      sb.append(letters.get(i));
    }
    return sb.toString();
  }

  private static List<String> split(String raw) {
    List<String> out = new ArrayList<>();
    if (raw == null || raw.isEmpty()) return out;
    for (String part : raw.split(",")) {
      if (!part.isEmpty()) out.add(part);
    }
    return out;
  }

  static final class PuzzleState {
    String word;
    String clue;
    String guess;
    boolean solved;
    List<String> letters;
  }

  /** Handles letter / backspace taps without opening the app. */
  public static class MiniGameClickReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
      if (intent == null || intent.getAction() == null) return;
      PuzzleState state = loadState(context);
      if (state.solved) {
        refresh(context);
        return;
      }

      if (ACTION_BACKSPACE.equals(intent.getAction())) {
        if (!state.guess.isEmpty()) {
          saveGuess(context, state.guess.substring(0, state.guess.length() - 1), false);
        }
      } else if (ACTION_LETTER.equals(intent.getAction())) {
        String letter = intent.getStringExtra(EXTRA_LETTER);
        if (letter != null && state.guess.length() < state.word.length()) {
          String next = state.guess + letter;
          boolean solved = next.equalsIgnoreCase(state.word);
          saveGuess(context, next, solved);
        }
      }
      refresh(context);
    }
  }
}
