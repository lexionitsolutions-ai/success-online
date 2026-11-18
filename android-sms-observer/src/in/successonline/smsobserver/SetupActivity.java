package in.successonline.smsobserver;

import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.text.InputType;
import android.view.View;
import android.widget.*;
import java.net.URI;
import org.json.JSONObject;
import org.json.JSONArray;

public class SetupActivity extends Activity {
  private TextView status,connection;
  private LinearLayout form,dashboard;
  private Button check,connect;
  private JSONObject bootstrap;
  private Button button(LinearLayout layout,String label) {
    Button button=new Button(this);button.setText(label);layout.addView(button);return button;
  }
  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
    ScrollView scroll=new ScrollView(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(32,32,32,32);scroll.addView(layout);setContentView(scroll);
    TextView title=new TextView(this);title.setText("Success Online SMS Pilot");title.setTextSize(24);layout.addView(title);
    TextView info=new TextView(this);info.setText("Version 0.6 — forwards matching Worldline credit alerts from this merchant phone.");layout.addView(info);
    status=new TextView(this);status.setPadding(0,24,0,24);layout.addView(status);
    dashboard=new LinearLayout(this);dashboard.setOrientation(LinearLayout.VERTICAL);layout.addView(dashboard);
    connection=new TextView(this);connection.setPadding(0,16,0,16);dashboard.addView(connection);
    check=button(dashboard,"Check server connection");check.setOnClickListener(v->checkConnection());
    button(dashboard,"Enable incoming SMS permission").setOnClickListener(v->requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS},1));
    button(dashboard,"Send pending alerts now").setOnClickListener(v->sendNow());
    button(dashboard,"Recover Worldline SMS — last 24 hours").setOnClickListener(v->new android.app.AlertDialog.Builder(this).setTitle("Recover missed payment alerts?").setMessage("With your permission, read received Worldline SMS from the last 24 hours on this merchant phone. Only matching payment credit alerts are forwarded to Success Online. Other messages stay on the phone. Existing payments will not be credited twice.").setNegativeButton("Cancel",null).setPositiveButton("Recover",(d,w)->{if(checkSelfPermission(Manifest.permission.READ_SMS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.READ_SMS},2);else recover();}).show());
    button(dashboard,"Continue in background").setOnClickListener(v->{UploadJob.schedule(this);finish();});
    form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);layout.addView(form);
    TextView details=new TextView(this);details.setPadding(0,24,0,24);form.addView(details);
    try {
      int resource=getResources().getIdentifier("pairing","raw",getPackageName());
      if(resource==0)throw new Exception("Pairing file missing");
      try(java.io.InputStream input=getResources().openRawResource(resource);java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream()) {
        byte[] buffer=new byte[1024];int length;while((length=input.read(buffer))!=-1){bytes.write(buffer,0,length);if(bytes.size()>4096)throw new Exception("Invalid pairing file");}
        bootstrap=new JSONObject(new String(bytes.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));
      }
      details.setText("Website: "+bootstrap.getString("url")+"\nDevice: Success Online Kotak phone\n\nTap Connect. No credentials to type. Use only the business phone receiving Worldline SMS. This single-use setup expires "+bootstrap.getString("expiresAt")+".");
    }catch(Exception e){details.setText("This installer does not contain a valid pairing file. Ask the administrator for the merchant-phone installer.");}
    connect=button(form,"Connect");connect.setTextSize(20);connect.setTextColor(android.graphics.Color.WHITE);connect.setBackgroundTintList(android.content.res.ColorStateList.valueOf(android.graphics.Color.rgb(7,129,95)));connect.setEnabled(bootstrap!=null);connect.setOnClickListener(v->pair());
    refresh();
  }
  private void pair() {
    connect.setEnabled(false);status.setText("Connecting this phone securely...");
    new Thread(()->{
      String error=null;
      try {
        String installation=LocalStore.read(this,"installation","");
        if(installation.isEmpty()){installation=java.util.UUID.randomUUID().toString().replace("-","");LocalStore.write(this,"installation",installation);}
        SignedRequest.Result result=SignedRequest.pair(bootstrap,installation);
        if(result.status!=200 || !result.body.optBoolean("ok") || !result.body.optString("deviceId").equals(bootstrap.getString("deviceId")) || !result.body.optString("signingKey").matches("[a-f0-9]{64}")) {
          if(result.status==409)throw new Exception("This pairing file was already used by another phone. Ask Raj for a new installer.");
          if(result.status==410)throw new Exception("This pairing file expired. Ask Raj for a new installer.");
          throw new Exception("Server pairing is not ready (status "+result.status+"). Settings were not changed.");
        }
        JSONObject config=new JSONObject().put("url",bootstrap.getString("url")).put("device",result.body.getString("deviceId")).put("key",result.body.getString("signingKey"));
        LocalStore.write(this,"config",config.toString());LocalStore.write(this,"connection","Phone paired. Checking the server connection...");
      }catch(Exception e){error=e.getMessage()==null?"Could not connect. Check your internet connection and retry.":e.getMessage();}
      final String failure=error;
      runOnUiThread(()->{
        if(isFinishing() || isDestroyed())return;
        connect.setEnabled(true);
        if(failure!=null){status.setText(failure);return;}
        refresh();
        if(checkSelfPermission(Manifest.permission.RECEIVE_SMS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS},1);
        UploadJob.schedule(this);checkConnection();
      });
    }).start();
  }
  private void refresh() {
    try {
      boolean saved=!LocalStore.read(this,"config","").isEmpty();
      form.setVisibility(saved?View.GONE:View.VISIBLE);dashboard.setVisibility(saved?View.VISIBLE:View.GONE);
      status.setText((saved?"PHONE SETUP SAVED":"Tap Connect to set up this Kotak phone")+"\nSMS permission: "+(checkSelfPermission(Manifest.permission.RECEIVE_SMS)==PackageManager.PERMISSION_GRANTED?"allowed":"not allowed")+"\nPending alerts: "+new JSONArray(LocalStore.read(this,"queue","[]")).length()+"\nAlerts requiring review: "+new JSONArray(LocalStore.read(this,"rejected","[]")).length()+"\n"+LocalStore.read(this,"status","No payment SMS uploaded yet."));
      status.append("\n"+LocalStore.read(this,"lastSms","No matching incoming SMS captured by this version yet."));
      connection.setText(LocalStore.read(this,"connection","Server connection has not been checked yet."));
    }catch(Exception e){status.setText("Unable to read settings.");}
  }
  private void checkConnection() {
    check.setEnabled(false);connection.setText("Checking the saved device credentials with the server...");
    new Thread(()->{
      String message;
      try {
        String savedConfig=LocalStore.read(this,"config","{}");
        SignedRequest.Result result=SignedRequest.post(new JSONObject(savedConfig),new JSONObject().put("action","health_check"));
        if(result.status==200 && result.body.optBoolean("ok") && result.body.optBoolean("deviceAuthorized") && "detection_only".equals(result.body.optString("mode")))
          message=result.body.optBoolean("smsAutoConfirmEnabled")?"CONNECTED - automatic payment confirmation is enabled for exact reference and amount matches. Continue in background.":"CONNECTED - this phone is authorized. Continue in background. Payment approval is handled by the website.";
        else if(result.status==401 && "Login required".equals(result.body.optString("error")))
          message="SERVER SETUP PENDING - the SMS endpoint has not been deployed on this website yet. Your phone settings are saved.";
        else if(result.status==503)
          message="SERVER SETUP PENDING - an administrator must configure the SMS endpoint and database. Your phone settings are saved.";
        else if(result.status==401)
          message="DEVICE NOT AUTHORIZED - check that the server has this device ID and signing key, and that the phone date/time is correct.";
        else if(result.status==404 || result.status==405)
          message="SERVER SETUP PENDING - the SMS endpoint is missing on this website.";
        else message="Could not confirm the SMS connection (server status "+result.status+"). Settings and pending alerts are retained.";
        if(!savedConfig.equals(LocalStore.read(this,"config","{}"))){runOnUiThread(()->check.setEnabled(true));return;}
        LocalStore.write(this,"connection",message);
      }catch(Exception e){message="Could not reach the server. Check the internet connection and saved website URL. Settings and pending alerts are retained.";}
      final String display=message;
      runOnUiThread(()->{if(!isFinishing() && !isDestroyed()){check.setEnabled(true);refresh();connection.setText(display);}});
    }).start();
  }
  private void sendNow() {
    UploadJob.schedule(this);status.setText("Sending queued alerts...");
    new Thread(()->{UploadJob.drain(this,()->true);runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())refresh();});}).start();
  }
  private void recover() {
    status.setText("Checking received Worldline alerts from the last 24 hours...");
    new Thread(()->{
      try {
        int matches=0;
        java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",java.util.Locale.US);format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        try(android.database.Cursor rows=getContentResolver().query(android.provider.Telephony.Sms.Inbox.CONTENT_URI,new String[]{"address","body","date"},"date >= ? AND address LIKE ?",new String[]{String.valueOf(System.currentTimeMillis()-86400000L),"%WLITXS%"},"date ASC")) {
          if(rows!=null)while(rows.moveToNext() && matches<500) {
            String sender=rows.getString(0),body=rows.getString(1);
            if(!WorldlineFormat.senderAllowed(sender)||!WorldlineFormat.bodyAllowed(body))continue;
            LocalStore.enqueue(this,new JSONObject().put("sender",sender).put("text",body).put("receivedAt",format.format(new java.util.Date(rows.getLong(2)))));matches++;
          }
        }
        LocalStore.write(this,"lastSms","Recovery found "+matches+" matching Worldline alerts in the last 24 hours.");
        UploadJob.schedule(this);UploadJob.drain(this,()->true);
      }catch(Exception e){try{LocalStore.write(this,"status","Recovery could not finish. Check SMS permission and retry. Pending alerts are retained.");}catch(Exception ignored){}}
      runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())refresh();});
    }).start();
  }
  @Override protected void onResume(){super.onResume();if(status!=null&&form!=null)refresh();}
  @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);refresh();if(request==2&&results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)recover();}
}
