package in.successonline.smsobserver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

public class PaymentSmsReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context,Intent intent) {
    if(!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction()))return;
    SmsMessage[] parts=Telephony.Sms.Intents.getMessagesFromIntent(intent);
    if(parts==null || parts.length==0)return;
    String sender=parts[0].getOriginatingAddress();
    if(!WorldlineFormat.senderAllowed(sender))return;
    StringBuilder text=new StringBuilder();
    for(SmsMessage part:parts) {
      if(!sender.equals(part.getOriginatingAddress()))return;
      text.append(part.getMessageBody());
    }
    String body=text.toString();
    final PendingResult pending=goAsync();
    new Thread(()->{
      try {
        if(!WorldlineFormat.bodyAllowed(body)){LocalStore.write(context,"lastSms","Worldline SMS seen, but its format/terminal did not match. Ask Raj to inspect the original message.");return;}
        if(LocalStore.read(context,"config","").isEmpty())return;
        SimpleDateFormat date=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);date.setTimeZone(TimeZone.getTimeZone("UTC"));
        LocalStore.enqueue(context,new JSONObject().put("sender",sender).put("text",body).put("receivedAt",date.format(new Date(parts[0].getTimestampMillis()))));
        LocalStore.write(context,"lastSms","Matching Worldline SMS queued at "+new Date());
        UploadJob.schedule(context);
      } catch(Exception e) { /* No SMS content or signing material in device logs. */ }
      finally {pending.finish();}
    }).start();
  }
}
