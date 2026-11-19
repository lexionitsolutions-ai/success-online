import {createServer} from 'node:net';
// Match the application's listener and let the OS choose available test ports.
// PostgreSQL fixtures also reserve the adjacent private-storage fixture port.
export async function testPort({adjacentPorts=0}={}) {
  for(let attempt=0;attempt<20;attempt++) {
    const servers=[];
    try {
      const listen=async port=>{
        const server=createServer();
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,resolve);});
        servers.push(server);return server.address().port;
      };
      const port=await listen(0);
      if(port+adjacentPorts>65535) continue;
      for(let i=1;i<=adjacentPorts;i++) await listen(port+i);
      return port;
    } catch(error) {
      if(!['EADDRINUSE','EACCES'].includes(error.code)) throw error;
    } finally {
      await Promise.all(servers.map(server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))));
    }
  }
  throw new Error('Could not find available ports for the isolated test servers.');
}
