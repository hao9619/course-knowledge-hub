import { readFileSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const sources=JSON.parse(readFileSync(join(root,'demo-data/external/sources.json'),'utf8'));
const accounts=readFileSync(join(root,'backend/runtime/course/accounts.txt'),'utf8');
const login=await fetch('http://127.0.0.1:8210/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:accounts.match(/^admin: (.+)$/m)[1]})});
if(!login.ok)throw new Error('Login failed');const cookie=login.headers.get('set-cookie').split(';')[0];
const api=async(method,path,body)=>{const r=await fetch('http://127.0.0.1:8210/api'+path,{method,headers:{cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});if(!r.ok)throw new Error(path+' '+await r.text());return r.json();};
let meta=await api('GET','/meta');
for(const name of ['数据结构与算法','程序设计基础'])if(!meta.categories.some(c=>c.name===name))await api('POST','/categories',{name,parent_id:null});
meta=await api('GET','/meta');
const results=[];
for(const src of sources){
 const category_id=meta.categories.find(c=>c.name===src.category).id;
 let r=(await api('GET','/resources?scope=manage&q='+encodeURIComponent(src.title))).items.find(r=>r.title===src.title);
 const body=`【网络真实资料】\n原作者/项目：${src.author}\n来源：${src.source}\n许可：${src.license}\n下载日期：${src.downloaded_at.slice(0,10)}\n附件 SHA-256：${src.sha256}\n\n${src.transformation}\n\n学习导读：${src.summary}\n请阅读原始附件；Markdown/AsciiDoc 中的相对图片与模板语法请在来源页面查看。`;
 const spec={title:src.title,summary:src.summary,body,kind:src.filename.endsWith('.mp4')?'video':'document',category_id,status:'draft',tags:['网络教材',...src.tags]};
 if(!r)r=await api('POST','/resources',spec);else r=await api('GET','/resources/'+r.id);
 if(!r.attachments.some(a=>a.filename===src.filename)){
  const data=new FormData();data.append('file',new Blob([readFileSync(join(root,'demo-data/external',src.filename))]),src.filename);
  r=(await api('POST','/resources/'+r.id+'/files',data)).resource;
 }
 if(r.status!=='published')r=await api('PUT','/resources/'+r.id,{...spec,status:'published',revision:r.revision});
 results.push({title:r.title,id:r.id,files:r.attachments.map(f=>({id:f.id,filename:f.filename,text_length:f.text_length}))});console.log(r.title,r.attachments.map(f=>f.text_length));
}
writeFileSync(join(root,'report/evidence/imported-sources.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));
