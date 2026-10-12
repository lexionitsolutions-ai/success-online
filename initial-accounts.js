import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

// Explicit setup only: credentials come from private environment variables.
export async function configureInitialAccounts(db) {
  for (const [prefix,role,name] of [['ADMIN','admin','Administrator'],['SALES','sales','Sales Employee'],['BACKOFFICE','backoffice','Back Office Employee']]) {
    const username = process.env[`INITIAL_${prefix}_USERNAME`]?.trim().toLowerCase();
    const password = process.env[`INITIAL_${prefix}_PASSWORD`];
    if (!username && !password) continue;
    if (!username || !/^[a-z0-9._-]{3,50}$/.test(username) || !password || password.length < 10 || password.length > 128) throw new Error(`Set INITIAL_${prefix}_USERNAME and INITIAL_${prefix}_PASSWORD (10–128 characters).`);
    const existing = await db.one('SELECT id,role FROM users WHERE LOWER(username)=$username',{$username:username});
    if (existing && existing.role !== role) throw new Error(`The configured ${role} username already belongs to another role.`);
    const salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${scryptSync(password,salt,32).toString('hex')}`;
    if (existing) await db.run('UPDATE users SET password_hash=$hash,active=1 WHERE id=$id',{$hash:hash,$id:existing.id});
    else await db.run('INSERT INTO users VALUES ($id,$username,$name,$role,$hash,1,$at)',{$id:'usr_'+randomUUID(),$username:username,$name:process.env[`INITIAL_${prefix}_NAME`]||name,$role:role,$hash:hash,$at:new Date().toISOString()});
  }
}
