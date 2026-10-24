import {randomUUID} from 'node:crypto';

export const announcementSchema = `
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  image_base64 TEXT, image_mime_type TEXT, image_name TEXT,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS announcements_created_idx ON announcements(created_at);
`;

export function createAnnouncements({db, send, body}) {
  const metadata = 'a.id,a.title,a.body,a.image_mime_type,a.image_name,a.created_at,u.name author';
  const visible = row => ({id:row.id,title:row.title,body:row.body,author:row.author,created_at:row.created_at,image_url:row.image_mime_type ? `/api/announcements/${row.id}/image` : null,image_name:row.image_name});
  return {
    async handle(req,res,url,user) {
      const match=url.pathname.match(/^\/api\/announcements(?:\/([^/]+)(?:\/(image))?)?$/);
      if(!match) return false;
      const [,announcementId,image]=match;
      if(req.method==='GET' && !announcementId) {
        const rows=await db.all(`SELECT ${metadata} FROM announcements a JOIN users u ON u.id=a.created_by WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 30`);
        send(res,200,{announcements:rows.map(visible)});return true;
      }
      if(req.method==='GET' && image) {
        const row=await db.one('SELECT image_base64,image_mime_type FROM announcements WHERE id=$id AND deleted_at IS NULL',{$id:announcementId});
        if(!row?.image_base64) {send(res,404,{error:'Announcement picture not found'});return true;}
        res.writeHead(200,{'content-type':row.image_mime_type,'cache-control':'private, no-store'});
        res.end(Buffer.from(row.image_base64,'base64'));return true;
      }
      if(!['POST','DELETE'].includes(req.method)) {send(res,405,{error:'Method not allowed'});return true;}
      if(user.role!=='admin') {send(res,403,{error:'Only administrators can publish or remove announcements'});return true;}
      if(req.method==='DELETE' && announcementId && !image) {
        const result=await db.run('UPDATE announcements SET deleted_at=$at WHERE id=$id AND deleted_at IS NULL',{$id:announcementId,$at:new Date().toISOString()});
        send(res,result.changes?200:404,result.changes?{ok:true}:{error:'Announcement not found'});return true;
      }
      if(req.method!=='POST' || announcementId) {send(res,405,{error:'Method not allowed'});return true;}
      const data=await body(req);
      const title=typeof data.title==='string'?data.title.trim():'';
      const message=typeof data.body==='string'?data.body.trim():'';
      if(!title || title.length>140 || message.length>4000 || (!message && !data.image)) {send(res,400,{error:'Enter a title (up to 140 characters) and an update (up to 4,000 characters) or picture'});return true;}
      let picture;
      if(data.image) {
        const value=data.image;
        if(!['image/jpeg','image/png'].includes(value.mimeType) || !Number.isInteger(value.size) || value.size<1 || value.size>2000000 || typeof value.content!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.content) || value.content.length>2666668) {
          send(res,400,{error:'Choose a JPG or PNG picture up to 2 MB'});return true;
        }
        const bytes=Buffer.from(value.content,'base64');
        const signature=value.mimeType==='image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
        if(bytes.length!==value.size || !signature) {send(res,400,{error:'The picture does not match the selected JPG or PNG file'});return true;}
        picture={content:bytes.toString('base64'),type:value.mimeType,name:String(value.fileName || 'Announcement picture').slice(0,200)};
      }
      const announcementIdNew=`ann_${randomUUID()}`;
      await db.run('INSERT INTO announcements(id,title,body,image_base64,image_mime_type,image_name,created_by,created_at) VALUES ($id,$title,$body,$image,$type,$name,$user,$at)',{$id:announcementIdNew,$title:title,$body:message,$image:picture?.content || null,$type:picture?.type || null,$name:picture?.name || null,$user:user.id,$at:new Date().toISOString()});
      const row=await db.one(`SELECT ${metadata} FROM announcements a JOIN users u ON u.id=a.created_by WHERE a.id=$id`,{$id:announcementIdNew});
      send(res,201,{announcement:visible(row)});return true;
    }
  };
}
