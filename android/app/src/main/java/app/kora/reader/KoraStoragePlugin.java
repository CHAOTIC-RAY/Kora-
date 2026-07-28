package app.kora.reader;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Play-safe Kora storage folder via the Storage Access Framework (SAF).
 *
 * The user picks a "Kora" directory once (ACTION_OPEN_DOCUMENT_TREE). We persist
 * the tree URI and create sub-folders: audiobooks, books, news, data. Files are
 * written through the DocumentFile tree so they show up in the system Files app.
 */
@CapacitorPlugin(name = "KoraStorage")
public class KoraStoragePlugin extends Plugin {

  private static final String PREFS = "kora_storage";
  private static final String KEY_TREE_URI = "tree_uri";
  private static final String[] SUBFOLDERS = { "audiobooks", "books", "news", "data" };

  private Uri getPersistedTreeUri() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
    String s = prefs.getString(KEY_TREE_URI, null);
    return s == null ? null : Uri.parse(s);
  }

  private void persistTreeUri(Uri uri) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
      final int takeFlags =
          Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
      try {
        getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
      } catch (Exception ignored) {
      }
    }
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
    prefs.edit().putString(KEY_TREE_URI, uri.toString()).apply();
  }

  /** True if a Kora folder has already been chosen. */
  @PluginMethod
  public void hasFolder(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("hasFolder", getPersistedTreeUri() != null);
    call.resolve(ret);
  }

  /** Launch the SAF directory picker so the user can choose the Kora folder. */
  @PluginMethod
  public void pickFolder(PluginCall call) {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    // Hint the initial name where supported.
    intent.putExtra(DocumentsContract.EXTRA_SHOW_ADVANCED, true);
    try {
      startActivityForResult(call, intent, "pickFolderResult");
    } catch (Exception e) {
      call.reject("Unable to open folder picker: " + e.getMessage(), e);
    }
  }

  @ActivityCallback
  private void pickFolderResult(PluginCall call, android.content.Intent result) {
    try {
      if (result == null || result.getData() == null) {
        call.reject("Folder pick cancelled");
        return;
      }
      Uri treeUri = result.getData();
      if (treeUri == null) {
        call.reject("No folder returned");
        return;
      }
      // Persist first so a later write can still retry even if sub-folder
      // creation below fails on this provider.
      persistTreeUri(treeUri);
      ensureSubfolders(treeUri);
      JSObject ret = new JSObject();
      ret.put("uri", treeUri.toString());
      call.resolve(ret);
    } catch (Exception e) {
      // Never let an unchecked SAF failure crash the WebView.
      JSObject ret = new JSObject();
      ret.put("uri", getPersistedTreeUri() != null ? getPersistedTreeUri().toString() : "");
      ret.put("partial", true);
      call.resolve(ret);
    }
  }

  /** Ensure the four sub-folders exist; returns their document URIs. */
  @RequiresApi(api = Build.VERSION_CODES.LOLLIPOP)
  private void ensureSubfolders(Uri treeUri) {
    try {
      android.content.ContentResolver cr = getContext().getContentResolver();
      Uri treeRoot = DocumentsContract.buildDocumentUriUsingTree(
          treeUri, DocumentsContract.getTreeDocumentId(treeUri));
      for (String name : SUBFOLDERS) {
        try {
          DocumentsContract.createDocument(
              cr, treeRoot, DocumentsContract.Document.MIME_TYPE_DIR, name);
        } catch (Exception ignored) {
          // Already exists or not creatable — ignore.
        }
      }
    } catch (Exception ignored) {
      // Provider rejected the tree document id (e.g. some USB/SD roots).
      // The tree URI is still persisted; writes will create folders lazily.
    }
  }

  /** List the immediate sub-folders already present under the Kora tree. */
  @PluginMethod
  @RequiresApi(api = Build.VERSION_CODES.LOLLIPOP)
  public void listSubfolders(PluginCall call) {
    Uri treeUri = getPersistedTreeUri();
    JSArray arr = new JSArray();
    if (treeUri == null) {
      call.resolve(new JSObject().put("folders", arr));
      return;
    }
    try {
      Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
          treeUri, DocumentsContract.getTreeDocumentId(treeUri));
      try (android.database.Cursor c = getContext().getContentResolver()
          .query(childrenUri, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
              null, null, null)) {
        while (c != null && c.moveToNext()) {
          String name = c.getString(0);
          if (name != null) arr.put(name);
        }
      }
    } catch (Exception ignored) {
    }
    call.resolve(new JSObject().put("folders", arr));
  }

  /**
   * Write text content into a sub-folder. Options: { subfolder, fileName, text }.
   * subfolder must be one of: audiobooks, books, news, data.
   */
  @PluginMethod
  @RequiresApi(api = Build.VERSION_CODES.LOLLIPOP)
  public void writeText(PluginCall call) {
    String sub = call.getString("subfolder", "data");
    String fileName = call.getString("fileName");
    String text = call.getString("text", "");
    if (fileName == null || fileName.trim().isEmpty()) {
      call.reject("Missing fileName");
      return;
    }
    Uri treeUri = getPersistedTreeUri();
    if (treeUri == null) {
      call.reject("No Kora folder selected");
      return;
    }
    boolean ok = false;
    try {
      Uri parent = findOrCreateSubfolder(treeUri, sub);
      if (parent != null) {
        Uri fileUri = DocumentsContract.createDocument(
            getContext().getContentResolver(), parent,
            "text/plain", sanitize(fileName));
        if (fileUri != null) {
          OutputStream os = getContext().getContentResolver().openOutputStream(fileUri);
          if (os != null) {
            os.write(text.getBytes(StandardCharsets.UTF_8));
            os.close();
            ok = true;
          }
        }
      }
    } catch (Exception e) {
      call.reject("Write failed: " + e.getMessage(), e);
      return;
    }
    JSObject ret = new JSObject();
    ret.put("ok", ok);
    call.resolve(ret);
  }

  @RequiresApi(api = Build.VERSION_CODES.LOLLIPOP)
  private Uri findOrCreateSubfolder(Uri treeUri, String sub) {
    String baseId = DocumentsContract.getTreeDocumentId(treeUri);
    Uri root = DocumentsContract.buildDocumentUriUsingTree(treeUri, baseId);
    // Try to find existing sub-folder.
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, baseId);
    try (android.database.Cursor c = getContext().getContentResolver().query(
        children, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_DOCUMENT_ID },
        null, null, null)) {
      while (c != null && c.moveToNext()) {
        if (sub.equals(c.getString(0))) {
          return DocumentsContract.buildDocumentUriUsingTree(treeUri, c.getString(1));
        }
      }
    } catch (Exception ignored) {
    }
    // Create it.
    try {
      return DocumentsContract.createDocument(
          getContext().getContentResolver(), root,
          DocumentsContract.Document.MIME_TYPE_DIR, sub);
    } catch (Exception e) {
      return null;
    }
  }

  private static String sanitize(String s) {
    return s.replaceAll("[^a-zA-Z0-9._-]", "_");
  }

  /** Open the system dialog to exempt this app from battery optimization. */
  @PluginMethod
  public void requestBatteryExemption(PluginCall call) {
    try {
      Intent intent = new Intent();
      String pkg = getContext().getPackageName();
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        android.os.PowerManager pm =
            (android.os.PowerManager) getContext().getSystemService(
                android.content.Context.POWER_SERVICE);
        if (pm != null && pm.isIgnoringBatteryOptimizations(pkg)) {
          // Already exempt — resolve immediately.
          call.resolve(new JSObject().put("alreadyExempt", true));
          return;
        }
        intent.setAction(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + pkg));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve(new JSObject().put("alreadyExempt", false));
      } else {
        call.resolve(new JSObject().put("alreadyExempt", true));
      }
    } catch (Exception e) {
      call.reject("Unable to open battery settings: " + e.getMessage(), e);
    }
  }

  private static final String KEY_STORAGE_MODE = "storage_mode";

  /**
   * Persist the user's chosen storage mode. mode is "saf" (new SAF folder) or
   * "virtual" (old internal storage). Selecting "virtual" clears any persisted
   * SAF tree URI so the app falls back to its virtual directory.
   */
  @PluginMethod
  public void setStorageMode(PluginCall call) {
    String mode = call.getString("mode", "saf");
    if (!"saf".equals(mode) && !"virtual".equals(mode)) {
      mode = "saf";
    }
    try {
      SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
      prefs.edit().putString(KEY_STORAGE_MODE, mode).apply();
      if ("virtual".equals(mode)) {
        // Drop the SAF tree so writes go to the virtual directory.
        String old = prefs.getString(KEY_TREE_URI, null);
        if (old != null) {
          try {
            Uri oldUri = Uri.parse(old);
            getContext().getContentResolver()
                .releasePersistableUriPermission(oldUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
          } catch (Exception ignored) {
          }
          prefs.edit().remove(KEY_TREE_URI).apply();
        }
      }
      JSObject ret = new JSObject();
      ret.put("mode", mode);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to set storage mode: " + e.getMessage(), e);
    }
  }

  /** Read the previously chosen storage mode (defaults to "saf"). */
  @PluginMethod
  public void getStorageMode(PluginCall call) {
    try {
      SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
      String mode = prefs.getString(KEY_STORAGE_MODE, "saf");
      JSObject ret = new JSObject();
      ret.put("mode", mode);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to read storage mode: " + e.getMessage(), e);
    }
  }
}
