import type {FastifyInstance} from 'fastify';
import type Database from 'better-sqlite3';
import {z} from 'zod';
import {passwordHash,type User} from './store.js';
import {fail,parse,usernameSchema,newPasswordSchema,displayNameSchema} from './validation.js';
export function registerAccounts(app:FastifyInstance,db:Database.Database,user:(req:any)=>User,startSession:(u:any,reply:any)=>unknown){
 const createSchema=z.object({username:usernameSchema,password:newPasswordSchema,display_name:displayNameSchema});
 const publicUser=(id:number)=>db.prepare('SELECT id,username,display_name,role,disabled,created_at,(SELECT COUNT(*) FROM resources WHERE author_id=users.id) AS resource_count FROM users WHERE id=?').get(id) as any;
 const admin=(req:any)=>{const u=user(req);if(u.role!=='admin')fail(403,'需要管理员权限');return u;};
 const id=(req:any)=>parse(z.coerce.number().int().positive(),req.params.id);
 function create(b:{username:string;password:string;display_name:string},role:string){
  if(db.prepare('SELECT id FROM users WHERE username=?').get(b.username))fail(409,'这个账号已被使用，请换一个账号');
  return Number(db.prepare('INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(b.username,b.display_name,passwordHash(b.password),role,new Date().toISOString()).lastInsertRowid);
 }
 app.post('/api/register',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
  const b=parse(createSchema.extend({confirm_password:z.string()}).strict().refine(v=>v.password===v.confirm_password,{message:'两次密码不一致'}),req.body);
  const uid=create(b,'student');const u=db.prepare('SELECT * FROM users WHERE id=?').get(uid);reply.code(201);return startSession(u,reply);
 });
 app.get('/api/users',async req=>{admin(req);return {items:db.prepare('SELECT id,username,display_name,role,disabled,created_at,(SELECT COUNT(*) FROM resources WHERE author_id=users.id) AS resource_count FROM users ORDER BY id').all()};});
 app.post('/api/users',async(req,reply)=>{admin(req);const b=parse(createSchema.extend({role:z.enum(['admin','student'])}).strict(),req.body);const uid=create(b,b.role);reply.code(201);return publicUser(uid);});
 app.patch('/api/users/:id',async req=>{
  const actor=admin(req),uid=id(req);const b=parse(z.object({role:z.enum(['admin','student']),disabled:z.boolean()}).strict(),req.body);
  const target=publicUser(uid);if(!target)fail(404,'用户不存在');
  if(uid===actor.id&&(b.role!=='admin'||b.disabled))fail(400,'不能停用自己或取消自己的管理员权限');
  if(target.role==='admin'&&!target.disabled&&(b.role!=='admin'||b.disabled)&&(db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0").get() as any).n<=1)fail(400,'至少需要保留一个可用的管理员账号');
  db.transaction(()=>{db.prepare('UPDATE users SET role=?,disabled=? WHERE id=?').run(b.role,Number(b.disabled),uid);if(b.disabled||b.role!==target.role)db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid);})();return publicUser(uid);
 });
 app.post('/api/users/:id/password',async req=>{
  const actor=admin(req),uid=id(req);if(uid===actor.id)fail(400,'请在个人设置中修改自己的密码');if(!publicUser(uid))fail(404,'用户不存在');
  const b=parse(z.object({password:newPasswordSchema}).strict(),req.body);
  db.transaction(()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(b.password),uid);db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid);})();return {ok:true};
 });
 app.delete('/api/users/:id',async req=>{
  const actor=admin(req),uid=id(req);if(uid===actor.id)fail(400,'不能删除当前登录账号');
  const target=publicUser(uid);if(!target)fail(404,'用户不存在');
  const b=parse(z.object({transfer_to:z.number().int().positive().optional()}).strict(),req.body??{});
  if(target.resource_count&&b.transfer_to!==actor.id)fail(409,'该用户还有资料，请确认移交给当前管理员后再删除');
  db.transaction(()=>{
   if(target.resource_count)db.prepare('UPDATE resources SET author_id=?,revision=revision+1,updated_at=? WHERE author_id=?').run(actor.id,new Date().toISOString(),uid);
   db.prepare('DELETE FROM users WHERE id=?').run(uid);
  })();return {ok:true,transferred:target.resource_count};
 });
}
