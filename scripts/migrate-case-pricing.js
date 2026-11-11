import {initialize,db} from '../server.js';
import {syncServiceOptions} from '../service-options.js';
import {updateMainBranch} from '../branch-account.js';
try {
  await initialize();
  await db.transaction(async()=>{
    await syncServiceOptions(db);
    await db.run("INSERT INTO service_prices(variant_id,price,original_price,original_config) SELECT id,service_charge,service_charge,'{}' FROM variants WHERE active=1 ON CONFLICT(variant_id) DO NOTHING");
    if(process.env.MAIN_BRANCH_PASSWORD) await updateMainBranch(db,process.env.MAIN_BRANCH_PASSWORD);
  });
  console.log('Service pricing options migrated. Existing cases, payments and prices preserved.');
} catch(error) {console.error('Case pricing migration failed:',error.code || error.message || error.errors?.map(item=>item.code).join(', ') || error.name);process.exitCode=1;}
finally {await db.close();}
