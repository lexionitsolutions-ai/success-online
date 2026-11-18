package in.successonline.smsobserver;

import java.util.Locale;

// Pure formatting rules shared by new-SMS capture and the explicit inbox recovery action.
final class WorldlineFormat {
  static boolean senderAllowed(String sender) {
    return sender!=null && sender.trim().toUpperCase(Locale.US).matches("^(?:[A-Z]{2}-)?WLITXS-S$");
  }
  static String normalize(String text) {
    return text==null?"":text.replaceAll("(?i)&(?:#x20|#32|nbsp);", " ").replace((char)160,' ').replaceAll("\\s+"," ").trim();
  }
  static boolean bodyAllowed(String text) {
    if(text==null || text.length()>512)return false;
    return normalize(text).matches("^Rs\\.?\\s*[0-9]{1,7}(?:\\.[0-9]{1,2})? received on [0-9]{2}-[0-9]{2}-[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} for BQR-UPI/(?:2695306A|ICI[a-f0-9]{32}|T[0-9]{22})/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\\. RRN#[0-9]{12} - Worldline India$");
  }
}
