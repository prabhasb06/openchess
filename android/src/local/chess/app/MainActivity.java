package local.chess.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.view.HapticFeedbackConstants;
import android.webkit.*;
import android.widget.*;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** The bundled app can use on-device Stockfish or an explicitly paired computer. */
public class MainActivity extends Activity {
  private static final String ORIGIN = "appassets.androidplatform.net";
  private WebView web;
  private SharedPreferences config;
  private OfflineStockfish offlineEngine;
  private final ExecutorService workers = Executors.newFixedThreadPool(3);
  private final ConcurrentHashMap<String, Socket> connections = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, AtomicBoolean> requests = new ConcurrentHashMap<>();
  private ValueCallback<Uri[]> fileCallback;
  private String pendingExport;
  private Runnable unregisterBack = () -> {};

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    config = getSharedPreferences("engine", MODE_PRIVATE);
    offlineEngine = new OfflineStockfish(new File(getApplicationInfo().nativeLibraryDir));
    web = new WebView(this);
    web.setBackgroundColor(Color.rgb(48, 46, 43));
    FrameLayout frame = new FrameLayout(this);
    frame.setBackgroundColor(Color.rgb(38, 36, 33));
    frame.addView(web, new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (Build.VERSION.SDK_INT < 35) enableLegacyEdgeToEdge();
      frame.setOnApplyWindowInsetsListener((view, insets) -> {
        android.graphics.Insets usable = insets.getInsets(
            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
        view.setPadding(usable.left, usable.top, usable.right, usable.bottom);
        return WindowInsets.CONSUMED;
      });
    }
    setContentView(frame);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
      unregisterBack = PredictiveBack.register(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    // ACTION_OPEN_DOCUMENT grants access only to the file the player picks.
    settings.setAllowContentAccess(true);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setSupportMultipleWindows(false);
    web.addJavascriptInterface(new Bridge(), "ChessLocalAndroid");
    web.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        Uri uri = req.getUrl();
        if (!"https".equals(uri.getScheme()) || !ORIGIN.equals(uri.getHost())) return response(403, "External resource blocked");
        String path = uri.getPath();
        if (path == null || path.equals("/")) path = "/android.html";
        if (path.contains("..") || path.contains("\\") || !req.getMethod().equals("GET")) return response(403, "Invalid local path");
        try {
          String mime = URLConnection.guessContentTypeFromName(path);
          if (path.endsWith(".js") || path.endsWith(".mjs")) mime = "text/javascript";
          if (path.endsWith(".css")) mime = "text/css";
          if (path.endsWith(".svg")) mime = "image/svg+xml";
          if (path.endsWith(".json")) mime = "application/json";
          if (path.endsWith(".woff2")) mime = "font/woff2";
          if (path.endsWith(".woff")) mime = "font/woff";
          if (path.endsWith(".wasm")) mime = "application/wasm";
          if (path.endsWith(".wav")) mime = "audio/wav";
          if (mime == null) mime = "application/octet-stream";
          return new WebResourceResponse(mime, "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-cache"), getAssets().open("www" + path));
        } catch (IOException error) { return response(404, "Bundled file not found"); }
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        Uri uri = req.getUrl();
        if ("https".equals(uri.getScheme()) && ORIGIN.equals(uri.getHost())) return false;
        if (req.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
          try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
        }
        return true;
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        try { startActivityForResult(intent, 20); } catch (Exception e) { callback.onReceiveValue(null); fileCallback = null; }
        return true;
      }
    });
    if (state == null || web.restoreState(state) == null) web.loadUrl("https://" + ORIGIN + "/android.html#home");
  }

  @SuppressWarnings("deprecation") // Android 11–14 opt-in. Target SDK 35 enforces this on newer Android.
  private void enableLegacyEdgeToEdge() {
    getWindow().setDecorFitsSystemWindows(false);
  }

  private WebResourceResponse response(int code, String text) {
    return new WebResourceResponse("text/plain", "UTF-8", code, code == 404 ? "Not Found" : "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
  }
  private void reply(String id, int status, String body) {
    try {
      JSONObject result = new JSONObject().put("status", status).put("body", body);
      runOnUiThread(() -> { if (!isDestroyed()) web.evaluateJavascript("window.__chessNativeResponse && window.__chessNativeResponse(" + JSONObject.quote(id) + "," + result + ")", null); });
    } catch (Exception ignored) { }
  }
  private String error(String text) { try { return new JSONObject().put("error", text).toString(); } catch (Exception e) { return "{}"; } }
  private boolean usesOnDeviceEngine() {
    return offlineEngine.available() && !config.getBoolean("useComputer", false);
  }
  static String validateServer(String input) {
    return LanEngineConnection.validateServer(input);
  }

  private final class Bridge {
    @JavascriptInterface public void haptic() {
      runOnUiThread(() -> web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP));
    }
    @JavascriptInterface public void copyText(String text) {
      if (text.length() > 200000) return;
      runOnUiThread(() -> {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("PGN", text));
      });
    }
    @JavascriptInterface public String getConfig() {
      try {
        String server = config.getString("server", "");
        return new JSONObject()
            .put("server", server)
            .put("configured", !server.isEmpty())
            .put("onDevice", usesOnDeviceEngine())
            .put("offlineAvailable", offlineEngine.available())
            .toString();
      } catch (Exception e) { return "{}"; }
    }
    @JavascriptInterface public void configure() { runOnUiThread(() -> showConfiguration()); }
    @JavascriptInterface public void cancel(String id) {
      AtomicBoolean cancelled = requests.get(id);
      if (cancelled == null) return;
      cancelled.set(true);
      Socket connection = connections.remove(id);
      if (connection != null) closeConnection(connection);
    }
    @JavascriptInterface public void request(String id, String path, String method, String body) {
      if (!(path.equals("/api/health") && method.equals("GET") || path.equals("/api/engine") && method.equals("POST")) || body.length() > 1048576) { reply(id, 400, error("Invalid mobile engine request")); return; }
      AtomicBoolean cancelled = new AtomicBoolean();
      if (requests.putIfAbsent(id, cancelled) != null) return;
      workers.execute(() -> {
        try {
          if (cancelled.get()) return;
          if (usesOnDeviceEngine()) {
            try {
              JSONObject result = path.equals("/api/health")
                  ? offlineEngine.health()
                  : offlineEngine.analyze(body, cancelled::get);
              if (!cancelled.get()) reply(id, 200, result.toString());
            } catch (OfflineStockfish.SearchException failure) {
              if (!cancelled.get()) reply(id, failure.status, error(failure.getMessage()));
            } catch (Exception failure) {
              if (!cancelled.get()) reply(id, 503, error("On-device Stockfish could not finish this search."));
            }
            return;
          }
          String server = validateServer(config.getString("server", ""));
          if (server.isEmpty()) { reply(id, 503, error("Connect your computer in Mobile engine settings to use Stockfish. Local play, puzzles and lessons work offline.")); return; }
          try (Socket connection = new Socket(Proxy.NO_PROXY)) {
            connections.put(id, connection);
            if (cancelled.get()) return;
            LanEngineConnection.Response result = LanEngineConnection.exchange(
                connection, server, path, method, body, config.getString("token", ""));
            if (!cancelled.get()) reply(id, result.status(), result.body());
          }
        } catch (Exception e) {
          if (!cancelled.get()) reply(id, 503, error("The engine could not complete the request. Check Mobile engine settings and try again."));
        } finally {
          connections.remove(id);
          requests.remove(id, cancelled);
        }
      });
    }
    @JavascriptInterface public void saveFile(String name, String text) {
      if (text.length() > 4194304) return;
      runOnUiThread(() -> {
        if (pendingExport != null) { Toast.makeText(MainActivity.this, "Finish the current file export first", Toast.LENGTH_SHORT).show(); return; }
        pendingExport = text;
        String filename = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        String mimeType = filename.toLowerCase(Locale.ROOT).endsWith(".pgn")
            ? "application/x-chess-pgn" : "text/plain";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, filename);
        try { startActivityForResult(intent, 21); } catch (Exception e) { pendingExport = null; Toast.makeText(MainActivity.this, "No file picker available", Toast.LENGTH_LONG).show(); }
      });
    }
  }
  private void showConfiguration() {
    LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) (20 * getResources().getDisplayMetrics().density); layout.setPadding(pad, pad / 2, pad, 0);
    TextView help = new TextView(this); help.setText("Stockfish can run on this phone. To use your computer instead, run start-mobile.cmd there and enter its address and pairing token on the same Wi-Fi.");
    EditText server = new EditText(this); server.setHint("192.168.1.20:3002"); server.setSingleLine(true); server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI); server.setText(config.getString("server", ""));
    EditText token = new EditText(this); token.setHint("Pairing token"); token.setSingleLine(true); token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); token.setText(config.getString("token", ""));
    layout.addView(help); layout.addView(server); layout.addView(token);
    AlertDialog.Builder builder = new AlertDialog.Builder(this).setTitle("Mobile engine settings").setView(layout).setNegativeButton("Cancel", null).setPositiveButton("Save", null);
    if (offlineEngine.available()) builder.setNeutralButton("Use on device", (picker, button) -> {
      config.edit().putBoolean("useComputer", false).apply();
      web.evaluateJavascript("window.__chessNativeConfigured && window.__chessNativeConfigured()", null);
    });
    AlertDialog dialog = builder.create();
    dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
      try {
        String value = validateServer(server.getText().toString());
        config.edit().putString("server", value).putString("token", token.getText().toString().trim()).putBoolean("useComputer", !value.isEmpty()).apply();
        web.evaluateJavascript("window.__chessNativeConfigured && window.__chessNativeConfigured()", null);
        dialog.dismiss();
        Toast.makeText(this, value.isEmpty() ? "On-device engine selected" : "Computer connection saved", Toast.LENGTH_SHORT).show();
      } catch (IllegalArgumentException e) { server.setError(e.getMessage()); }
    }));
    dialog.show();
  }
  @Override protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == 20 && fileCallback != null) {
      ValueCallback<Uri[]> callback = fileCallback;
      fileCallback = null;
      Uri picked = result == RESULT_OK && data != null ? data.getData() : null;
      callback.onReceiveValue(picked == null ? null : new Uri[] {picked});
    }
    if (request == 21) {
      String text = pendingExport; pendingExport = null;
      Uri destination = result == RESULT_OK && data != null ? data.getData() : null;
      if (destination != null && text != null) {
        try (OutputStream output = getContentResolver().openOutputStream(destination)) {
          if (output == null) throw new IOException("Document provider did not open the file");
          output.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
          Toast.makeText(this, "Could not save file", Toast.LENGTH_LONG).show();
          return;
        }
        Toast.makeText(this, "File saved", Toast.LENGTH_SHORT).show();
      }
    }
  }
  @Override @SuppressWarnings("deprecation") // Android 8–12L delivers Back through this callback.
  public void onBackPressed() {
    handleBack();
  }

  private static final class PredictiveBack {
    static Runnable register(MainActivity activity) {
      OnBackInvokedDispatcher dispatcher = activity.getOnBackInvokedDispatcher();
      OnBackInvokedCallback callback = activity::handleBack;
      dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
      return () -> dispatcher.unregisterOnBackInvokedCallback(callback);
    }
  }

  private void handleBack() {
    web.evaluateJavascript("(function(){ if(typeof window.__chessNativeBack==='function') return window.__chessNativeBack() ? 'handled' : 'exit'; return 'history'; })()", result -> {
      if (isDestroyed() || "\"handled\"".equals(result)) return;
      if ("\"exit\"".equals(result)) { finish(); return; }
      if (web.canGoBack()) web.goBack(); else finish();
    });
  }
  @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
  @Override protected void onPause() { web.onPause(); super.onPause(); }
  @Override protected void onResume() { super.onResume(); web.onResume(); }
  private static void closeConnection(Socket socket) {
    try { socket.close(); } catch (IOException ignored) {}
  }

  @Override protected void onDestroy() {
    unregisterBack.run();
    offlineEngine.close();
    for (Socket socket : connections.values()) closeConnection(socket);
    workers.shutdownNow();
    web.removeJavascriptInterface("ChessLocalAndroid");
    web.destroy();
    super.onDestroy();
  }
}
