import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildCourseApp } from './app.js';
import { parseAttachment } from './files.js';
import JSZip from 'jszip';
const testRoot=fileURLToPath(new URL('../runtime/tests/',import.meta.url));mkdirSync(testRoot,{recursive:true});
async function fixture(t:any, extra:Record<string,any>={}) {
 const dir=mkdtempSync(join(testRoot,'case-'));const app=await buildCourseApp({dir,passwords:{admin:'admin-test-password',student:'student-test-password'},...extra});
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const login=async(username:string,password:string)=>{const r=await app.inject({method:'POST',url:'/api/login',payload:{username,password}});assert.equal(r.statusCode,200,r.body);return String(r.headers['set-cookie']).split(';')[0]!;};
 const admin=await login('admin','admin-test-password'),student=await login('student','student-test-password');
 const call=async(method:any,url:string,payload?:any,cookie=admin)=>app.inject({method,url,payload,headers:{cookie}});
 return {app,call,admin,student};
}
const sample=(patch:any={})=>({title:'测试资料',summary:'用于真实接口测试',body:'原子性保持事务一致，专业课程资料内容。',kind:'article',category_id:7,status:'draft',tags:['测试'],...patch});
test('auth: anonymous, invalid credentials, CSRF and logout',async t=>{
 const {app,call,admin}=await fixture(t);
 assert.equal((await app.inject('/api/resources')).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password:'bad'}})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:'/api/resources',headers:{cookie:admin,origin:'https://other.example'},payload:sample()})).statusCode,403);
 assert.equal((await call('POST','/api/logout')).statusCode,200);
 assert.equal((await call('GET','/api/me')).statusCode,401);
});
test('lifecycle: draft private, publish visible, archive hidden, restore, delete',async t=>{
 const {call,student}=await fixture(t);
 let r=await call('POST','/api/resources',sample({body:'生命周期独有关键词'}));assert.equal(r.statusCode,201,r.body);let v=r.json();
 assert.equal((await call('GET','/api/resources/'+v.id,undefined,student)).statusCode,404);
 assert.equal((await call('GET','/api/resources?q=生命周期独有关键词',undefined,student)).json().total,0);
 r=await call('PUT','/api/resources/'+v.id,{...sample({body:'生命周期独有关键词',status:'published'}),revision:v.revision});v=r.json();assert.equal(r.statusCode,200,r.body);
 assert.equal((await call('GET','/api/resources?q=生命周期独有关键词',undefined,student)).json().total,1);
 assert.equal((await call('PUT','/api/resources/'+v.id,{...sample(),revision:v.revision},student)).statusCode,403);
 r=await call('PUT','/api/resources/'+v.id,{...sample({body:'生命周期独有关键词',status:'archived'}),revision:v.revision});v=r.json();
 assert.equal((await call('GET','/api/resources?q=生命周期独有关键词',undefined,student)).json().total,0);
 const rag=(await call('POST','/api/ask',{question:'生命周期独有关键词'},student)).json();assert.ok(rag.citations.every((c:any)=>c.resource_id!==v.id));
 r=await call('PUT','/api/resources/'+v.id,{...sample(),revision:v.revision});assert.equal(r.json().status,'draft');
 assert.equal((await call('DELETE','/api/resources/'+v.id)).statusCode,200);
 assert.equal((await call('GET','/api/resources/'+v.id)).statusCode,404);
});
test('full text: body-only Chinese words, short words, literal quotes, index replacement, stale revision',async t=>{
 const {call}=await fixture(t);
 const v=(await call('POST','/api/resources',sample({title:'题目中没有关键词',body:'稀有独特检索词 范式',status:'published',tags:['索引专用标签']}))).json();
 assert.equal((await call('GET','/api/resources?q=稀有独特检索词')).json().total,1);
 assert.ok((await call('GET','/api/resources?q=范式')).json().total>=1);
 assert.equal((await call('GET','/api/resources?q=索引专用标签')).json().total,1);
 assert.equal((await call('GET','/api/resources?q='+encodeURIComponent('" OR *'))).statusCode,200);
 const change={...sample({body:'新的唯一检索词',status:'published'}),revision:v.revision};
 assert.equal((await call('PUT','/api/resources/'+v.id,change)).statusCode,200);
 assert.equal((await call('GET','/api/resources?q=稀有独特检索词')).json().total,0);
 assert.equal((await call('GET','/api/resources?q=新的唯一检索词')).json().total,1);
 assert.equal((await call('PUT','/api/resources/'+v.id,change)).statusCode,409);
});
test('search regression: exact resource IDs for long, two-character, single-character and mixed keywords',async t=>{
 const {call}=await fixture(t);
 const v=(await call('POST','/api/resources',sample({title:'标题霁月测试',body:'正文含有云岫和MixedCASE',summary:'摘要清晖',tags:['标签青岚'],status:'published'}))).json();
 for(const q of ['霁月','霁','云岫','清晖','青岚','mixedcase','云岫 mixedcase']){
  const r=await call('GET','/api/resources?q='+encodeURIComponent(q));assert.equal(r.statusCode,200);assert.ok(r.json().items.some((x:any)=>x.id===v.id),q);
 }
 const long=(await call('GET','/api/resources?q=数据库范式')).json().items;
 const short=(await call('GET','/api/resources?q=范式')).json().items;
 assert.ok(long.length);assert.ok(long.every((x:any)=>short.some((y:any)=>x.id===y.id)));
 assert.equal((await call('GET','/api/resources?q='+encodeURIComponent('霁月 不存在词'))).json().total,0);
});
test('advanced search: descendant category, type, tag, author, date; user management scope denied',async t=>{
 const {call,student}=await fixture(t);
 await call('POST','/api/resources',sample({title:'组合筛选专用',status:'published',kind:'paper',tags:['组合筛选']}));
 const q='/api/resources?q=组合筛选专用&category=2&kind=paper&tag=组合筛选&author=课程管理员&from=2020-01-01&to=2099-01-01';
 assert.equal((await call('GET',q)).json().total,1);
 assert.equal((await call('GET',q.replace('kind=paper','kind=video'))).json().total,0);
 assert.equal((await call('GET','/api/resources?scope=manage',undefined,student)).statusCode,403);
 assert.equal((await call('GET','/api/resources?scope=mine',undefined,student)).json().total,0);
});
test('categories: hierarchy and referential constraints',async t=>{
 const {call,student}=await fixture(t);
 assert.equal((await call('POST','/api/categories',{name:'不允许',parent_id:null},student)).statusCode,403);
 const parent=(await call('POST','/api/categories',{name:'测试顶级',parent_id:null})).json();
 const child=(await call('POST','/api/categories',{name:'测试子级',parent_id:parent.id})).json();
 assert.equal((await call('DELETE','/api/categories/'+parent.id)).statusCode,409);
 assert.equal((await call('POST','/api/categories',{name:'测试顶级',parent_id:null})).statusCode,409);
 assert.equal((await call('DELETE','/api/categories/'+child.id)).statusCode,200);
 assert.equal((await call('DELETE','/api/categories/'+parent.id)).statusCode,200);
 assert.equal((await call('DELETE','/api/categories/7')).statusCode,409);
});
test('attachments: Chinese filename, extracted text search, downloads and removal',async t=>{
 const {app,call,admin,student}=await fixture(t);
 const v=(await call('POST','/api/resources',sample())).json();
 const payload=Buffer.from('--course-boundary\r\nContent-Disposition: form-data; name="file"; filename="中文资料.txt"\r\nContent-Type: text/plain\r\n\r\n附件独有验收关键词\r\n--course-boundary--\r\n');
 const uploaded=await app.inject({method:'POST',url:`/api/resources/${v.id}/files`,headers:{cookie:admin,'content-type':'multipart/form-data; boundary=course-boundary'},payload});
 assert.equal(uploaded.statusCode,201,uploaded.body);const d=uploaded.json().resource;const f=d.attachments[0];
 assert.equal(f.filename,'中文资料.txt');
 assert.equal((await call('GET','/api/files/'+f.id,undefined,student)).statusCode,404);
 assert.match((await call('GET','/api/files/'+f.id)).body,/附件独有验收关键词/);
 assert.equal((await call('GET','/api/resources?scope=manage&q=附件独有验收关键词')).json().total,1);
 assert.ok((await call('GET','/api/resources?scope=manage&q=验收')).json().items.some((x:any)=>x.id===v.id));
 assert.equal((await call('DELETE','/api/files/'+f.id)).statusCode,200);
 assert.equal((await call('GET','/api/resources?scope=manage&q=附件独有验收关键词')).json().total,0);
});
test('file parser: Word extraction, invalid content and unsupported formats',async()=>{
 const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="test"><w:p><w:r><w:t>事务与范式 &amp; SQL</w:t></w:r></w:p></w:document>');
 const parsed=await parseAttachment('资料.docx',await zip.generateAsync({type:'nodebuffer'}));assert.match(parsed.text,/事务与范式 & SQL/);
 await assert.rejects(parseAttachment('假.pdf',Buffer.from('not PDF')));
 await assert.rejects(parseAttachment('恶意.html',Buffer.from('<script>alert(1)</script>')));
 await assert.rejects(parseAttachment('空.txt',Buffer.alloc(0)));
 await assert.rejects(parseAttachment('伪文本.txt',Buffer.from([1,0,2])));
});
test('RAG: retrieval is real and an unconfigured model is labelled without fabricating an answer',async t=>{
 const {call}=await fixture(t);const r=await call('POST','/api/ask',{question:'数据库范式有什么作用？'});assert.equal(r.statusCode,200,r.body);const data=r.json();assert.equal(data.mode,'retrieval_only');assert.ok(data.citations.length>0);assert.ok(data.citations.some((c:any)=>c.title.includes('范式')));
 assert.equal((await call('POST','/api/ask',{question:'qzxvnomatch987654321'})).json().mode,'no_evidence');
});

test('model response: invalid citations rejected and in-flight archived evidence never returned',async t=>{
 let responseMode='invalid';let signalStarted:()=>void=()=>{};let release:()=>void=()=>{};
 const server=createServer(async(req,res)=>{
  for await (const _ of req) { /* Consume the test-only model request. */ }
  if(responseMode==='delayed'){signalStarted();await new Promise<void>(resolve=>{release=resolve;});}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:responseMode==='invalid'?'错误引用[999]':'依据已发布的课程资料[1]'}}]}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const {call}=await fixture(t,{model:{url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,key:'local-test-only',name:'mock'}});
 const invalid=await call('POST','/api/ask',{question:'数据库范式有什么作用？'});assert.equal(invalid.json().mode,'retrieval_only');assert.match(invalid.json().answer,/引用编号检查/);
 const created=(await call('POST','/api/resources',sample({title:'并发归档验证',body:'并发归档专用词说明测试期间的资料可见性。',status:'published'}))).json();
 responseMode='delayed';const started=new Promise<void>(resolve=>{signalStarted=resolve;});
 const pending=call('POST','/api/ask',{question:'并发归档专用词'});await started;
 const archived=await call('PUT','/api/resources/'+created.id,{...sample({title:'并发归档验证',body:'并发归档专用词说明测试期间的资料可见性。',status:'archived'}),revision:created.revision});assert.equal(archived.statusCode,200);release();
 const answer=await pending;assert.equal(answer.statusCode,409,answer.body);assert.equal(answer.json().citations,undefined);
});

test('AI catalog: overview and semantic selection work without matching words; drafts are excluded',async t=>{
 let selectedId=0;let overview=true;const seen:any[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const request=JSON.parse(raw);const payload=JSON.parse(request.messages[1].content);seen.push(payload);
  const content=payload.catalog?JSON.stringify({overview,resource_ids:overview?[]:[selectedId],queries:overview?[]:['indivisibility']}):'根据知识库提供的资料，可以学习相关概念与实践。[1]';
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content}}]}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const {call}=await fixture(t,{model:{url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,key:'local-only',name:'mock'}});
 const draft=(await call('POST','/api/resources',sample({title:'不许泄露的草稿',body:'私密说明'}))).json();
 let response=await call('POST','/api/ask',{question:'这个平台能学啥'});
 assert.equal(response.json().mode,'generated');assert.ok(response.json().citations.length>=8);
 assert.ok(seen[0].catalog.every((r:any)=>r.id!==draft.id));
 assert.ok(response.json().citations.every((r:any)=>r.resource_id!==draft.id));
 selectedId=(await call('POST','/api/resources',sample({title:'特定英文资料',summary:'执行过程',body:'indivisibility: operations succeed or fail as a whole.',status:'published'}))).json().id;
 overview=false;response=await call('POST','/api/ask',{question:'扣钱成功但是票没买到这种情况怎么办'});
 assert.equal(response.json().mode,'generated');assert.ok(response.json().citations.some((r:any)=>r.resource_id===selectedId));
 assert.ok(seen.at(-1).sources.some((r:any)=>r.text.includes('indivisibility')));
});

test('catalog counts and tags only represent published resources and include descendant categories',async t=>{
 const {call}=await fixture(t);const name='有内容才出现的标签';
 const r=(await call('POST','/api/resources',sample({tags:[name]}))).json();
 let meta=(await call('GET','/api/meta')).json();assert.ok(!meta.tags.some((t:any)=>t.name===name));
 const oldCount=meta.categories.find((c:any)=>c.id===2).count;
 await call('PUT','/api/resources/'+r.id,{...sample({tags:[name],status:'published'}),revision:r.revision});
 meta=(await call('GET','/api/meta')).json();assert.equal(meta.tags.find((t:any)=>t.name===name).count,1);assert.equal(meta.categories.find((c:any)=>c.id===2).count,oldCount+1);
});

test('profiles: both roles edit only their own fields; private profile is not published',async t=>{
 const {app,call,student}=await fixture(t);
 assert.equal((await app.inject({method:'PUT',url:'/api/me',payload:{display_name:'匿名',email:'',bio:''}})).statusCode,401);
 for(const cookie of [student,(await call('POST','/api/login',{username:'admin',password:'admin-test-password'})).headers['set-cookie']!.toString().split(';')[0]!]){
  const original=(await call('GET','/api/me',undefined,cookie)).json();
  assert.equal((await call('PUT','/api/me',{display_name:'新昵称',email:'bad-email',bio:''},cookie)).statusCode,400);
  assert.equal((await call('PUT','/api/me',{display_name:'新昵称',email:'',bio:'',role:'admin'},cookie)).statusCode,400);
  assert.equal((await call('PUT','/api/me',{display_name:'新昵称',email:'',bio:'',id:999},cookie)).statusCode,400);
  const result=await call('PUT','/api/me',{display_name:original.username+'昵称',email:original.username+'@example.test',bio:'个人学习介绍'},cookie);
  assert.equal(result.statusCode,200);assert.equal(result.json().id,original.id);assert.equal(result.json().role,original.role);assert.equal(result.json().password_hash,undefined);
  assert.equal((await call('GET','/api/me',undefined,cookie)).json().bio,'个人学习介绍');
 }
 const publicData=(await call('GET','/api/resources')).body;assert.ok(!publicData.includes('@example.test'));assert.ok(!publicData.includes('个人学习介绍'));
 assert.equal((await call('GET','/api/me',undefined,student)).json().display_name,'student昵称');
});
for(const role of ['admin','student'])test(`password change: ${role} verifies old password and revokes other sessions only`,async t=>{
 const {app,call,admin,student}=await fixture(t);const cookie=role==='admin'?admin:student;
 const otherLogin=await call('POST','/api/login',{username:role,password:role+'-test-password'});const other=String(otherLogin.headers['set-cookie']).split(';')[0]!;
 const payload={current_password:role+'-test-password',new_password:'new-demo-password',confirm_password:'new-demo-password'};
 assert.equal((await call('POST','/api/me/password',{...payload,current_password:'wrong'},cookie)).statusCode,400);
 assert.equal((await call('POST','/api/me/password',{...payload,confirm_password:'mismatch'},cookie)).statusCode,400);
 assert.equal((await call('POST','/api/me/password',payload,cookie)).statusCode,200);
 assert.equal((await call('GET','/api/me',undefined,cookie)).statusCode,200);
 assert.equal((await call('GET','/api/me',undefined,other)).statusCode,401);
 assert.equal((await call('GET','/api/me',undefined,role==='admin'?student:admin)).statusCode,200);
 assert.equal((await app.inject({method:'POST',url:'/api/login',payload:{username:role,password:role+'-test-password'}})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:'/api/login',payload:{username:role,password:'new-demo-password'}})).statusCode,200);
});

test('management scope: administrator mine excludes student uploads while manage includes them',async t=>{
 const {call,student}=await fixture(t);
 const r=(await call('POST','/api/resources',sample({title:'学生独立资料',status:'draft'}),student)).json();
 assert.ok(!(await call('GET','/api/resources?scope=mine')).json().items.some((x:any)=>x.id===r.id));
 assert.ok((await call('GET','/api/resources?scope=manage')).json().items.some((x:any)=>x.id===r.id));
 assert.ok((await call('GET','/api/resources?scope=mine',undefined,student)).json().items.some((x:any)=>x.id===r.id));
 assert.equal((await call('GET','/api/resources?scope=manage',undefined,student)).statusCode,403);
});

test('profile migration preserves existing accounts, passwords, resources and saved settings',async t=>{
 const {openStore,passwordMatches}=await import('./store.js');
 const dir=mkdtempSync(join(testRoot,'migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let db=openStore(dir,{admin:'old-admin-password',student:'old-student-password'});
 const before=(db.prepare('SELECT COUNT(*) n FROM resources').get() as any).n;
 db.exec('ALTER TABLE users DROP COLUMN email; ALTER TABLE users DROP COLUMN bio;');db.close();
 db=openStore(dir);
 try{
  const u=db.prepare("SELECT * FROM users WHERE username='admin'").get() as any;
  assert.equal(u.email,'');assert.equal(u.bio,'');assert.ok(passwordMatches('old-admin-password',u.password_hash));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM resources').get() as any).n,before);
  db.prepare("UPDATE users SET email=?,bio=? WHERE username='student'").run('student@example.test','已保存简介');
 }finally{db.close();}
 db=openStore(dir);try{assert.equal((db.prepare("SELECT bio FROM users WHERE username='student'").get() as any).bio,'已保存简介');}finally{db.close();}
});

test('public validation: empty login, malformed requests and parser failures return Chinese without internals',async t=>{
 const {app,call}=await fixture(t);
 for(const payload of [{username:'',password:''},{username:'admin',password:''},{}]){
  const r=await app.inject({method:'POST',url:'/api/login',payload});assert.equal(r.statusCode,400);assert.match(r.json().message,/[\u3400-\u9fff]/);assert.doesNotMatch(r.body,/Zod|Too small|Invalid input|stack|at .*\.ts/);
 }
 const malformed=await app.inject({method:'POST',url:'/api/login',headers:{'content-type':'application/json'},payload:'{invalid'});assert.equal(malformed.statusCode,400);assert.equal(malformed.json().message,'请求内容不正确，请检查填写信息');
 assert.equal((await call('POST','/api/register',{username:'new_user',display_name:'新用户',password:'new-password',confirm_password:'new-password',role:'admin'})).statusCode,400);
});

test('registration: unique student account, session, password hashing and no self-elevation',async t=>{
 const {app,call}=await fixture(t);const b={username:'New_Student',display_name:'新同学',password:'register-pass',confirm_password:'register-pass'};
 const r=await app.inject({method:'POST',url:'/api/register',payload:b});assert.equal(r.statusCode,201,r.body);assert.equal(r.json().role,'student');assert.equal(r.json().username,'new_student');assert.equal(r.json().password_hash,undefined);
 const cookie=String(r.headers['set-cookie']).split(';')[0]!;assert.equal((await call('GET','/api/me',undefined,cookie)).json().display_name,'新同学');
 assert.equal((await app.inject({method:'POST',url:'/api/register',payload:b})).statusCode,409);
 assert.equal((await app.inject({method:'POST',url:'/api/register',payload:{...b,username:'another',confirm_password:'wrong'}})).statusCode,400);
 assert.equal((await call('GET','/api/users',undefined,cookie)).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/login',payload:{username:'NEW_STUDENT',password:'register-pass'}})).statusCode,200);
});

test('user administration: add, role, suspend, reset password, transfer content and delete',async t=>{
 const {call,student}=await fixture(t);
 assert.equal((await call('POST','/api/users',{username:'denied',display_name:'无权',password:'test-password',role:'admin'},student)).statusCode,403);
 let r=await call('POST','/api/users',{username:'managed_user',display_name:'受管用户',password:'initial-pass',role:'student'});assert.equal(r.statusCode,201);const target=r.json();
 const login=async(password:string)=>{const r=await call('POST','/api/login',{username:'managed_user',password});assert.equal(r.statusCode,200,r.body);return String(r.headers['set-cookie']).split(';')[0]!;};let cookie=await login('initial-pass');
 const resource=(await call('POST','/api/resources',sample({title:'需要移交的资料',body:'移交专用检索词',status:'published'}),cookie)).json();
 const conversation=(await call('POST','/api/conversations',undefined,cookie)).json();
 await call('POST','/api/conversations/'+conversation.id+'/messages',{question:'数据库范式'},cookie);
 assert.equal((await call('PATCH','/api/users/'+target.id,{role:'admin',disabled:false})).statusCode,200);assert.equal((await call('GET','/api/me',undefined,cookie)).statusCode,401);cookie=await login('initial-pass');assert.equal((await call('GET','/api/users',undefined,cookie)).statusCode,200);
 assert.equal((await call('PATCH','/api/users/'+target.id,{role:'student',disabled:true})).statusCode,200);assert.equal((await call('POST','/api/login',{username:'managed_user',password:'initial-pass'})).statusCode,403);
 await call('PATCH','/api/users/'+target.id,{role:'student',disabled:false});await call('POST','/api/users/'+target.id+'/password',{password:'replacement-pass'});cookie=await login('replacement-pass');
 assert.equal((await call('DELETE','/api/users/'+target.id)).statusCode,409);
 const actor=(await call('GET','/api/me')).json();assert.equal((await call('DELETE','/api/users/'+actor.id)).statusCode,400);assert.equal((await call('PATCH','/api/users/'+actor.id,{role:'student',disabled:true})).statusCode,400);
 r=await call('DELETE','/api/users/'+target.id,{transfer_to:actor.id});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().transferred,1);
 assert.equal((await call('GET','/api/resources/'+resource.id)).json().author_id,actor.id);assert.equal((await call('GET','/api/resources?q=移交专用检索词')).json().total,1);assert.equal((await call('GET','/api/me',undefined,cookie)).statusCode,401);assert.equal((await call('GET','/api/conversations/'+conversation.id)).statusCode,404);
 assert.ok(!(await call('GET','/api/users')).json().items.some((x:any)=>x.id===target.id));
});

test('conversations: private CRUD, saved turns and invalidated historical citations',async t=>{
 const {call,student}=await fixture(t);const c=(await call('POST','/api/conversations',undefined,student)).json();
 assert.equal((await call('GET','/api/conversations/'+c.id)).statusCode,404);
 assert.equal((await call('PATCH','/api/conversations/'+c.id,{title:'越权'})).statusCode,404);
 assert.equal((await call('DELETE','/api/conversations/'+c.id)).statusCode,404);
 const answer=await call('POST','/api/conversations/'+c.id+'/messages',{question:'数据库范式有什么作用'},student);assert.equal(answer.statusCode,200,answer.body);
 assert.equal(answer.json().messages.length,2);assert.equal(answer.json().messages[0].role,'user');assert.equal(answer.json().messages[1].role,'assistant');
 await call('PATCH','/api/conversations/'+c.id,{title:'我的数据库学习'},student);assert.equal((await call('GET','/api/conversations/'+c.id,undefined,student)).json().title,'我的数据库学习');
 const citation=answer.json().messages[1].citations[0];const resource=(await call('GET','/api/resources/'+citation.resource_id)).json();const {title,summary,body,kind,category_id,tags,revision}=resource;
 await call('PUT','/api/resources/'+resource.id,{title,summary,body,kind,category_id,tags,revision,status:'archived'});
 const history=(await call('GET','/api/conversations/'+c.id,undefined,student)).json();assert.equal(history.messages[1].mode,'stale');assert.deepEqual(history.messages[1].citations,[]);
 assert.equal((await call('GET','/api/conversations')).json().items.length,0);
 assert.equal((await call('DELETE','/api/conversations/'+c.id,undefined,student)).statusCode,200);assert.equal((await call('GET','/api/conversations/'+c.id,undefined,student)).statusCode,404);
});

test('multi-turn generation: planning and answer receive conversation history; no cross-chat context',async t=>{
 const seen:any[]=[];const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);const payload=JSON.parse(body.messages[1].content);seen.push(payload);
  const content=payload.catalog?JSON.stringify({overview:false,resource_ids:[2],queries:['数据库范式']}):'根据本次知识资料说明数据库范式。[1]';
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content}}]}));
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const {call}=await fixture(t,{model:{url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,key:'local-test',name:'mock'}});
 const c=(await call('POST','/api/conversations')).json();
 assert.equal((await call('POST','/api/conversations/'+c.id+'/messages',{question:'什么是数据库范式'})).statusCode,200);
 const follow=await call('POST','/api/conversations/'+c.id+'/messages',{question:'再举个它的例子'});assert.equal(follow.statusCode,200,follow.body);assert.equal(follow.json().messages.length,4);
 assert.ok(seen[2].history.some((m:any)=>m.role==='user'&&m.content==='什么是数据库范式'));assert.ok(seen[3].history.some((m:any)=>m.role==='assistant'));
 const other=(await call('POST','/api/conversations')).json();await call('POST','/api/conversations/'+other.id+'/messages',{question:'这个平台能学啥'});assert.deepEqual(seen[4].history,[]);
});

test('conversation races: duplicate send rejected and deleted chat is not recreated after model completion',async t=>{
 let signal:()=>void=()=>{};let release:()=>void=()=>{};const started=new Promise<void>(resolve=>{signal=resolve;});
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(JSON.parse(raw).messages[1].content);
  let content='';if(payload.catalog)content=JSON.stringify({overview:false,resource_ids:[2],queries:['范式']});else{signal();await new Promise<void>(resolve=>{release=resolve;});content='数据库范式的说明。[1]';}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content}}]}));
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const {call}=await fixture(t,{model:{url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,key:'local-test',name:'mock'}});const c=(await call('POST','/api/conversations')).json();
 const pending=call('POST','/api/conversations/'+c.id+'/messages',{question:'数据库范式'});await started;
 assert.equal((await call('POST','/api/conversations/'+c.id+'/messages',{question:'重复问题'})).statusCode,409);
 assert.equal((await call('DELETE','/api/conversations/'+c.id)).statusCode,200);release();assert.equal((await pending).statusCode,404);
 assert.equal((await call('GET','/api/conversations')).json().items.length,0);
});

test('conversation storage: restart preserves completed history and marks interrupted answers retryable',async t=>{
 const {openStore}=await import('./store.js');const dir=mkdtempSync(join(testRoot,'chat-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let db=openStore(dir,{admin:'admin-restart',student:'student-restart'});const at=new Date().toISOString();
 const uid=(db.prepare("SELECT id FROM users WHERE username='student'").get() as any).id;
 const cid=Number(db.prepare('INSERT INTO conversations(user_id,title,created_at,updated_at,generating) VALUES(?,?,?,?,1)').run(uid,'保留的会话',at,at).lastInsertRowid);
 db.prepare("INSERT INTO messages(conversation_id,role,content,mode,created_at) VALUES(?,'user','解释数据库范式','message',?)").run(cid,at);
 db.prepare("INSERT INTO messages(conversation_id,role,content,mode,created_at) VALUES(?,'assistant','','pending',?)").run(cid,at);db.close();
 db=openStore(dir);try{assert.equal((db.prepare('SELECT generating FROM conversations WHERE id=?').get(cid) as any).generating,0);const messages=db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all(cid) as any[];assert.equal(messages[0].content,'解释数据库范式');assert.equal(messages[1].mode,'error');assert.match(messages[1].content,/服务已重启/);}finally{db.close();}
});

test('deleted resource ID reuse must not revive historical citations',async t=>{
 const {call}=await fixture(t);
 const original=(await call('POST','/api/resources',sample({title:'旧引用唯一标题',body:'旧引用唯一正文',status:'published'}))).json();
 const c=(await call('POST','/api/conversations')).json();
 const answer=await call('POST',`/api/conversations/${c.id}/messages`,{question:'旧引用唯一正文'});
 assert.ok(answer.json().messages[1].citations.some((x:any)=>x.resource_id===original.id));
 await call('DELETE','/api/resources/'+original.id);
 const replacement=(await call('POST','/api/resources',sample({title:'不同的新资料',body:'无关的新内容',status:'published'}))).json();
 assert.equal(replacement.id,original.id);assert.equal(replacement.revision,original.revision);
 const history=(await call('GET','/api/conversations/'+c.id)).json();
 assert.equal(history.messages[1].mode,'stale');assert.deepEqual(history.messages[1].citations,[]);
});

test('upload revalidates a session revoked while the body is still arriving',async t=>{
 const dir=mkdtempSync(join(testRoot,'upload-revoke-'));const app=await buildCourseApp({dir,passwords:{admin:'admin-test-password',student:'student-test-password'}});
 let started!:()=>void;const receiving=new Promise<void>(resolve=>started=resolve);
 app.addHook('preHandler',async req=>{if(req.url.endsWith('/files'))setImmediate(started);});
 await app.listen({host:'127.0.0.1',port:0});t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const login=async(username:string)=>{const r=await app.inject({method:'POST',url:'/api/login',payload:{username,password:username+'-test-password'}});return String(r.headers['set-cookie']).split(';')[0]!;};
 const admin=await login('admin'),student=await login('student');
 const r=(await app.inject({method:'POST',url:'/api/resources',headers:{cookie:student},payload:sample()})).json();
 const port=(app.server.address() as AddressInfo).port;
 let upload!:ReturnType<typeof httpRequest>;
 const response=new Promise<{status:number;body:string}>((resolve,reject)=>{
  upload=httpRequest({host:'127.0.0.1',port,path:`/api/resources/${r.id}/files`,method:'POST',headers:{cookie:student,'content-type':'multipart/form-data; boundary=slow-upload'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body}));});upload.on('error',reject);
 });
 upload.write('--slow-upload\r\nContent-Disposition: form-data; name="file"; filename="slow.txt"\r\nContent-Type: text/plain\r\n\r\n未完成上传');
 await receiving;
 const disabled=await app.inject({method:'PATCH',url:'/api/users/2',headers:{cookie:admin},payload:{role:'student',disabled:true}});assert.equal(disabled.statusCode,200);
 upload.end('剩余数据\r\n--slow-upload--\r\n');const result=await response;assert.equal(result.status,401,result.body);
 const resource=(await app.inject({method:'GET',url:'/api/resources/'+r.id,headers:{cookie:admin}})).json();assert.equal(resource.attachments.length,0);assert.equal(resource.revision,r.revision);
});
