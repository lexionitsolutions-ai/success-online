import {randomUUID} from 'node:crypto';

export function createStaffAccounts({db,hashPassword}) {
  const {one,all,run}=db;
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  async function change(employeeId,actor,method,input={}) {
    if(actor.role!=='admin') fail(403,'Admin access required');
    const employee=await one('SELECT * FROM users WHERE id=$id'+(db.cloud?' FOR UPDATE':''),{$id:employeeId});
    if(!employee || !['sales','backoffice'].includes(employee.role)) fail(404,'Sales or back-office employee not found');
    const deleted=await one("SELECT id FROM audit_logs WHERE action='employee.delete' AND entity_id=$id",{$id:employeeId});
    if(deleted) fail(410,'This staff account has been deleted');
    let action,reason;
    if(method==='DELETE') {
      // Preserve case ownership, receipts, pricing and the employee's history.
      await run('UPDATE users SET active=0 WHERE id=$id',{$id:employeeId});
      if(employee.role==='backoffice') {
        const released=await all("SELECT id,status FROM cases WHERE backoffice_user_id=$id AND status NOT IN ('Closed','Delivered','Cancelled','Rejected','Deleted')",{$id:employeeId});
        for(const c of released) {
          const stamp=new Date().toISOString();
          await run('UPDATE cases SET backoffice_user_id=NULL,updated_at=$at WHERE id=$id',{$id:c.id,$at:stamp});
          await run('INSERT INTO notes VALUES ($id,$case,$actor,$old,$new,$note,$vis,$next,$at)',{$id:randomUUID(),$case:c.id,$actor:actor.id,$old:c.status,$new:c.status,$note:`${employee.name}'s staff account was deleted. The case is available for another back-office employee to claim; its work stage is preserved.`,$vis:'sales',$next:JSON.stringify({type:'staff_account_release',previousOwner:employeeId}),$at:stamp});
        }
      }
      action='employee.delete';reason='Account removed; sign-in disabled and case history retained.';
    } else {
      const name=String(input.name??employee.name).trim(),username=String(input.username??employee.username).trim().toLowerCase();
      if(!name || name.length>100 || /\p{N}/u.test(name)) fail(400,'Enter a name without numbers, up to 100 characters');
      if(!/^[a-z0-9._-]{3,50}$/.test(username)) fail(400,'Username must contain 3–50 letters, numbers, dots, underscores or hyphens');
      if(input.role!==undefined && input.role!==employee.role) fail(400,'The staff role cannot be changed; create a separate account for another role');
      if(input.active!==undefined && ![0,1].includes(input.active)) fail(400,'Choose an active or inactive account');
      const password=input.password;
      if(password!==undefined && password!=='' && (typeof password!=='string' || password.length<10 || password.length>128)) fail(400,'Password must contain 10–128 characters');
      if(await one('SELECT id FROM users WHERE LOWER(username)=$username AND id!=$id',{$username:username,$id:employeeId})) fail(409,'Username already exists');
      await run('UPDATE users SET name=$name,username=$username,password_hash=$hash,active=$active WHERE id=$id',{$id:employeeId,$name:name,$username:username,$hash:password ? hashPassword(password) : employee.password_hash,$active:input.active??employee.active});
      action='employee.update';reason=`Updated account details${password?'; password reset':''}.`;
    }
    await run('INSERT INTO integration_settings(name,value) VALUES ($name,$version) ON CONFLICT(name) DO UPDATE SET value=$version',{$name:'STAFF_SESSION_'+employeeId,$version:randomUUID()});
    await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)',{$id:randomUUID(),$actor:actor.id,$action:action,$type:'user',$entity:employeeId,$reason:reason,$at:new Date().toISOString()});
    const updated=await one('SELECT id,username,name,role,active FROM users WHERE id=$id',{$id:employeeId});
    return {employee:updated,deleted:method==='DELETE'};
  }
  return {change};
}
