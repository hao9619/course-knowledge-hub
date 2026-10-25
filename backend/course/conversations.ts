import type {FastifyInstance} from 'fastify';
import type Database from 'better-sqlite3';
import {z} from 'zod';
import type {User} from './store.js';
import {fail,parse} from './validation.js';
export type HistoryTurn={role:'user'|'assistant';content:string};
export type AnswerResult={mode:string;answer:string;citations:any[]};
export function registerConversations(app:FastifyInstance,db:Database.Database,user:(req:any)=>User,answer:(question:string,history:HistoryTurn[])=>Promise<AnswerResult>){
 const id=(req:any)=>parse(z.coerce.number().int().positive(),req.params.id);
 function owned(cid:number,uid:number){const c=db.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(cid,uid) as any;if(!c)fail(404,'会话不存在或无权访问');return c;}
 function safeMessage(row:any){
  const citations=JSON.parse(row.citations_json) as any[];
  const valid=citations.filter(c=>{const r=db.prepare('SELECT status,revision,created_at FROM resources WHERE id=?').get(c.resource_id) as any;return r?.status==='published'&&r.revision===c.revision&&(c.resource_created_at?r.created_at===c.resource_created_at:r.created_at<=row.created_at);});
  const stale=row.role==='assistant'&&valid.length!==citations.length;
  return {id:row.id,role:row.role,content:stale?'这条回答引用的资料已更新或归档，请重新提问以获取当前内容。':row.content,mode:stale?'stale':row.mode,citations:stale?[]:valid,created_at:row.created_at};
 }
 function view(cid:number,uid:number){const c=owned(cid,uid);return {...c,messages:db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all(cid).map(safeMessage)};}
 app.get('/api/conversations',async req=>{const u=user(req);return {items:db.prepare('SELECT id,title,created_at,updated_at,generating FROM conversations WHERE user_id=? ORDER BY updated_at DESC,id DESC').all(u.id)};});
 app.post('/api/conversations',async(req,reply)=>{const u=user(req);const at=new Date().toISOString();const r=db.prepare("INSERT INTO conversations(user_id,title,created_at,updated_at) VALUES(?,'新会话',?,?)").run(u.id,at,at);reply.code(201);return view(Number(r.lastInsertRowid),u.id);});
 app.get('/api/conversations/:id',async req=>{const u=user(req);return view(id(req),u.id);});
 app.patch('/api/conversations/:id',async req=>{const u=user(req),cid=id(req);owned(cid,u.id);const b=parse(z.object({title:z.string().trim().min(1,'请输入会话名称').max(60,'会话名称最多60字')}).strict(),req.body);db.prepare('UPDATE conversations SET title=? WHERE id=?').run(b.title,cid);return view(cid,u.id);});
 app.delete('/api/conversations/:id',async req=>{const u=user(req),cid=id(req);owned(cid,u.id);db.prepare('DELETE FROM conversations WHERE id=?').run(cid);return {ok:true};});
 app.post('/api/conversations/:id/messages',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>{
  const u=user(req),cid=id(req);const c=owned(cid,u.id);
  const {question}=parse(z.object({question:z.string().trim().min(2,'请至少输入两个字').max(1000,'问题最多1000字')}).strict(),req.body);
  if(c.generating)fail(409,'这个会话正在回答，请等回答完成后再发送');
  const old=view(cid,u.id).messages;
  if(old.length>=200)fail(400,'这个会话已达到100轮，请新建会话继续');
  const history:HistoryTurn[]=old.filter((m:any)=>m.mode!=='pending'&&m.mode!=='error'&&m.mode!=='stale').slice(-12).map((m:any)=>({role:m.role,content:m.content.slice(0,3000)}));
  const at=new Date().toISOString();
  const assistantId=db.transaction(()=>{
   db.prepare('UPDATE conversations SET generating=1,title=?,updated_at=? WHERE id=?').run(!old.length&&c.title==='新会话'?question.slice(0,40):c.title,at,cid);
   db.prepare("INSERT INTO messages(conversation_id,role,content,mode,created_at) VALUES(?,'user',?,'message',?)").run(cid,question,at);
   return Number(db.prepare("INSERT INTO messages(conversation_id,role,content,mode,created_at) VALUES(?,'assistant','','pending',?)").run(cid,at).lastInsertRowid);
  })();
  try{
   const result=await answer(question,history);
   user(req);owned(cid,u.id); // User or conversation may have been removed while the model was running.
   db.transaction(()=>{db.prepare('UPDATE messages SET content=?,mode=?,citations_json=? WHERE id=?').run(result.answer,result.mode,JSON.stringify(result.citations),assistantId);db.prepare('UPDATE conversations SET generating=0,updated_at=? WHERE id=?').run(new Date().toISOString(),cid);})();
   return view(cid,u.id);
  }catch(e:any){
   const message=e.publicMessage?e.message:'本次回答未完成，请稍后重新发送问题';
   db.transaction(()=>{db.prepare("UPDATE messages SET content=?,mode='error' WHERE id=?").run(message,assistantId);db.prepare('UPDATE conversations SET generating=0 WHERE id=?').run(cid);})();throw e;
  }
 });
}
