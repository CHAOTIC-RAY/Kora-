package app.kora.reader;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Wraps Android's system {@link TextToSpeech} engine for Capacitor.
 * WebView speechSynthesis often returns an empty voice list on Android —
 * this plugin talks to the real device TTS (Google, Samsung, etc.).
 */
@CapacitorPlugin(name = "KoraTts")
public class KoraTtsPlugin extends Plugin {
  private TextToSpeech tts;
  private final AtomicBoolean ready = new AtomicBoolean(false);
  private final AtomicBoolean initializing = new AtomicBoolean(false);
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private String initError = null;
  private String enginePackage = null;
  private PluginCall activeSpeakCall = null;
  private String activeUtteranceId = null;
  private final List<Voice> cachedVoices = new ArrayList<>();

  @Override
  public void load() {
    super.load();
    mainHandler.post(this::ensureEngine);
  }

  @Override
  protected void handleOnDestroy() {
    stopInternal();
    if (tts != null) {
      try {
        tts.shutdown();
      } catch (Exception ignored) {
        /* ignore */
      }
      tts = null;
    }
    ready.set(false);
    super.handleOnDestroy();
  }

  @PluginMethod
  public void ensureReady(PluginCall call) {
    mainHandler.post(
        () ->
            whenReady(
                4000,
                ok -> {
                  JSObject ret = new JSObject();
                  ret.put("ready", ok);
                  if (enginePackage != null) ret.put("engine", enginePackage);
                  if (initError != null) ret.put("error", initError);
                  call.resolve(ret);
                }));
  }

  @PluginMethod
  public void getVoices(PluginCall call) {
    mainHandler.post(
        () ->
            whenReady(
                4000,
                ok -> {
                  try {
                    refreshVoiceCache();
                    JSArray voices = new JSArray();
                    for (int i = 0; i < cachedVoices.size(); i++) {
                      Voice v = cachedVoices.get(i);
                      if (v == null) continue;
                      Locale locale = v.getLocale();
                      JSObject item = new JSObject();
                      item.put("name", v.getName() != null ? v.getName() : ("Voice " + i));
                      item.put("lang", locale != null ? locale.toLanguageTag() : "und");
                      item.put("localService", !v.isNetworkConnectionRequired());
                      item.put("default", false);
                      item.put("index", i);
                      item.put("voiceURI", v.getName());
                      voices.put(item);
                    }
                    JSObject ret = new JSObject();
                    ret.put("voices", voices);
                    ret.put("ready", ok);
                    if (enginePackage != null) ret.put("engine", enginePackage);
                    if (initError != null) ret.put("error", initError);
                    call.resolve(ret);
                  } catch (Exception e) {
                    call.reject("Failed to list TTS voices: " + e.getMessage(), e);
                  }
                }));
  }

  @PluginMethod
  public void speak(PluginCall call) {
    String text = call.getString("text");
    if (text == null || text.trim().isEmpty()) {
      call.reject("Missing text");
      return;
    }
    final String speakText = text.trim();
    final String lang = call.getString("lang", "en-US");
    final Float rate = call.getFloat("rate", 1.0f);
    final Float pitch = call.getFloat("pitch", 1.0f);
    final Integer voiceIndex = call.getInt("voiceIndex");
    final String voiceName = call.getString("voiceName");

    call.setKeepAlive(true);

    mainHandler.post(
        () ->
            whenReady(
                4000,
                ok -> {
                  try {
                    if (!ok || tts == null || !ready.get()) {
                      call.reject(
                          initError != null
                              ? initError
                              : "Android TTS engine is not ready. Install or enable a system TTS engine in Settings.");
                      return;
                    }

                    stopInternal();
                    activeSpeakCall = call;

                    applyVoice(voiceIndex, voiceName, lang);
                    float safeRate = Math.max(0.5f, Math.min(2.0f, rate != null ? rate : 1.0f));
                    float safePitch = Math.max(0.5f, Math.min(2.0f, pitch != null ? pitch : 1.0f));
                    tts.setSpeechRate(safeRate);
                    tts.setPitch(safePitch);

                    final String utteranceId = UUID.randomUUID().toString();
                    activeUtteranceId = utteranceId;
                    Bundle params = new Bundle();
                    params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);

                    tts.setOnUtteranceProgressListener(
                        new UtteranceProgressListener() {
                          @Override
                          public void onStart(String utteranceId1) {}

                          @Override
                          public void onDone(String utteranceId1) {
                            finishSpeak(utteranceId1, true, null);
                          }

                          @Override
                          public void onError(String utteranceId1) {
                            finishSpeak(utteranceId1, false, "TTS playback error");
                          }

                          @Override
                          public void onError(String utteranceId1, int errorCode) {
                            finishSpeak(
                                utteranceId1, false, "TTS playback error (" + errorCode + ")");
                          }
                        });

                    int result =
                        tts.speak(speakText, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
                    if (result == TextToSpeech.ERROR) {
                      finishSpeak(utteranceId, false, "TTS speak() returned ERROR");
                    }
                  } catch (Exception e) {
                    activeSpeakCall = null;
                    call.reject("TTS speak failed: " + e.getMessage(), e);
                  }
                }));
  }

  @PluginMethod
  public void stop(PluginCall call) {
    mainHandler.post(
        () -> {
          stopInternal();
          call.resolve();
        });
  }

  @PluginMethod
  public void isSpeaking(PluginCall call) {
    JSObject ret = new JSObject();
    boolean speaking = false;
    try {
      speaking = tts != null && tts.isSpeaking();
    } catch (Exception ignored) {
      /* ignore */
    }
    ret.put("speaking", speaking);
    call.resolve(ret);
  }

  @PluginMethod
  public void openInstall(PluginCall call) {
    try {
      Intent intent = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      try {
        Intent settings = new Intent("com.android.settings.TTS_SETTINGS");
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(settings);
        call.resolve();
      } catch (Exception e2) {
        call.reject("Unable to open TTS installer: " + e2.getMessage(), e2);
      }
    }
  }

  private void whenReady(long timeoutMs, Consumer<Boolean> done) {
    ensureEngine();
    final long deadline = System.currentTimeMillis() + timeoutMs;
    final Runnable[] tick = new Runnable[1];
    tick[0] =
        () -> {
          if (ready.get()) {
            done.accept(true);
            return;
          }
          if (!initializing.get() && initError != null) {
            done.accept(false);
            return;
          }
          if (System.currentTimeMillis() >= deadline) {
            done.accept(ready.get());
            return;
          }
          mainHandler.postDelayed(tick[0], 50);
        };
    tick[0].run();
  }

  private synchronized void ensureEngine() {
    if (tts != null) return;
    if (!initializing.compareAndSet(false, true)) return;

    initError = null;
    try {
      tts =
          new TextToSpeech(
              getContext(),
              status -> {
                initializing.set(false);
                if (status == TextToSpeech.SUCCESS) {
                  ready.set(true);
                  initError = null;
                  try {
                    enginePackage = tts.getDefaultEngine();
                  } catch (Exception ignored) {
                    enginePackage = null;
                  }
                  try {
                    int langResult = tts.setLanguage(Locale.US);
                    if (langResult == TextToSpeech.LANG_MISSING_DATA
                        || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                      tts.setLanguage(Locale.getDefault());
                    }
                  } catch (Exception ignored) {
                    /* ignore */
                  }
                  refreshVoiceCache();
                } else {
                  ready.set(false);
                  initError =
                      "No Android TTS engine available. Install Google Text-to-speech (or your OEM TTS) in system settings.";
                }
              });
    } catch (Exception e) {
      initializing.set(false);
      ready.set(false);
      initError = "Failed to create TextToSpeech: " + e.getMessage();
      tts = null;
    }
  }

  private void refreshVoiceCache() {
    cachedVoices.clear();
    if (tts == null || !ready.get()) return;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        Set<Voice> voices = tts.getVoices();
        if (voices != null) {
          List<Voice> list = new ArrayList<>(voices);
          Collections.sort(
              list,
              Comparator.comparing(
                      (Voice v) -> v.getLocale() != null ? v.getLocale().toLanguageTag() : "")
                  .thenComparing(v -> v.getName() != null ? v.getName() : ""));
          cachedVoices.addAll(list);
        }
      }
    } catch (Exception ignored) {
      /* some OEM engines throw here */
    }
  }

  private void applyVoice(Integer voiceIndex, String voiceName, String lang) {
    if (tts == null) return;
    refreshVoiceCache();

    Voice chosen = null;
    if (voiceIndex != null && voiceIndex >= 0 && voiceIndex < cachedVoices.size()) {
      chosen = cachedVoices.get(voiceIndex);
    } else if (voiceName != null && !voiceName.isEmpty()) {
      for (Voice v : cachedVoices) {
        if (voiceName.equals(v.getName())) {
          chosen = v;
          break;
        }
      }
    }

    if (chosen != null) {
      try {
        tts.setVoice(chosen);
        return;
      } catch (Exception ignored) {
        /* fall through to locale */
      }
    }

    try {
      Locale locale = Locale.forLanguageTag(lang != null ? lang : "en-US");
      if (locale.getLanguage().isEmpty()) locale = Locale.US;
      int result = tts.setLanguage(locale);
      if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
        tts.setLanguage(Locale.getDefault());
      }
    } catch (Exception ignored) {
      /* ignore */
    }
  }

  private void stopInternal() {
    try {
      if (tts != null) tts.stop();
    } catch (Exception ignored) {
      /* ignore */
    }
    PluginCall pending = activeSpeakCall;
    activeSpeakCall = null;
    activeUtteranceId = null;
    if (pending != null) {
      try {
        pending.resolve();
      } catch (Exception ignored) {
        /* already resolved */
      }
    }
  }

  private void finishSpeak(String utteranceId, boolean ok, String error) {
    if (activeUtteranceId == null || !activeUtteranceId.equals(utteranceId)) return;
    final PluginCall pending = activeSpeakCall;
    activeSpeakCall = null;
    activeUtteranceId = null;
    if (pending == null) return;
    mainHandler.post(
        () -> {
          try {
            if (ok) pending.resolve();
            else pending.reject(error != null ? error : "TTS error");
          } catch (Exception ignored) {
            /* already finished */
          }
        });
  }
}
