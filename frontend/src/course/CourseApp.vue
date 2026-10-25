<script setup lang="ts">
import ChatPanel from './ChatPanel.vue';
import UsersPanel from './UsersPanel.vue';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Plus, Reading, Collection, ChatDotRound, FolderOpened, Setting, ArrowRight, Document, Upload, Edit, Delete, SwitchButton, Grid, Refresh, Download } from '@element-plus/icons-vue';
type Category = {id:number;name:string;parent_id:number|null;count:number};
type Attachment = {id:number;filename:string;mime:string;size:number;text_length:number};
type Resource = {id:number;title:string;summary:string;body:string;kind:string;category_id:number;category_name:string;author_id:number;author:string;status:string;revision:number;created_at:string;updated_at:string;tags:string[];attachments:Attachment[];snippet?:string};
type User = {id:number;username:string;display_name:string;role:string;email:string;bio:string};
const me=ref<User|null>(null), booting=ref(true), loginBusy=ref(false), loading=ref(false), saving=ref(false), uploading=ref(false);
const profileForm=reactive({display_name:'',email:'',bio:''});
const passwordForm=reactive({current_password:'',new_password:'',confirm_password:''});
const profileSaving=ref(false),passwordSaving=ref(false);
watch(me,u=>{if(u)Object.assign(profileForm,{display_name:u.display_name,email:u.email??'',bio:u.bio??''});else Object.assign(passwordForm,{current_password:'',new_password:'',confirm_password:''});});
const login=reactive({username:'',password:''});
const authMode=ref<'login'|'register'>('login');
const registration=reactive({display_name:'',confirm_password:''});
const authErrors=reactive({username:'',password:'',display_name:'',confirm_password:'',general:''});
function clearAuthErrors(){Object.assign(authErrors,{username:'',password:'',display_name:'',confirm_password:'',general:''});}
function toggleAuth(){authMode.value=authMode.value==='login'?'register':'login';login.password='';registration.confirm_password='';clearAuthErrors();}
const validPages=['home','library','mine','manage','ask','categories','profile','users'];
const readPage=()=>{const name=location.hash.slice(1);return validPages.includes(name)?name:'home';};
const page=ref(readPage()), categories=ref<Category[]>([]), tags=ref<{name:string;count:number}[]>([]), items=ref<Resource[]>([]), total=ref(0);
const stats=reactive({published:0,categories:0,mine:0,files:0});
const model=reactive({configured:false,name:''});
const filter=reactive({q:'',category:'',kind:'',tag:'',author:'',from:'',to:'',status:'',page:1});
const advanced=ref(false), current=ref<Resource|null>(null), detailOpen=ref(false), editOpen=ref(false), preview=ref<Attachment|null>(null);
const emptyForm=()=>({id:0,title:'',summary:'',body:'',kind:'article',category_id:7,status:'draft',tags:[] as string[],revision:1});
const pendingFiles=ref<File[]>([]);
const fileInput=ref<HTMLInputElement|null>(null);
const form=reactive(emptyForm());const categoryForm=reactive({name:'',parent_id:null as number|null});

const kinds:Record<string,string>={article:'知识文章',document:'技术文档',paper:'论文资料',video:'课程视频'};
const statuses:Record<string,string>={draft:'草稿',published:'已发布',archived:'已归档'};
const pageTitle=computed(()=>({home:'学习工作台',library:'课程知识库',mine:'我的内容',manage:'内容管理',ask:'知识问答',categories:'分类管理',profile:'个人设置',users:'用户管理'}[page.value]||'课程知识库'));
const pageNote=computed(()=>({home:'把零散的学习资料，整理成自己的知识体系。',library:'浏览和搜索已发布资料；上传与创建请前往“我的内容”。',mine:'仅显示你自己创建、上传的资料，包括草稿、已发布和已归档内容。',manage:'管理员视图：查看所有用户的资料，可维护他人上传的内容。',ask:'根据知识库内容提问，也可以了解课程全貌与学习路线。',categories:'用清晰的层次组织课程知识。',profile:'管理你的个人资料与登录密码。',users:'管理账号、角色和使用权限。'}[page.value]||''));
const categoryOptions=computed(()=>{const result:{id:number;label:string;count:number}[]=[];function walk(parent:number|null,prefix:string){for(const c of categories.value.filter(c=>c.parent_id===parent)){result.push({id:c.id,label:prefix+c.name,count:c.count});walk(c.id,prefix+'　');}}walk(null,'');return result;});
const sourceLinks=computed(()=>[...new Set(current.value?.body.match(/https:\/\/[^\s<>]+/g)??[])]);
const canEdit=computed(()=>['mine','manage'].includes(page.value)&&!!current.value&&(me.value?.role==='admin'||current.value.author_id===me.value?.id));
const navigation=computed(()=>[{id:'home',label:'学习工作台',icon:Grid},{id:'library',label:'课程知识库',icon:Collection},{id:'ask',label:'知识问答',icon:ChatDotRound},{id:'mine',label:'我的内容',icon:FolderOpened},{id:'profile',label:'个人设置',icon:Setting},...(me.value?.role==='admin'?[{id:'manage',label:'内容管理',icon:Document},{id:'categories',label:'分类管理',icon:Setting},{id:'users',label:'用户管理',icon:Setting}]:[])]);
async function api(path:string,options:RequestInit={}) {
 const headers=new Headers(options.headers);if(options.body&&!(options.body instanceof FormData))headers.set('Content-Type','application/json');
 let r:Response;try{r=await fetch('/api'+path,{...options,headers});}catch{throw new Error('无法连接服务器，请检查连接后重试');}let data:any;try{data=await r.json();}catch{throw new Error('服务返回异常，请稍后重试');}if(!r.ok){if(r.status===401)me.value=null;throw new Error(typeof data.message==='string'&&/[\u3400-\u9fff]/.test(data.message)?data.message:'请求未完成，请稍后重试');}return data;
}
function error(e:unknown){ElMessage.error(e instanceof Error?e.message:'操作失败，请重试');}
async function metadata(){const [m,s]=await Promise.all([api('/meta'),api('/stats')]);categories.value=m.categories;tags.value=m.tags;Object.assign(model,m.model);Object.assign(stats,s);}
let requestSequence=0;
async function load(){const seq=++requestSequence;loading.value=true;try{const q=new URLSearchParams();for(const [k,v] of Object.entries(filter))if(v)q.set(k,String(v));q.set('scope',page.value==='mine'?'mine':page.value==='manage'?'manage':'library');const data=await api('/resources?'+q);if(seq===requestSequence){items.value=data.items;total.value=data.total;}}catch(e){error(e);}finally{if(seq===requestSequence)loading.value=false;}}
async function signIn(){
 clearAuthErrors();
 if(!login.username.trim())authErrors.username='请输入账号';
 if(!login.password)authErrors.password='请输入密码';
 if(authMode.value==='register'){
  if(!/^[a-zA-Z0-9_-]{3,30}$/.test(login.username.trim()))authErrors.username='账号需要3至30位字母、数字、下划线或短横线';
  if(login.password.length<8)authErrors.password='密码至少8位';
  if(!registration.display_name.trim())authErrors.display_name='请填写昵称';
  if(login.password!==registration.confirm_password)authErrors.confirm_password='两次密码不一致';
 }
 if(Object.values(authErrors).some(Boolean))return;
 loginBusy.value=true;
 try{
  me.value=await api(authMode.value==='login'?'/login':'/register',{method:'POST',body:JSON.stringify(authMode.value==='login'?login:{...login,...registration})});
  if(me.value?.role!=='admin'&&['manage','categories','users'].includes(page.value))page.value='home';
  login.password='';registration.confirm_password='';authMode.value='login';await metadata();await load();
 }catch(e){authErrors.general=e instanceof Error?e.message:'暂时无法登录，请稍后重试';}finally{loginBusy.value=false;}
}
async function signOut(){try{await api('/logout',{method:'POST'});me.value=null;page.value='home';current.value=null;detailOpen.value=false;}catch(e){error(e);}}
async function saveProfile(){profileSaving.value=true;try{me.value=await api('/me',{method:'PUT',body:JSON.stringify(profileForm)});ElMessage.success('个人资料已保存');}catch(e){error(e);}finally{profileSaving.value=false;}}
async function changePassword(){if(passwordForm.new_password!==passwordForm.confirm_password){ElMessage.warning('两次新密码不一致');return;}passwordSaving.value=true;try{await api('/me/password',{method:'POST',body:JSON.stringify(passwordForm)});Object.assign(passwordForm,{current_password:'',new_password:'',confirm_password:''});ElMessage.success('密码已更新，其他登录会话已退出');}catch(e){error(e);}finally{passwordSaving.value=false;}}
function clearFilters(){Object.assign(filter,{q:'',category:'',kind:'',tag:'',author:'',from:'',to:'',status:'',page:1});}
function navigate(id:string){page.value=id;clearFilters();if(['home','library','mine','manage'].includes(id))void load();}
let searchTimer:ReturnType<typeof setTimeout>|undefined;
function search(){clearTimeout(searchTimer);filter.page=1;void load();}
watch(()=>filter.q,()=>{clearTimeout(searchTimer);if(me.value&&['library','mine','manage'].includes(page.value))searchTimer=setTimeout(search,350);});
onUnmounted(()=>clearTimeout(searchTimer));
const activeFilters=computed(()=>[filter.category&&('分类：'+(categories.value.find(c=>String(c.id)===filter.category)?.name||filter.category)),filter.kind&&('类型：'+kinds[filter.kind]),filter.tag&&('标签：'+filter.tag),filter.author&&('作者：'+filter.author),filter.from&&('起日：'+filter.from),filter.to&&('止日：'+filter.to),filter.status&&('状态：'+statuses[filter.status])].filter(Boolean));
function clearExtraFilters(){const q=filter.q;clearFilters();filter.q=q;search();}
function chooseTag(name:string){const previous=filter.tag;clearFilters();filter.tag=previous===name?'':name;search();}
function chooseCategory(id:number){clearFilters();if(page.value==='home')page.value='library';filter.category=String(id);search();}
async function openResource(id:number){try{current.value=await api('/resources/'+id);detailOpen.value=true;}catch(e){error(e);}}
function edit(r?:Resource){pendingFiles.value=[];Object.assign(form,emptyForm());if(r){const {id,title,summary,body,kind,category_id,status,revision,tags}=r;Object.assign(form,{id,title,summary,body,kind,category_id,status,revision,tags:[...tags]});}editOpen.value=true;}
function chooseFiles(event:Event){
 const input=event.target as HTMLInputElement;const files=Array.from(input.files??[]);
 if(files.some(f=>f.size>30*1024*1024)){ElMessage.warning('单文件不能超过 30 MB');input.value='';return;}
 pendingFiles.value.push(...files);
 if(!form.title&&files[0])form.title=files[0].name.replace(/\.[^.]+$/,'');
 if(files[0])form.kind=/\.(mp4|webm)$/i.test(files[0].name)?'video':'document';
 input.value='';
}
function uploadNew(){edit();form.kind='document';}
async function save(){
 if(!form.title.trim()){ElMessage.warning('请填写标题或选择文件');return;}
 saving.value=true;
 try{
  const {id,...body}=form;const requestedStatus=body.status;
  // Upload into a draft first; a failed upload remains editable without duplicate creation.
  const r=await api('/resources'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify({...body,status:pendingFiles.value.length?'draft':body.status})});
  let saved:Resource=r;form.id=r.id;form.revision=r.revision;
  while(pendingFiles.value.length){
   const file=pendingFiles.value[0]!;const data=new FormData();data.append('file',file);
   const result=await api('/resources/'+saved.id+'/files',{method:'POST',body:data});saved=result.resource;form.revision=saved.revision;pendingFiles.value.shift();
  }
  if(saved.status!==requestedStatus){const {title,summary,body,kind,category_id,tags,revision}=saved;saved=await api('/resources/'+saved.id,{method:'PUT',body:JSON.stringify({title,summary,body,kind,category_id,tags,revision,status:requestedStatus})});}
  editOpen.value=false;current.value=saved;detailOpen.value=true;await Promise.all([metadata(),load()]);ElMessage.success(id?'内容已更新':'资料和文件已保存到我的内容');
 }catch(e){error(e);await Promise.all([metadata(),load()]);}finally{saving.value=false;}
}
async function changeStatus(status:string){if(!current.value)return;const r=current.value;saving.value=true;try{const {title,summary,body,kind,category_id,tags,revision}=r;current.value=await api('/resources/'+r.id,{method:'PUT',body:JSON.stringify({title,summary,body,kind,category_id,tags,revision,status})});await Promise.all([metadata(),load()]);ElMessage.success(statuses[status]);}catch(e){error(e);}finally{saving.value=false;}}
async function removeResource(){if(!current.value)return;try{await ElMessageBox.confirm('删除后将同时移除附件和检索内容，无法恢复。','删除「'+current.value.title+'」',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'});}catch{return;}try{await api('/resources/'+current.value.id,{method:'DELETE'});detailOpen.value=false;current.value=null;await Promise.all([metadata(),load()]);ElMessage.success('资料已删除');}catch(e){error(e);}}
async function upload(event:Event){const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file||!current.value)return;uploading.value=true;try{const data=new FormData();data.append('file',file);const r=await api('/resources/'+current.value.id+'/files',{method:'POST',body:data});current.value=r.resource;await Promise.all([metadata(),load()]);ElMessage.success(r.note);}catch(e){error(e);}finally{uploading.value=false;input.value='';}}
async function removeFile(file:Attachment){try{await ElMessageBox.confirm('移除此附件及其检索文本？',file.filename,{confirmButtonText:'移除',cancelButtonText:'取消'});}catch{return;}try{await api('/files/'+file.id,{method:'DELETE'});await openResource(current.value!.id);await Promise.all([metadata(),load()]);}catch(e){error(e);}}
async function createCategory(){try{await api('/categories',{method:'POST',body:JSON.stringify(categoryForm)});categoryForm.name='';await metadata();ElMessage.success('分类已创建');}catch(e){error(e);}}
async function deleteCategory(c:Category){try{await ElMessageBox.confirm('仅可删除没有子分类、没有资料的分类。','删除「'+c.name+'」',{confirmButtonText:'删除',cancelButtonText:'取消'});}catch{return;}try{await api('/categories/'+c.id,{method:'DELETE'});await metadata();}catch(e){error(e);}}

const date=(s:string)=>new Date(s).toLocaleDateString('zh-CN');
const size=(n:number)=>n>1024*1024?(n/1024/1024).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';
watch(page,value=>{if(location.hash.slice(1)!==value)location.hash=value;});
function restorePage(){const target=readPage();if(target!==page.value)navigate(target);}
window.addEventListener('hashchange',restorePage);
onUnmounted(()=>window.removeEventListener('hashchange',restorePage));
onMounted(async()=>{try{me.value=await api('/me');if(me.value?.role!=='admin'&&['manage','categories','users'].includes(page.value))page.value='home';await metadata();await load();}catch{/* Login screen is the expected unauthenticated state. */}finally{booting.value=false;}});
</script>

<template>
 <div v-if="booting" class="boot">正在打开课程知识库…</div>
 <div v-else-if="!me" class="login-shell">
  <section class="login-story"><div class="brand"><span class="brand-mark">知</span><span>知序 <small>COURSE KNOWLEDGE HUB</small></span></div><div class="login-copy"><div class="eyebrow">专业课程设计 II · 知识管理系统</div><h1>让知识有序，<br>让学习相连。</h1><p>整理课程资料，连接知识脉络，<br>从每一次查找中获得新的理解。</p><div class="login-topics"><span>软件工程</span><span>数据库</span><span>Web 开发</span><span>人工智能</span></div></div><div class="login-footer">记录 · 组织 · 检索 · 理解</div></section>
  <section class="login-form"><div class="eyebrow">{{authMode==='login'?'WELCOME BACK':'START LEARNING'}}</div><h2>{{authMode==='login'?'进入你的学习空间':'创建你的学习账号'}}</h2><p class="muted">{{authMode==='login'?'登录后浏览资料、整理内容与提问。':'注册后即可上传资料、学习和进行 AI 会话。'}}</p><form @submit.prevent="signIn" novalidate><label for="username">账号</label><el-input id="username" v-model="login.username" size="large" autocomplete="username" placeholder="请输入账号" :aria-invalid="!!authErrors.username"/><p v-if="authErrors.username" class="auth-error" role="alert">{{authErrors.username}}</p><template v-if="authMode==='register'"><label for="display-name">昵称</label><el-input id="display-name" v-model="registration.display_name" maxlength="40" size="large" placeholder="你希望显示的名字"/><p v-if="authErrors.display_name" class="auth-error" role="alert">{{authErrors.display_name}}</p></template><label for="password">密码</label><el-input id="password" v-model="login.password" type="password" show-password size="large" :autocomplete="authMode==='login'?'current-password':'new-password'" :placeholder="authMode==='login'?'请输入密码':'至少8位密码'" :aria-invalid="!!authErrors.password"/><p v-if="authErrors.password" class="auth-error" role="alert">{{authErrors.password}}</p><template v-if="authMode==='register'"><label for="confirm-password">确认密码</label><el-input id="confirm-password" v-model="registration.confirm_password" type="password" show-password size="large" autocomplete="new-password" placeholder="再次输入密码"/><p v-if="authErrors.confirm_password" class="auth-error" role="alert">{{authErrors.confirm_password}}</p><p class="auth-note">自主注册的账号为学生，管理员权限由已有管理员分配。</p></template><p v-if="authErrors.general" class="auth-error" role="alert">{{authErrors.general}}</p><el-button native-type="submit" type="primary" size="large" :loading="loginBusy" class="login-button">{{authMode==='login'?'进入知识库':'注册并登录'}} <el-icon><ArrowRight/></el-icon></el-button></form><div class="auth-switch"><span>{{authMode==='login'?'还没有账号？':'已有账号？'}}</span><button :disabled="loginBusy" @click="toggleAuth">{{authMode==='login'?'注册账号':'返回登录'}}</button></div></section>
 </div>
 <div v-else class="app-shell">
  <aside class="sidebar"><div class="brand"><span class="brand-mark">知</span><span>知序 <small>COURSE KNOWLEDGE HUB</small></span></div><div class="side-label">学习空间</div><nav><button v-for="n in navigation" :key="n.id" :class="{active:page===n.id}" @click="navigate(n.id)"><el-icon><component :is="n.icon"/></el-icon>{{n.label}}<span v-if="n.id==='ask'" class="nav-ai">AI</span></button></nav><div class="side-note"><span class="dot"></span> 课程知识，持续生长<p>把一次次实践<br>积累成可复用的经验。</p></div><div class="profile"><button title="打开个人设置" class="avatar profile-link" @click="navigate('profile')">{{me.display_name.slice(0,1)}}</button><div><strong>{{me.display_name}}</strong><small>{{me.role==='admin'?'管理员':'学习者'}}</small></div><button title="退出登录" class="icon-button" @click="signOut"><el-icon><SwitchButton/></el-icon></button></div></aside>
  <main class="main"><header class="topbar"><span>专业课程设计 II <b>/</b> {{pageTitle}}</span><span class="term">2026 — 2027 · 第一学期</span></header>
   <div class="page"><div class="page-heading"><div><div class="eyebrow">{{page==='ask'?'LEARN WITH EVIDENCE':'YOUR KNOWLEDGE, CONNECTED'}}</div><h1>{{pageTitle}}</h1><p>{{pageNote}}</p></div><div v-if="page==='mine'" class="heading-actions"><el-button size="large" :icon="Upload" @click="uploadNew">上传文件</el-button><el-button type="primary" size="large" :icon="Plus" @click="edit()">创建资料</el-button></div></div>
    <template v-if="page==='home'"><section class="hero"><div><span class="hero-label">从一个问题开始</span><h2>你今天想了解什么？</h2><p>搜索课程文档、实践经验和知识笔记。</p><form class="hero-search" @submit.prevent="page='library';search()"><el-icon><Search/></el-icon><input v-model="filter.q" aria-label="搜索课程知识" placeholder="试试“数据库范式”或“事务”"/><button type="submit">搜索知识 <span>↗</span></button></form><div class="hero-links">探索热门主题 <button v-for="t in tags.slice(0,3).map(t=>t.name)" :key="t" @click="page='library';chooseTag(t)">{{t}} ↗</button></div></div><div class="hero-art" aria-hidden="true"><div class="orbit one"></div><div class="orbit two"></div><span class="art-card card-a">知识<br><b>KNOWLEDGE</b></span><span class="art-card card-b">连接<br><b>CONNECTION</b></span><span class="art-dot"></span></div></section><section class="stats"><div><span>已发布资料</span><strong>{{stats.published}}<small> 篇</small></strong></div><div><span>知识分类</span><strong>{{stats.categories}}<small> 个</small></strong></div><div><span>资料附件</span><strong>{{stats.files}}<small> 份</small></strong></div><div><span>我的内容</span><strong>{{stats.mine}}<small> 篇</small></strong></div></section></template>
    <template v-if="['home','library','mine','manage'].includes(page)">
     <div class="section-heading"><h2>{{page==='home'?'最近更新':page==='library'?'发现课程知识':'内容列表'}} <span>{{total}}</span></h2><button v-if="page==='home'" class="text-button" @click="navigate('library')">全部资料 →</button><el-button v-else :icon="Refresh" text @click="load">刷新</el-button></div>
     <div class="library-layout"><aside v-if="page==='library'" class="category-panel"><div class="panel-label">知识目录</div><button :class="{selected:!filter.category}" @click="filter.category='';search()">全部知识</button><div class="category-group"><button v-for="c in categoryOptions.filter(c=>c.count>0)" :key="c.id" :class="{selected:filter.category===String(c.id)}" @click="chooseCategory(c.id)">{{c.label}} <small>{{c.count}}</small></button></div><div class="panel-label tag-label">知识标签</div><div class="tag-cloud"><button v-for="t in tags" :key="t.name" :class="{selected:filter.tag===t.name}" @click="chooseTag(t.name)">{{t.name}} <small>{{t.count}}</small></button></div></aside>
      <section class="results"><form v-if="page!=='home'" class="filter-bar" @submit.prevent="search"><el-input v-model="filter.q" :prefix-icon="Search" placeholder="搜索标题、正文与附件文本" clearable aria-label="全文搜索"/><el-select v-model="filter.kind" placeholder="全部类型" clearable aria-label="资料类型"><el-option v-for="(label,key) in kinds" :key="key" :label="label" :value="key"/></el-select><el-select v-if="page!=='library'" v-model="filter.status" placeholder="全部状态" clearable aria-label="内容状态"><el-option v-for="(label,key) in statuses" :key="key" :label="label" :value="key"/></el-select><el-button native-type="submit" type="primary">搜索</el-button><el-button text @click="advanced=!advanced">{{advanced?'收起筛选':'高级筛选'}}</el-button></form>
       <div v-if="advanced&&page!=='home'" class="advanced"><el-select v-model="filter.category" placeholder="全部分类" clearable aria-label="分类筛选"><el-option v-for="c in categoryOptions" :key="c.id" :label="c.label" :value="String(c.id)"/></el-select><el-input v-model="filter.tag" placeholder="标签（精确匹配）" aria-label="标签筛选"/><el-input v-model="filter.author" placeholder="作者" aria-label="作者筛选"/><label>更新起日 <input v-model="filter.from" type="date"/></label><label>更新止日 <input v-model="filter.to" type="date"/></label><el-button text @click="clearFilters();load()">清空条件</el-button></div>
       <div v-if="activeFilters.length&&page!=='home'" class="search-summary">当前筛选：{{activeFilters.join(' · ')}} <el-button text @click="clearExtraFilters">清除筛选，仅搜关键词</el-button></div>
       <div v-if="filter.q&&page!=='home'" class="search-summary">“{{filter.q}}” 的全文搜索结果 · {{total}} 篇 <span>多个关键词以空格分隔，需同时匹配</span></div>
       <div v-loading="loading" class="resource-grid"><article v-for="r in items" :key="r.id" class="resource-card" tabindex="0" @click="openResource(r.id)" @keydown.enter="openResource(r.id)"><div class="card-top"><span class="type-icon" :class="r.kind"><el-icon><Reading v-if="r.kind==='article'"/><Document v-else/></el-icon></span><span class="type-name">{{kinds[r.kind]}}</span><span v-if="page==='mine'||page==='manage'" class="status-pill" :class="r.status">{{statuses[r.status]}}</span><span v-else class="card-arrow">↗</span></div><div class="category-crumb">{{r.category_name}}</div><h3>{{r.title}}</h3><p>{{filter.q?r.snippet:r.summary||r.snippet}}</p><div class="card-tags"><span v-for="t in r.tags.slice(0,3)" :key="t">{{t}}</span></div><div class="card-footer"><span>{{r.author}}</span><span>{{date(r.updated_at)}}</span></div></article></div>
       <el-empty v-if="!loading&&!items.length" description="暂无符合条件的资料"><el-button @click="clearFilters();load()">清空筛选</el-button></el-empty><el-pagination v-if="total>12" v-model:current-page="filter.page" :page-size="12" :total="total" layout="prev,pager,next,total" @current-change="load"/>
      </section></div>
    </template>
    <ChatPanel v-if="page==='ask'" :request="api" :user-id="me.id" :model-configured="model.configured" @open-resource="openResource"/>
    <UsersPanel v-if="page==='users'&&me.role==='admin'" :request="api" :current-user-id="me.id"/>
    <section v-if="page==='profile'" class="settings-grid">
     <article class="settings-card"><h2>个人资料</h2><p class="muted">昵称用于作者署名，邮箱和简介仅在自己的设置页显示。</p><el-form label-position="top" :disabled="profileSaving" @submit.prevent="saveProfile"><div class="form-grid"><el-form-item label="登录账号"><el-input :model-value="me.username" readonly aria-label="登录账号"/></el-form-item><el-form-item label="账号角色"><el-input :model-value="me.role==='admin'?'管理员':'学生'" readonly aria-label="账号角色"/></el-form-item></div><el-form-item label="昵称" required><el-input v-model="profileForm.display_name" maxlength="40" placeholder="你希望显示的名字" aria-label="昵称"/></el-form-item><el-form-item label="邮箱（选填）"><el-input v-model="profileForm.email" maxlength="254" placeholder="用于记录联系邮箱" aria-label="邮箱"/></el-form-item><el-form-item label="个人简介（选填）"><el-input v-model="profileForm.bio" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="介绍你的学习方向或兴趣" aria-label="个人简介"/></el-form-item><el-button type="primary" native-type="submit" :loading="profileSaving">保存个人资料</el-button></el-form></article>
     <article class="settings-card"><h2>修改密码</h2><p class="muted">新密码至少 8 位。修改后保留本次登录，其他登录会话会退出。</p><el-form label-position="top" :disabled="passwordSaving" @submit.prevent="changePassword"><el-form-item label="当前密码" required><el-input v-model="passwordForm.current_password" type="password" show-password autocomplete="current-password" aria-label="当前密码"/></el-form-item><el-form-item label="新密码" required><el-input v-model="passwordForm.new_password" type="password" show-password autocomplete="new-password" aria-label="新密码"/></el-form-item><el-form-item label="确认新密码" required><el-input v-model="passwordForm.confirm_password" type="password" show-password autocomplete="new-password" aria-label="确认新密码"/></el-form-item><el-button type="primary" native-type="submit" :loading="passwordSaving" :disabled="!passwordForm.current_password||passwordForm.new_password.length<8||!passwordForm.confirm_password">更新密码</el-button></el-form></article>
    </section>
    <section v-if="page==='categories'" class="category-admin"><div class="category-form"><h2>新增知识分类</h2><p class="muted">按课程主题与知识点建立层次关系。</p><el-input v-model="categoryForm.name" placeholder="分类名称" aria-label="新分类名称"/><el-select v-model="categoryForm.parent_id" placeholder="顶级分类" clearable @clear="categoryForm.parent_id=null"><el-option v-for="c in categoryOptions" :key="c.id" :label="c.label" :value="c.id"/></el-select><el-button type="primary" :disabled="!categoryForm.name.trim()" @click="createCategory">新增分类</el-button></div><div class="category-table"><div v-for="c in categoryOptions" :key="c.id"><span>{{c.label}}</span><el-button text type="danger" :icon="Delete" @click="deleteCategory(categories.find(x=>x.id===c.id)!)">删除</el-button></div></div></section>
    <footer class="page-footer">知序 · 课程知识管理系统 <span>让每一次学习，都留下连接。</span></footer>
   </div>
  </main>
 </div>
 <el-drawer v-model="detailOpen" size="min(860px, 100%)" title="知识详情" destroy-on-close><template v-if="current"><div class="detail-label"><el-tag>{{kinds[current.kind]}}</el-tag><el-tag :type="current.status==='published'?'success':'info'">{{statuses[current.status]}}</el-tag><span>{{current.category_name}}</span></div><h1 class="detail-title">{{current.title}}</h1><div class="detail-meta">{{current.author}} · 更新于 {{date(current.updated_at)}} · 第 {{current.revision}} 版</div><div class="detail-tags"><el-tag v-for="t in current.tags" :key="t" type="info" size="small">{{t}}</el-tag></div><p v-if="current.summary" class="detail-summary">{{current.summary}}</p><div v-if="sourceLinks.length" class="source-links"><a v-for="url in sourceLinks" :key="url" :href="url" target="_blank" rel="noopener noreferrer">查看资料来源 ↗</a></div><div class="prose resource-body">{{current.body||'暂无正文，请查看下方附件。'}}</div><section class="attachments"><h3>资料附件 <span>{{current.attachments.length}}</span></h3><div v-for="f in current.attachments" :key="f.id" class="attachment"><el-icon><Document/></el-icon><div><strong>{{f.filename}}</strong><small>{{size(f.size)}} · {{f.text_length?'文本已纳入检索':'按资料标题与描述检索'}}</small></div><el-button v-if="['application/pdf','image/png','image/jpeg','video/mp4','video/webm'].includes(f.mime)" text @click="preview=f">预览</el-button><a :href="'/api/files/'+f.id+'?download=1'" class="file-download" title="下载附件"><el-icon><Download/></el-icon></a><el-button v-if="canEdit" text type="danger" :icon="Delete" aria-label="移除附件" @click="removeFile(f)"/></div><p v-if="!current.attachments.length" class="muted">还没有附件。</p><label v-if="canEdit" class="upload-control"><el-icon><Upload/></el-icon>{{uploading?'正在上传并解析…':'添加附件'}}<input type="file" accept=".txt,.md,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.mp4,.webm" :disabled="uploading" @change="upload"/></label><small v-if="canEdit" class="file-hint">单文件不超过 30 MB；PDF 扫描件、图片与视频不自动识别文字。</small></section><div v-if="canEdit" class="detail-actions"><el-button :icon="Edit" :disabled="uploading||saving" @click="edit(current)">编辑内容</el-button><el-button v-if="current.status!=='published'" type="primary" :loading="saving" :disabled="uploading" @click="changeStatus('published')">发布资料</el-button><el-button v-if="current.status==='published'" :loading="saving" :disabled="uploading" @click="changeStatus('archived')">归档</el-button><el-button v-if="current.status==='archived'" :loading="saving" :disabled="uploading" @click="changeStatus('draft')">恢复为草稿</el-button><el-button type="danger" text :disabled="uploading||saving" @click="removeResource">删除</el-button></div></template></el-drawer>
 <el-dialog v-model="editOpen" :title="form.id?'编辑知识资料':'创建知识资料'" width="min(800px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving"><el-form label-position="top" :disabled="saving" @submit.prevent="save"><el-form-item label="上传文件（正文可不填）"><div class="new-file-upload"><input ref="fileInput" type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.mp4,.webm" hidden @change="chooseFiles"/><el-button :icon="Upload" @click="fileInput?.click()">选择文件</el-button><p class="muted">支持文档、论文、图片和视频，每个文件不超过 30 MB。文件将直接保存为你的资料。</p><div v-for="(file,i) in pendingFiles" :key="i" class="pending-file"><span>{{file.name}} · {{size(file.size)}}</span><el-button text type="danger" @click="pendingFiles.splice(i,1)">移除</el-button></div></div></el-form-item><el-form-item label="标题" required><el-input v-model="form.title" maxlength="180" placeholder="给资料一个清晰的标题"/></el-form-item><div class="form-grid"><el-form-item label="所属分类" required><el-select v-model="form.category_id"><el-option v-for="c in categoryOptions" :key="c.id" :label="c.label" :value="c.id"/></el-select></el-form-item><el-form-item label="资料类型"><el-select v-model="form.kind"><el-option v-for="(v,k) in kinds" :key="k" :label="v" :value="k"/></el-select></el-form-item></div><el-form-item label="摘要"><el-input v-model="form.summary" type="textarea" :rows="2" maxlength="800" placeholder="简要说明这份资料能帮助读者了解什么"/></el-form-item><el-form-item label="正文"><el-input v-model="form.body" type="textarea" :rows="9" maxlength="100000" placeholder="记录知识内容、实践步骤或视频说明…"/></el-form-item><el-form-item label="标签（输入后按回车，最多 12 个）"><el-select v-model="form.tags" multiple filterable allow-create default-first-option :multiple-limit="12" placeholder="添加标签"><el-option v-for="t in tags" :key="t.name" :label="t.name" :value="t.name"/></el-select></el-form-item><el-form-item label="内容状态"><el-radio-group v-model="form.status"><el-radio-button label="草稿" value="draft"/><el-radio-button label="发布" value="published"/><el-radio-button v-if="form.id" label="归档" value="archived"/></el-radio-group></el-form-item><p class="muted">可只上传文件，无需填写正文。草稿仅自己和管理员可见；发布后纳入知识库和 AI 问答。</p></el-form><template #footer><el-button :disabled="saving" @click="editOpen=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存内容</el-button></template></el-dialog>
 <el-dialog :model-value="!!preview" :title="preview?.filename" width="min(1000px,94vw)" destroy-on-close @close="preview=null"><template v-if="preview"><video v-if="preview.mime.startsWith('video/')" :src="'/api/files/'+preview.id" controls class="media-preview"/><img v-else-if="preview.mime.startsWith('image/')" :src="'/api/files/'+preview.id" class="media-preview" :alt="preview.filename"/><iframe v-else :src="'/api/files/'+preview.id" class="pdf-preview" :title="preview.filename"/></template></el-dialog>
</template>
