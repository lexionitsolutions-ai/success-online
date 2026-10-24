import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('announcements persist text and private pictures, enforce admin permissions, and remove safely',async()=>{
  const root=mkdtempSync(join(tmpdir(),'announcements-test-'));
  const port=39000+Math.floor(Math.random()*2000),origin=`http://localhost:${port}`;
  let child;
  async function start() {
    child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),APP_ORIGIN:origin,DATABASE_PATH:join(root,'test.sqlite'),STORAGE_PATH:join(root,'files'),DRIVE_MODE:'demo',SHEETS_MODE:'demo',SESSION_SECRET:'isolated-announcements-test-secret'},stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',d=>errors+=d);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',code=>{clearTimeout(timer);reject(Error(`Exited ${code}: ${errors}`));});});
  }
  async function request(path,{cookie,body,method=body?'POST':'GET'}={}) {
    const response=await fetch(origin+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,response,data:await response.clone().json().catch(()=>({}))};
  }
  async function stop() {if(child && child.exitCode===null) await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
  try {
    await start();
    const login=async username=>(await request('/api/login',{body:{username,password:'Demo@12345'}})).response.headers.get('set-cookie').split(';')[0];
    const admin=await login('admin01'),sales=await login('sales01'),office=await login('backoffice01');
    assert.equal((await request('/api/announcements')).status,401);
    assert.deepEqual((await request('/api/announcements',{cookie:sales})).data.announcements,[]);
    for(const cookie of [sales,office]) assert.equal((await request('/api/announcements',{cookie,body:{title:'Not authorized',body:'Forbidden'}})).status,403);
    for(const body of [{title:'',body:'Text'},{title:'Title'}, {title:'a'.repeat(141),body:'Text'},{title:'Title',body:'x'.repeat(4001)}]) assert.equal((await request('/api/announcements',{cookie:admin,body})).status,400);
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSU8AAAAASUVORK5CYII=','base64');
    const image={mimeType:'image/png',fileName:'announcement.png',size:bytes.length,content:bytes.toString('base64')};
    for(const invalid of [{...image,mimeType:'image/svg+xml'},{...image,size:2000001},{...image,size:bytes.length+1},{...image,content:'not base64!'},{...image,mimeType:'image/jpeg'}]) assert.equal((await request('/api/announcements',{cookie:admin,body:{title:'Invalid image',image:invalid}})).status,400);
    const posted=await request('/api/announcements',{cookie:admin,body:{title:'Picture update',body:'First line\nSecond line <script>alert(1)</script>',image}});
    assert.equal(posted.status,201);
    const announcement=posted.data.announcement;
    assert.ok(announcement.image_url);
    assert.equal(announcement.image_base64,undefined);
    assert.equal((await request(announcement.image_url)).status,401);
    for(const cookie of [sales,office]) {
      const picture=await request(announcement.image_url,{cookie});
      assert.equal(picture.status,200);assert.equal(picture.response.headers.get('content-type'),'image/png');
      assert.deepEqual(Buffer.from(await picture.response.arrayBuffer()),bytes);
      assert.equal((await request(`/api/announcements/${announcement.id}`,{cookie,method:'DELETE'})).status,403);
    }
    const text=await request('/api/announcements',{cookie:admin,body:{title:'Text update',body:'No picture needed'}});
    assert.equal(text.status,201);assert.equal(text.data.announcement.image_url,null);
    const pictureOnly=await request('/api/announcements',{cookie:admin,body:{title:'Picture only',image}});
    assert.equal(pictureOnly.status,201);
    const list=(await request('/api/announcements',{cookie:office})).data.announcements;
    assert.equal(list.length,3);assert.equal(list[0].title,'Picture only');
    assert.ok(list.every(row=>row.image_base64===undefined));
    await stop();await start();
    assert.equal((await request('/api/announcements',{cookie:sales})).data.announcements.length,3,'Posts survive a restart');
    assert.equal((await request(`/api/announcements/${announcement.id}`,{cookie:admin,method:'DELETE'})).status,200);
    assert.equal((await request(announcement.image_url,{cookie:sales})).status,404);
    assert.equal((await request('/api/announcements',{cookie:sales})).data.announcements.length,2);
    assert.equal((await request(`/api/announcements/${announcement.id}`,{cookie:admin,method:'DELETE'})).status,404);
  } finally {await stop();}
});
