package in.successonline.smsobserver;

public class WorldlineFormatTest {
  public static void main(String[] args) {
    String old="Rs. 1.00 received on 16-11-2026 18:27:23 for BQR-UPI/2695306A/7558548187@axl. RRN#538819093376 - Worldline India";
    String current="Rs. 100.00 received on 17-11-2026 14:37:32 for BQR-UPI/ICI2fe38efec2ac4b47bacced15fffb1ab4/rajvardhanpatil411-2@okicici. RRN#632149985208 - Worldline India";
    assert WorldlineFormat.bodyAllowed(old);
    assert WorldlineFormat.bodyAllowed(current);
    assert WorldlineFormat.bodyAllowed(current.replace("received on","received\n on"));
    assert WorldlineFormat.senderAllowed("JD-WLITXS-S");
    assert WorldlineFormat.senderAllowed("VK-WLITXS-S");
    assert !WorldlineFormat.senderAllowed("9876543210");
    assert !WorldlineFormat.senderAllowed("JD-OTHER-S");
    assert !WorldlineFormat.bodyAllowed(current.replace("received","debited"));
    assert !WorldlineFormat.bodyAllowed(current+" Pay now");
    assert !WorldlineFormat.bodyAllowed(current.replace("632149985208","63214998520"));
    assert !WorldlineFormat.bodyAllowed(current.replace("ICI2fe38efec2ac4b47bacced15fffb1ab4","UNKNOWN"));
    String qr="Rs. 100.18 received on 17-11-2026 16:31:19 for BQR-UPI/T2611171631153817279676/7558548187-4@axl. RRN#437047702379 - Worldline India";
    String phonepe="Rs. 100.18 received on 17-11-2026 16:28:09 for BQR-UPI/T2611171628050335728295/7558548187-4@ybl. RRN#655189709258 - Worldline India";
    for(String alert:new String[]{qr,phonepe}) {
      assert WorldlineFormat.bodyAllowed(alert);
      for(String suffix:new String[]{" ","\u00a0","&#x20;","&#32;","&nbsp;"})assert WorldlineFormat.bodyAllowed(alert+suffix);
      for(String handle:new String[]{"axl","ybl","ibl","okicici","oksbi","okaxis","okhdfcbank","paytm","ptyes","apl","upi","newbank"}) {
        assert WorldlineFormat.bodyAllowed(alert.replaceAll("@[a-z]+", "@"+handle));
      }
      assert !WorldlineFormat.bodyAllowed(alert.replace("received","pending"));
      assert !WorldlineFormat.bodyAllowed(alert.replace("received","failed"));
      assert !WorldlineFormat.bodyAllowed(alert.replace("T261117","X261117"));
      assert !WorldlineFormat.bodyAllowed(alert.replace("T261117","T26117"));
      assert !WorldlineFormat.bodyAllowed(alert.replace("T261117","T0261117"));
    }
    System.out.println("Android Worldline filter checks passed");
  }
}
