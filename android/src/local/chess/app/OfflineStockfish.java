package local.chess.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.TreeMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Runs the bundled Stockfish executable over UCI, with one search at a time. */
public final class OfflineStockfish implements AutoCloseable {
  private static final long POLL_MS = 12;
  private static final long QUEUE_WAIT_MS = 4000;
  private static final long STARTUP_ALLOWANCE_MS = 25000;
  private static final long SEARCH_ALLOWANCE_MS = 10000;
  private static final int OUTPUT_LIMIT = 1_000_000;
  private static final Pattern MOVE = Pattern.compile("[a-h][1-8][a-h][1-8][qrbn]?");
  private static final Pattern SCORE = Pattern.compile("\\bscore (cp|mate) (-?\\d+)");
  private static final Pattern DEPTH = Pattern.compile("\\bdepth (\\d+)");
  private static final Pattern MULTI_PV = Pattern.compile("\\bmultipv (\\d+)");
  private static final Pattern LINE = Pattern.compile("\\bpv (.+)$");

  public static final class SearchException extends IOException {
    public final int status;

    SearchException(int status, String message) {
      super(message);
      this.status = status;
    }
  }

  private final File executable;
  private final Semaphore slot = new Semaphore(1, true);
  private final AtomicReference<Process> active = new AtomicReference<>();
  private String previousVariant;
  private volatile boolean closed;

  public OfflineStockfish(File nativeLibraryDir) {
    executable = new File(nativeLibraryDir, "libstockfish.so").getAbsoluteFile();
  }

  public boolean available() {
    return !closed && executable.isFile() && executable.canExecute();
  }

  public JSONObject health() throws JSONException {
    JSONObject result = new JSONObject()
        .put("ok", available())
        .put("engine", "Stockfish")
        .put("version", "18")
        .put("onDevice", true)
        .put("installation", "Android device");
    if (!result.getBoolean("ok")) result.put("error", "On-device Stockfish is unavailable.");
    return result;
  }

  public JSONObject analyze(String requestJson, BooleanSupplier cancelled) throws Exception {
    Search search = Search.parse(requestJson);
    checkCancelled(cancelled);
    if (!available()) throw new SearchException(503, "On-device Stockfish is unavailable.");
    long queueDeadline = afterMillis(QUEUE_WAIT_MS);
    while (!slot.tryAcquire(POLL_MS, TimeUnit.MILLISECONDS)) {
      checkCancelled(cancelled);
      if (System.nanoTime() >= queueDeadline)
        throw new SearchException(429, "On-device Stockfish is busy. Try again in a moment.");
    }

    Process child = active.get();
    boolean completed = false;
    try {
      checkCancelled(cancelled);
      boolean fresh = child == null || !child.isAlive();
      if (fresh) {
        child = new ProcessBuilder(executable.getPath())
            .directory(executable.getParentFile())
            .redirectErrorStream(true)
            .start();
        active.set(child);
      }
      checkCancelled(cancelled);
      JSONObject result = runSearch(child, fresh, search, cancelled);
      completed = true;
      return result;
    } catch (SearchException failure) {
      throw failure;
    } catch (IOException failure) {
      checkCancelled(cancelled);
      throw new SearchException(503, "On-device Stockfish could not complete the search.");
    } finally {
      try {
        if (!completed && child != null) {
          child.destroyForcibly();
          active.compareAndSet(child, null);
          child.waitFor(250, TimeUnit.MILLISECONDS);
        }
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
      } finally {
        slot.release();
      }
    }
  }

  @Override public void close() {
    closed = true;
    Process child = active.getAndSet(null);
    if (child != null) child.destroyForcibly();
  }

  private JSONObject runSearch(Process child, boolean fresh, Search search, BooleanSupplier cancelled) throws Exception {
    long deadline = afterMillis(search.moveTime + (fresh ? STARTUP_ALLOWANCE_MS : SEARCH_ALLOWANCE_MS));
    TreeMap<Integer, JSONObject> variations = new TreeMap<>();
    Integer terminalMate = null;
    {
      InputStream output = child.getInputStream();
      OutputStream input = child.getOutputStream();
      EngineOutput lines = new EngineOutput(child, output, cancelled, deadline);
      if (fresh) {
        send(input, "uci");
        lines.await("uciok");
        send(input, "setoption name Threads value 1", "setoption name Hash value 16");
      }
      send(input,
          "setoption name Skill Level value " + search.skill,
          "setoption name MultiPV value " + search.multiPv,
          "setoption name UCI_Chess960 value " + search.variant.equals("chess960"));
      if (fresh || !search.variant.equals(previousVariant)) send(input, "ucinewgame");
      previousVariant = search.variant;
      send(input, "isready");
      lines.await("readyok");
      send(input, "position fen " + search.fen, "go movetime " + search.moveTime
          + (search.depth == 0 ? "" : " depth " + search.depth)
          + (search.rootMove == null ? "" : " searchmoves " + search.rootMove));

      for (String line = lines.next(); ; line = lines.next()) {
        if (line.startsWith("bestmove ")) {
          String bestMove = line.split("\\s+", 3)[1];
          if (bestMove.equals("(none)") || bestMove.equals("0000")) bestMove = null;
          if (bestMove != null && !MOVE.matcher(bestMove).matches())
            throw new SearchException(503, "On-device Stockfish returned an invalid move.");
          JSONObject best = variations.get(1);
          Object mate = best == null ? terminalMate : best.opt("mate");
          Object evaluation = best == null ? (terminalMate == null ? 0.0 : JSONObject.NULL) : best.opt("score");
          return new JSONObject()
              .put("bestmove", bestMove == null ? JSONObject.NULL : bestMove)
              .put("evaluation", evaluation)
              .put("mate", mate == null ? JSONObject.NULL : mate)
              .put("depth", best == null ? 0 : best.optInt("depth"))
              .put("lines", new JSONArray(variations.values()))
              .put("engine", "Stockfish")
              .put("variant", search.variant)
              .put("scorePerspective", "white");
        }
        if (!line.startsWith("info depth ")) continue;
        Matcher score = SCORE.matcher(line);
        if (!score.find()) continue;
        int value = Integer.parseInt(score.group(2)) * search.sign;
        boolean mate = score.group(1).equals("mate");
        Matcher pv = LINE.matcher(line);
        int depth = readNumber(DEPTH, line, 0);
        if (!pv.find()) {
          if (depth == 0 && mate) terminalMate = value;
          continue;
        }
        int index = readNumber(MULTI_PV, line, 1);
        if (index < 1 || index > search.multiPv) continue;
        JSONArray moves = new JSONArray();
        for (String move : pv.group(1).trim().split("\\s+")) {
          if (!MOVE.matcher(move).matches())
            throw new SearchException(503, "On-device Stockfish returned an invalid move.");
          moves.put(move);
        }
        variations.put(index, new JSONObject()
            .put("pv", moves)
            .put("score", mate ? JSONObject.NULL : value / 100.0)
            .put("mate", mate ? value : JSONObject.NULL)
            .put("depth", depth));
      }
    }
  }

  private static void send(OutputStream input, String... commands) throws IOException {
    input.write((String.join("\n", commands) + "\n").getBytes(StandardCharsets.US_ASCII));
    input.flush();
  }

  private static int readNumber(Pattern pattern, String line, int fallback) {
    Matcher match = pattern.matcher(line);
    return match.find() ? Integer.parseInt(match.group(1)) : fallback;
  }

  private static long afterMillis(long timeout) {
    return System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeout);
  }

  private void checkCancelled(BooleanSupplier cancelled) throws SearchException {
    if (closed || Thread.currentThread().isInterrupted() || cancelled.getAsBoolean())
      throw new SearchException(499, "The on-device engine search was cancelled.");
  }

  /** Reads only bytes already available so cancellation never waits for a complete line. */
  private final class EngineOutput {
    private final Process child;
    private final InputStream output;
    private final BooleanSupplier cancelled;
    private final long deadline;
    private final byte[] chunk = new byte[4096];
    private final ByteArrayOutputStream line = new ByteArrayOutputStream();
    private int cursor, length, total;

    EngineOutput(Process child, InputStream output, BooleanSupplier cancelled, long deadline) {
      this.child = child;
      this.output = output;
      this.cancelled = cancelled;
      this.deadline = deadline;
    }

    void await(String response) throws Exception {
      while (!next().equals(response)) {}
    }

    String next() throws Exception {
      while (true) {
        checkCancelled(cancelled);
        if (System.nanoTime() >= deadline)
          throw new SearchException(504, "The on-device engine search timed out. Try again.");
        if (cursor == length) {
          int readable = output.available();
          if (readable == 0) {
            if (!child.isAlive() && output.available() == 0)
              throw new SearchException(503, "On-device Stockfish stopped before completing the search.");
            Thread.sleep(POLL_MS);
            continue;
          }
          length = output.read(chunk, 0, Math.min(chunk.length, readable));
          if (length < 0)
            throw new SearchException(503, "On-device Stockfish stopped before completing the search.");
          total += length;
          if (total > OUTPUT_LIMIT)
            throw new SearchException(503, "On-device Stockfish exceeded its output limit.");
          cursor = 0;
        }
        while (cursor < length) {
          byte value = chunk[cursor++];
          if (value == '\n') {
            String result = new String(line.toByteArray(), StandardCharsets.US_ASCII).trim();
            line.reset();
            return result;
          }
          line.write(value);
          if (line.size() > 16384)
            throw new SearchException(503, "On-device Stockfish returned an oversized response.");
        }
      }
    }
  }

  private static final class Search {
    final String fen, variant;
    final int moveTime, skill, multiPv, sign, depth;
    final String rootMove;

    Search(String fen, String variant, int moveTime, int skill, int multiPv, int sign, int depth, String rootMove) {
      this.fen = fen;
      this.variant = variant;
      this.moveTime = moveTime;
      this.skill = skill;
      this.multiPv = multiPv;
      this.sign = sign;
      this.depth = depth;
      this.rootMove = rootMove;
    }

    static Search parse(String json) throws SearchException {
      if (json == null || json.length() > 32768)
        throw new SearchException(400, "Send a JSON object with the position.");
      JSONObject options;
      try {
        options = new JSONObject(json);
      } catch (JSONException invalid) {
        throw new SearchException(400, "Send a JSON object with the position.");
      }
      Object variant = options.has("variant") ? options.opt("variant") : "standard";
      if (!"standard".equals(variant) && !"chess960".equals(variant))
        throw new SearchException(400, "Choose standard chess or Chess960.");
      String name = (String) variant;
      Object value = options.opt("fen");
      if (!(value instanceof String)) throw invalidFen();
      String fen = (String) value;
      if (fen.length() > 200 || !fen.matches("[a-zA-Z0-9/ -]+")) throw invalidFen();
      String[] fields = fen.trim().split(" +");
      if (fields.length != 6 || !fields[1].matches("[wb]")) throw invalidFen();
      validateBoard(fields[0]);
      String castling = fields[2];
      String rights = name.equals("chess960") ? "(?:[KQkqA-Ha-h]{1,8}|-)" : "(?:K?Q?k?q?|-)";
      if (!castling.matches(rights) || castling.chars().distinct().count() != castling.length())
        throw invalidFen();
      if (!fields[3].matches(fields[1].equals("w") ? "(?:[a-h]6|-)" : "(?:[a-h]3|-)")
          || !fields[4].matches("[0-9]{1,6}") || !fields[5].matches("[0-9]{1,6}")
          || Integer.parseInt(fields[5]) < 1)
        throw invalidFen();
      String rootMove = options.optString("rootMove", "");
      if (!rootMove.isEmpty() && !MOVE.matcher(rootMove).matches())
        throw new SearchException(400, "Invalid root move.");
      return new Search(String.join(" ", fields), name,
          bounded(options, "movetime", 500, 50, 3000),
          bounded(options, "skill", 10, 0, 20),
          bounded(options, "multiPv", 1, 1, 3),
          fields[1].equals("w") ? 1 : -1,
          bounded(options, "depth", 0, 0, 24),
          rootMove.isEmpty() ? null : rootMove);
    }

    private static void validateBoard(String board) throws SearchException {
      String[] ranks = board.split("/", -1);
      if (ranks.length != 8) throw invalidFen();
      int whiteKing = -1, blackKing = -1;
      for (int row = 0; row < ranks.length; row++) {
        int squares = 0;
        for (char c : ranks[row].toCharArray()) {
          if (c >= '1' && c <= '8') squares += c - '0';
          else if ("prnbqkPRNBQK".indexOf(c) >= 0) {
            if ((c == 'p' || c == 'P') && (row == 0 || row == 7)) throw invalidFen();
            if (c == 'K') {
              if (whiteKing != -1) throw invalidFen();
              whiteKing = row * 8 + squares;
            }
            if (c == 'k') {
              if (blackKing != -1) throw invalidFen();
              blackKing = row * 8 + squares;
            }
            squares++;
          } else throw invalidFen();
        }
        if (squares != 8) throw invalidFen();
      }
      if (whiteKing < 0 || blackKing < 0
          || (Math.abs(whiteKing / 8 - blackKing / 8) <= 1
              && Math.abs(whiteKing % 8 - blackKing % 8) <= 1)) throw invalidFen();
    }

    private static int bounded(JSONObject options, String name, int fallback, int min, int max)
        throws SearchException {
      Object value = options.opt(name);
      if (value == null || value == JSONObject.NULL) return fallback;
      if (value instanceof Number) {
        double number = ((Number) value).doubleValue();
        if (number >= min && number <= max && number == (int) number) return (int) number;
      }
      throw new SearchException(400, name + " must be an integer from " + min + " to " + max + ".");
    }

    private static SearchException invalidFen() {
      return new SearchException(400, "The FEN position is invalid.");
    }
  }
}
