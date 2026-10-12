import { initialize, db } from '../server.js';
import { storageEnabled, bucketName, downloadBucketName } from '../storage.js';
import { configureInitialAccounts } from '../initial-accounts.js';
try {
  if (!db.cloud) throw new Error('Set DATABASE_URL in your private .env before running Supabase setup.');
  if (!storageEnabled()) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY before setting up document storage.');
  await initialize({setup:true});
  await db.transaction(() => configureInitialAccounts(db));
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  for (const [name,limit,types] of [[bucketName(),10000000,['application/pdf','image/jpeg','image/png']],[downloadBucketName(),210000000,['application/zip','application/pdf','image/jpeg','image/png']]]) {
    const options = {public:false,fileSizeLimit:limit,allowedMimeTypes:types};
    const {data:existing} = await client.storage.getBucket(name);
    const result = existing ? await client.storage.updateBucket(name,options) : await client.storage.createBucket(name,options);
    if (result.error) throw new Error('Could not configure private bucket ' + name + ': ' + result.error.message);
  }
  console.log('Supabase schema, service catalog, configured staff accounts and private document/download buckets are ready.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.close(); }
