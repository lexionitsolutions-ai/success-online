import { db } from '../server.js';
import { storage } from '../storage.js';
try {
  if (!db.cloud) throw new Error('Cleanup requires the cloud database and private Storage configuration.');
  const cutoff = new Date(Date.now()-86400000).toISOString();
  const pending = await db.all('SELECT id,storage_path FROM upload_intents WHERE expires_at<$at AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.storage_path='supabase://' || upload_intents.storage_path)',{$at:cutoff});
  for (const intent of pending) {
    const {error} = await storage().remove([intent.storage_path]);
    if (error) throw error;
    await db.run('DELETE FROM upload_intents WHERE id=$id',{$id:intent.id});
  }
  // Download bundles use a UUID directory and short-lived signed links.
  let offset = 0;
  const directoriesToClean = [];
  const downloads = storage('downloads');
  while (true) {
    const {data:directories,error} = await downloads.list('downloads',{limit:100,offset});
    if (error) throw error;
    if (!directories?.length) break;
    directoriesToClean.push(...directories);
    if (directories.length < 100) break;
    offset += directories.length;
  }
  for (const directory of directoriesToClean) {
      const {data:files,error} = await downloads.list('downloads/'+directory.name,{limit:100});
      if (error) throw error;
      const expired = files.filter(file=>file.created_at && file.created_at<cutoff);
      if (expired.length) {
        const {error} = await downloads.remove(expired.map(file=>`downloads/${directory.name}/${file.name}`));
        if (error) throw error;
      }
  }
  console.log('Expired upload staging files and old download bundles cleaned up.');
} catch (error) {console.error(error.message);process.exitCode=1;}
finally {await db.close();}
