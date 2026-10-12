import { initialize, db } from '../server.js';
try { await initialize({setup:true}); console.log('Database schema and catalog are ready.'); }
finally { await db.close(); }
