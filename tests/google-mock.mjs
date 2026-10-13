// Loaded only into isolated test server processes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const originalFetch = globalThis.fetch;
const sheetRows={};
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const response = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
  // Google rejects dot notation in partial-response field masks.
  if (/\b(?:capabilities|properties|sheets)\./.test(url.searchParams.get('fields') || '')) return new Response(JSON.stringify({error:{message:'Invalid field selection'}}),{status:400,headers:{'content-type':'application/json'}});
  if (url.hostname === 'oauth2.googleapis.com') {
    if (process.env.GOOGLE_MOCK_FAILURE_FILE && existsSync(process.env.GOOGLE_MOCK_FAILURE_FILE) && !['missing-root','sheets-fail','sheets-slow-fail'].includes(readFileSync(process.env.GOOGLE_MOCK_FAILURE_FILE,'utf8'))) return new Response(JSON.stringify({error:'invalid_grant',error_description:'Token has been expired or revoked.'}), {status:400,headers:{'content-type':'application/json'}});
    return response({access_token:'mock-token'});
  }
  if (url.hostname === 'www.googleapis.com') {
    const folderId = url.pathname.split('/').at(-1);
    if (folderId === 'missing-folder' || (folderId === 'root' && process.env.GOOGLE_MOCK_FAILURE_FILE && existsSync(process.env.GOOGLE_MOCK_FAILURE_FILE) && readFileSync(process.env.GOOGLE_MOCK_FAILURE_FILE,'utf8') === 'missing-root')) return new Response(JSON.stringify({error:{message:'File not found'}}),{status:404});
    if (url.searchParams.get('alt') === 'media') return new Response('%PDF-1.4\nmock-drive-file\n%%EOF');
    if (url.pathname.startsWith('/upload/')) return response({id:'mock-file'});
    if (options.method === 'POST') return response({id:'mock-folder'});
    return response({id:folderId,name:'Trial root',mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:folderId !== 'read-only-folder'}});
  }
  if (url.hostname === 'sheets.googleapis.com') {
    if(process.env.GOOGLE_MOCK_FAILURE_FILE && existsSync(process.env.GOOGLE_MOCK_FAILURE_FILE) && readFileSync(process.env.GOOGLE_MOCK_FAILURE_FILE,'utf8')==='sheets-slow-fail') {
      await new Promise(resolve=>setTimeout(resolve,2000));
      return new Response(JSON.stringify({error:{message:'Synthetic slow Sheets outage'}}),{status:503});
    }
    if(process.env.GOOGLE_MOCK_FAILURE_FILE && existsSync(process.env.GOOGLE_MOCK_FAILURE_FILE) && readFileSync(process.env.GOOGLE_MOCK_FAILURE_FILE,'utf8')==='sheets-fail') return new Response(JSON.stringify({error:{message:'Synthetic Sheets outage'}}),{status:503});
    if (url.searchParams.has('fields')) return response({spreadsheetId:'workbook',properties:{title:'Trial workbook'},sheets:[]});
    const range=decodeURIComponent(url.pathname.split('/values/')[1] || ''), match=range.match(/^'([^']+)'!([A-Z]+)(\d+)?/);
    if(match) {
      const [,tab,column,row]=match;sheetRows[tab] ||= {};
      if(!options.method) {const index=column.charCodeAt(0)-65;return response({values:[[tab,...Object.keys(sheetRows[tab]).sort((a,b)=>a-b).map(r=>sheetRows[tab][r][index])]]});}
      if(row) {sheetRows[tab][row]=JSON.parse(options.body).values[0];if(process.env.GOOGLE_MOCK_SHEETS_FILE) writeFileSync(process.env.GOOGLE_MOCK_SHEETS_FILE,JSON.stringify(sheetRows));}
    }
    if (!options.method) return response({values:[['Case ID']]});
    return response({updatedRows:1});
  }
  return originalFetch(input, options);
};
