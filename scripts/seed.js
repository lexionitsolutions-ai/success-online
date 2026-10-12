import { initialize, db } from '../server.js';
try { await initialize({setup:true}); console.log('Accounts and service catalog are ready.'); }
finally { await db.close(); }
