package in.successonline.smsobserver;

import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;

final class SignedRequest {
  static final class Result {
    final int status;final JSONObject body;
    Result(int status,JSONObject body){this.status=status;this.body=body;}
  }
  static Result post(JSONObject config,JSONObject payload) throws Exception {
    byte[] body=payload.toString().getBytes(StandardCharsets.UTF_8);
    String timestamp=Long.toString(System.currentTimeMillis()),secret=config.getString("key");
    byte[] key=new byte[secret.length()/2];for(int i=0;i<key.length;i++)key[i]=(byte)Integer.parseInt(secret.substring(i*2,i*2+2),16);
    Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));mac.update((timestamp+".").getBytes(StandardCharsets.UTF_8));
    StringBuilder signature=new StringBuilder();for(byte b:mac.doFinal(body))signature.append(String.format(java.util.Locale.US,"%02x",b & 255));
    return send(config.getString("url")+"/api/sms-observer/events",body,config.getString("device"),timestamp,signature.toString());
  }
  static Result pair(JSONObject bootstrap,String installation) throws Exception {
    JSONObject payload=new JSONObject().put("token",bootstrap.getString("token")).put("deviceId",bootstrap.getString("deviceId")).put("installationId",installation);
    return send(bootstrap.getString("url")+"/api/sms-observer/pair",payload.toString().getBytes(StandardCharsets.UTF_8),null,null,null);
  }
  private static Result send(String endpoint,byte[] body,String device,String timestamp,String signature) throws Exception {
    HttpsURLConnection connection=(HttpsURLConnection)new URL(endpoint).openConnection();
    try {
      connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);
      connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);
      connection.setRequestProperty("Content-Type","application/json");
      if(device!=null){connection.setRequestProperty("X-SMS-Device",device);connection.setRequestProperty("X-SMS-Timestamp",timestamp);connection.setRequestProperty("X-SMS-Signature",signature);}
      try(java.io.OutputStream out=connection.getOutputStream()){out.write(body);}
      int status=connection.getResponseCode();JSONObject response=new JSONObject();
      java.io.InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
      if(input!=null) {
        try(java.io.InputStream stream=input;java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream()) {
          byte[] buffer=new byte[512];int length;
          while((length=stream.read(buffer))!=-1){bytes.write(buffer,0,length);if(bytes.size()>4096)throw new Exception("Invalid server response");}
          try {response=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));}catch(org.json.JSONException ignored){}
        }
      }
      return new Result(status,response);
    } finally {connection.disconnect();}
  }
}
