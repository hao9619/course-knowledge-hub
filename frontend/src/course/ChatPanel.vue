<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref} from 'vue';
import {ElMessage,ElMessageBox} from 'element-plus';
import {Plus,Edit,Delete,ChatDotRound,ArrowRight} from '@element-plus/icons-vue';
import AnswerText from './AnswerText.vue';
type Citation={number:number;resource_id:number;title:string;text:string};
type Message={id:number;role:'user'|'assistant';content:string;mode:string;citations:Citation[];created_at:string};
type Conversation={id:number;title:string;generating:number;updated_at:string;messages?:Message[]};
const props=defineProps<{request:(path:string,options?:RequestInit)=>Promise<any>;userId:number;modelConfigured:boolean}>();
const emit=defineEmits<{openResource:[id:number]}>();
const conversations=ref<Conversation[]>([]),current=ref<Conversation|null>(null),messages=ref<Message[]>([]),question=ref(''),loading=ref(true),creating=ref(false),sending=ref(false);
const messageList=ref<HTMLElement|null>(null);let timer:ReturnType<typeof setInterval>|undefined;let fetching=false;let disposed=false;
const busy=computed(()=>sending.value||!!current.value?.generating);
const remember=(id:number)=>sessionStorage.setItem('course-chat:'+props.userId,String(id));
function error(e:unknown){ElMessage.error(e instanceof Error?e.message:'操作未完成，请重试');}
async function list(){conversations.value=(await props.request('/conversations')).items;}
async function scroll(){await nextTick();messageList.value?.scrollTo({top:messageList.value.scrollHeight,behavior:'smooth'});}
async function select(id:number){
 loading.value=true;current.value=conversations.value.find(c=>c.id===id)??{id,title:'会话',generating:0,updated_at:''};messages.value=[];question.value='';remember(id);
 try{const c=await props.request('/conversations/'+id);if(current.value?.id===id){current.value=c;messages.value=c.messages;void scroll();}}catch(e){error(e);}finally{loading.value=false;}
}
async function create(){if(creating.value)return;creating.value=true;question.value='';try{const c=await props.request('/conversations',{method:'POST'});await list();current.value=c;messages.value=[];remember(c.id);}catch(e){error(e);}finally{creating.value=false;}}
async function rename(c:Conversation){
 try{const {value}=await ElMessageBox.prompt('输入新的会话名称','重命名会话',{inputValue:c.title,inputValidator:value=>!!value?.trim()&&value.trim().length<=60||'请输入1至60字的名称',confirmButtonText:'保存',cancelButtonText:'取消'});await props.request('/conversations/'+c.id,{method:'PATCH',body:JSON.stringify({title:value})});await list();if(current.value?.id===c.id)current.value.title=value;}catch(e){if(e!=='cancel'&&e!=='close')error(e);}
}
async function remove(c:Conversation){
 try{await ElMessageBox.confirm('删除后无法恢复这段会话及其消息，知识库资料不会删除。','删除会话',{confirmButtonText:'删除',cancelButtonText:'取消',type:'warning'});}catch{return;}
 try{await props.request('/conversations/'+c.id,{method:'DELETE'});await list();if(current.value?.id===c.id){current.value=null;messages.value=[];sessionStorage.removeItem('course-chat:'+props.userId);if(conversations.value[0])await select(conversations.value[0].id);}}catch(e){error(e);}
}
async function refreshCurrent(){
 const id=current.value?.id;if(!id||fetching||disposed)return;fetching=true;
 try{const c=await props.request('/conversations/'+id);if(current.value?.id===id&&!disposed){const changed=messages.value.length!==c.messages.length||current.value.generating!==c.generating;current.value=c;messages.value=c.messages;if(changed)void scroll();if(!c.generating)await list();}}
 catch(e){if(!disposed)error(e);}finally{fetching=false;}
}
async function send(suggestion?:string){
 if(suggestion)question.value=suggestion;const text=question.value.trim();if(text.length<2){ElMessage.warning('请至少输入两个字');return;}if(busy.value)return;
 if(!current.value){await create();question.value=text;}const id=current.value?.id;if(!id)return;
 sending.value=true;question.value='';current.value!.generating=1;
 messages.value.push({id:-Date.now(),role:'user',content:text,mode:'message',citations:[],created_at:new Date().toISOString()});void scroll();
 try{const c=await props.request('/conversations/'+id+'/messages',{method:'POST',body:JSON.stringify({question:text})});if(current.value?.id===id&&!disposed){current.value=c;messages.value=c.messages;void scroll();}if(!disposed)await list();}
 catch(e){if(!disposed){error(e);if(current.value?.id===id)await refreshCurrent();}}
 finally{sending.value=false;}
}
function keydown(e:KeyboardEvent){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}}
onMounted(async()=>{
 try{await list();const saved=Number(sessionStorage.getItem('course-chat:'+props.userId));const chosen=conversations.value.find(c=>c.id===saved)??conversations.value[0];if(chosen)await select(chosen.id);}catch(e){error(e);}finally{loading.value=false;}
 timer=setInterval(()=>{if(current.value?.generating)void refreshCurrent();},2500);
});
onUnmounted(()=>{disposed=true;if(timer)clearInterval(timer);});
</script>
<template>
 <section class="chat-shell">
  <aside class="conversation-sidebar"><el-button type="primary" :icon="Plus" :loading="creating" :disabled="loading" @click="create">新建会话</el-button><div class="conversation-list"><p v-if="!conversations.length" class="muted">还没有会话，发出第一个问题开始吧。</p><div v-for="c in conversations" :key="c.id" class="conversation-row" :class="{selected:current?.id===c.id}"><button class="conversation-select" @click="select(c.id)"><el-icon><ChatDotRound/></el-icon><span>{{c.title}}</span><small v-if="c.generating">回答中</small></button><div class="conversation-actions"><el-button text :icon="Edit" :aria-label="'重命名会话：'+c.title" @click="rename(c)"/><el-button text :icon="Delete" :aria-label="'删除会话：'+c.title" @click="remove(c)"/></div></div></div><p class="muted">会话仅自己可见，刷新后可继续。</p></aside>
  <div class="chat-main"><header class="chat-heading"><strong>{{current?.title||'新的学习对话'}}</strong><span class="muted">{{modelConfigured?'基于课程知识库回答':'模型未配置，仅展示检索资料'}}</span></header>
   <div ref="messageList" v-loading="loading" class="chat-messages">
    <div v-if="!messages.length&&!loading" class="qa-intro"><span class="qa-logo"><el-icon><ChatDotRound/></el-icon></span><h2>从一个问题，继续探索。</h2><p>可以追问，也可以新建会话讨论另一个主题。</p><div class="suggestions"><button v-for="q in ['这个平台能学啥？','我是初学者，应该先看哪些资料？','数据库范式有什么作用？']" :key="q" :disabled="busy" @click="send(q)">{{q}} ↗</button></div></div>
    <article v-for="m in messages" :key="m.id" class="chat-message" :class="m.role"><div class="message-role">{{m.role==='user'?'你':'知序助手'}}<span v-if="m.role==='assistant'&&m.mode==='retrieval_only'"> · 仅检索依据</span><span v-if="m.mode==='error'"> · 未完成</span><span v-if="m.mode==='stale'"> · 依据已变更</span></div><p v-if="m.role==='user'" class="user-text">{{m.content}}</p><div v-else-if="m.mode==='pending'" class="thinking">正在理解上下文、阅读知识资料并生成回答…</div><div v-else class="answer"><AnswerText :text="m.content" @cite="n=>{const c=m.citations.find(x=>x.number===n);if(c)emit('openResource',c.resource_id)}"/><details v-if="m.citations.length" class="message-sources"><summary>查看引用来源（{{m.citations.length}}）</summary><button v-for="c in m.citations" :key="c.number" class="source-card" @click="emit('openResource',c.resource_id)"><span>[{{c.number}}] {{c.title}} ↗</span><p>{{c.text}}</p></button></details></div></article>
    <div v-if="busy&&!messages.some(m=>m.mode==='pending')" class="thinking">正在生成回答…</div>
   </div>
   <form class="chat-composer" @submit.prevent="send()"><el-input v-model="question" type="textarea" :rows="3" maxlength="1000" show-word-limit aria-label="课程问题" :disabled="creating||loading" placeholder="输入问题或继续追问，Enter 发送，Shift + Enter 换行" @keydown="keydown"/><div><span class="muted">回答使用已发布资料；可以点击引用查看原文。</span><el-button native-type="submit" type="primary" :loading="busy" :disabled="question.trim().length<2||loading||creating">发送 <el-icon><ArrowRight/></el-icon></el-button></div></form>
  </div>
 </section>
</template>
