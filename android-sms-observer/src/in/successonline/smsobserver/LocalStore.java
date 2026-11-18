package in.successonline.smsobserver;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

// Configuration and the filtered upload queue are encrypted with an Android Keystore key.
final class LocalStore {
  private static SecretKey key() throws Exception {
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(!store.containsAlias("sms-pilot")) {
      KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder("sms-pilot",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
    }
    return (SecretKey)store.getKey("sms-pilot",null);
  }
  static synchronized String read(Context c,String name,String fallback) throws Exception {
    String saved=c.getSharedPreferences("pilot",0).getString(name,null);if(saved==null)return fallback;
    byte[] data=Base64.decode(saved,Base64.NO_WRAP);
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,data,0,12));
    return new String(cipher.doFinal(data,12,data.length-12),StandardCharsets.UTF_8);
  }
  static synchronized void write(Context c,String name,String value) throws Exception {
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
    byte[] encrypted=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),iv=cipher.getIV(),data=new byte[iv.length+encrypted.length];
    System.arraycopy(iv,0,data,0,iv.length);System.arraycopy(encrypted,0,data,iv.length,encrypted.length);
    if(!c.getSharedPreferences("pilot",0).edit().putString(name,Base64.encodeToString(data,Base64.NO_WRAP)).commit())throw new Exception("Could not save encrypted settings");
  }
  static synchronized void enqueue(Context c,JSONObject message) throws Exception {
    JSONArray queue=new JSONArray(read(c,"queue","[]"));
    for(int i=0;i<queue.length();i++)if(queue.getJSONObject(i).getString("text").equals(message.getString("text")))return;
    if(queue.length()>=500)throw new Exception("Upload queue full");
    queue.put(message);write(c,"queue",queue.toString());
  }
  static synchronized JSONObject first(Context c) throws Exception {return new JSONArray(read(c,"queue","[]")).optJSONObject(0);}
  static synchronized void acknowledge(Context c,String text) throws Exception {
    JSONArray queue=new JSONArray(read(c,"queue","[]")),remaining=new JSONArray();
    for(int i=0;i<queue.length();i++)if(!queue.getJSONObject(i).getString("text").equals(text))remaining.put(queue.getJSONObject(i));
    write(c,"queue",remaining.toString());
  }
  static synchronized void quarantine(Context c,JSONObject message,int status) throws Exception {
    JSONArray items=new JSONArray(read(c,"rejected","[]"));
    if(items.length()>=500)throw new Exception("Review rejected alerts before continuing");
    items.put(new JSONObject().put("message",message).put("serverStatus",status));write(c,"rejected",items.toString());
    acknowledge(c,message.getString("text"));
  }
}
