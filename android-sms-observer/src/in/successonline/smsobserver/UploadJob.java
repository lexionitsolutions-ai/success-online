package in.successonline.smsobserver;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import org.json.JSONObject;

public class UploadJob extends JobService {
  private volatile int generation;
  static void schedule(Context context) {
    JobScheduler scheduler=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
    scheduler.schedule(new JobInfo.Builder(41,new ComponentName(context,UploadJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());
  }
  static synchronized boolean drain(Context context,java.util.function.BooleanSupplier active) {
      boolean retry=false;
      try {
        JSONObject config=new JSONObject(LocalStore.read(context,"config","{}"));
        for(int i=0;i<50 && active.getAsBoolean();i++) {
          JSONObject message=LocalStore.first(context);if(message==null)break;
          SignedRequest.Result result=SignedRequest.post(config,message);
          int status=result.status;
          LocalStore.write(context,"status","Server response: "+status+" at "+new java.util.Date());
          if(status==200) {
            if(!result.body.optBoolean("ok") || !result.body.optString("observationId").matches("[a-f0-9]{64}"))throw new Exception("Server did not acknowledge the alert");
            LocalStore.acknowledge(context,message.getString("text"));continue;
          }
          if(status==400 || status==409) {LocalStore.quarantine(context,message,status);continue;}
          retry=true;break;
        }
        retry=retry || LocalStore.first(context)!=null;
      } catch(Exception e) {
        retry=true;try {LocalStore.write(context,"status","Connection or configuration problem. Queue retained; retry scheduled.");}catch(Exception ignored){}
      }
      return retry;
  }
  @Override public boolean onStartJob(JobParameters params) {
    final int current=++generation;
    new Thread(()->{
      boolean retry=drain(this,()->current==generation);
      if(current==generation)jobFinished(params,retry);
    }).start();
    return true;
  }
  @Override public boolean onStopJob(JobParameters params) {generation++;return true;}
}
