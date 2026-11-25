package local.chess.app;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** The optional computer engine uses a direct connection to a validated private IPv4 address. */
final class LanEngineConnection {
  private static final int MAX_HEADERS = 16384;
  private static final int MAX_BODY = 4194304;

  record Response(int status, String body) {}

  static String validateServer(String input) {
    String value = input.trim();
    if (value.isEmpty()) return "";
    if (!value.startsWith("http://")) value = "http://" + value;
    try {
      URI uri = URI.create(value);
      if (!"http".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getQuery() != null
          || uri.getFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))
        throw new IllegalArgumentException();
      int[] address = privateAddress(uri.getHost());
      int port = uri.getPort() == -1 ? 3002 : uri.getPort();
      if (port < 1024 || port > 65535) throw new IllegalArgumentException();
      return "http://" + address[0] + "." + address[1] + "." + address[2] + "." + address[3] + ":" + port;
    } catch (IllegalArgumentException invalid) {
      throw new IllegalArgumentException("Use your computer's private IPv4 address and port, for example 192.168.1.20:3002.");
    }
  }

  private static int[] privateAddress(String host) {
    if (host == null || !host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}"))
      throw new IllegalArgumentException();
    String[] parts = host.split("\\.");
    int[] address = new int[4];
    for (int i = 0; i < address.length; i++) {
      address[i] = Integer.parseInt(parts[i]);
      if (address[i] > 255) throw new IllegalArgumentException();
    }
    if (!(address[0] == 10 || (address[0] == 172 && address[1] >= 16 && address[1] <= 31)
        || (address[0] == 192 && address[1] == 168))) throw new IllegalArgumentException();
    return address;
  }

  static Response exchange(Socket socket, String server, String path, String method, String body, String token) throws IOException {
    if (!("GET".equals(method) && "/api/health".equals(path) || "POST".equals(method) && "/api/engine".equals(path)))
      throw new IllegalArgumentException("Invalid engine endpoint.");
    if (token.length() > 1024 || !token.matches("[\\x20-\\x7e]*"))
      throw new IllegalArgumentException("Invalid connection code.");
    URI target = URI.create(validateServer(server) + path);
    int[] address = privateAddress(target.getHost());
    byte[] octets = {(byte) address[0], (byte) address[1], (byte) address[2], (byte) address[3]};
    socket.connect(new InetSocketAddress(InetAddress.getByAddress(octets), target.getPort()), 7000);
    socket.setSoTimeout(120000);

    // The paired Node server returns a close-delimited response to HTTP/1.0.
    byte[] payload = "POST".equals(method) ? body.getBytes(StandardCharsets.UTF_8) : new byte[0];
    String headers = method + " " + target.getRawPath() + " HTTP/1.0\r\nHost: " + target.getRawAuthority()
        + "\r\nConnection: close\r\nX-Chess-Token: " + token + "\r\n";
    if ("POST".equals(method)) {
      headers += "Content-Type: application/json\r\nContent-Length: " + payload.length + "\r\n";
    }
    OutputStream request = socket.getOutputStream();
    request.write((headers + "\r\n").getBytes(StandardCharsets.US_ASCII));
    request.write(payload);
    request.flush();

    InputStream response = new BufferedInputStream(socket.getInputStream());
    String[] lines = readHeaders(response).split("\r\n");
    String[] statusLine = lines[0].split(" ", 3);
    if (statusLine.length < 2 || !statusLine[0].matches("HTTP/1\\.[01]") || !statusLine[1].matches("[2-5][0-9]{2}"))
      throw new IOException("Invalid engine response.");
    int status = Integer.parseInt(statusLine[1]);
    int length = -1;
    for (int i = 1; i < lines.length; i++) {
      int separator = lines[i].indexOf(':');
      if (separator < 1) throw new IOException("Invalid engine response header.");
      String name = lines[i].substring(0, separator).toLowerCase(Locale.ROOT);
      if ("transfer-encoding".equals(name)) throw new IOException("Unexpected engine transfer encoding.");
      if ("content-length".equals(name)) {
        String value = lines[i].substring(separator + 1).trim();
        if (length >= 0 || !value.matches("[0-9]{1,7}")) throw new IOException("Invalid engine response length.");
        length = Integer.parseInt(value);
        if (length > MAX_BODY) throw new IOException("Engine response too large.");
      }
    }

    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    while (length < 0 || bytes.size() < length) {
      int limit = length < 0 ? buffer.length : Math.min(buffer.length, length - bytes.size());
      int count = response.read(buffer, 0, limit);
      if (count < 0) break;
      if (bytes.size() + count > MAX_BODY) throw new IOException("Engine response too large.");
      bytes.write(buffer, 0, count);
    }
    if (length >= 0 && bytes.size() != length) throw new IOException("Incomplete engine response.");
    return new Response(status, new String(bytes.toByteArray(), StandardCharsets.UTF_8));
  }

  private static String readHeaders(InputStream input) throws IOException {
    ByteArrayOutputStream headers = new ByteArrayOutputStream();
    int lastFour = 0;
    for (int value; headers.size() < MAX_HEADERS && (value = input.read()) >= 0; ) {
      headers.write(value);
      lastFour = (lastFour << 8) | value;
      if (lastFour == 0x0d0a0d0a) return new String(headers.toByteArray(), StandardCharsets.US_ASCII);
    }
    throw new IOException("Invalid or oversized engine response headers.");
  }
}
