<script setup lang="ts">
import {onMounted,reactive,ref} from 'vue';
import {ElMessage,ElMessageBox} from 'element-plus';
import {Plus,Refresh} from '@element-plus/icons-vue';
type Account={id:number;username:string;display_name:string;role:'admin'|'student';disabled:number;created_at:string;resource_count:number};
const props=defineProps<{request:(path:string,options?:RequestInit)=>Promise<any>;currentUserId:number}>();
const users=ref<Account[]>([]),loading=ref(false),saving=ref(false),createOpen=ref(false);
const form=reactive({username:'',display_name:'',password:'',role:'student'});
const resetOpen=ref(false),resetTarget=ref<Account|null>(null),newPassword=ref('');
function error(e:unknown){ElMessage.error(e instanceof Error?e.message:'操作失败，请重试');}
async function load(){loading.value=true;try{users.value=(await props.request('/users')).items;}catch(e){error(e);}finally{loading.value=false;}}
function openCreate(){Object.assign(form,{username:'',display_name:'',password:'',role:'student'});createOpen.value=true;}
async function create(){saving.value=true;try{await props.request('/users',{method:'POST',body:JSON.stringify(form)});createOpen.value=false;form.password='';await load();ElMessage.success('用户已添加');}catch(e){error(e);}finally{saving.value=false;}}
async function update(u:Account,change:{role?:string;disabled?:boolean}){
 const role=change.role??u.role,disabled=change.disabled??!!u.disabled;
 try{await ElMessageBox.confirm('此操作会更新账号权限；角色变更或停用后，该用户需要重新登录。','确认修改用户',{confirmButtonText:'确定',cancelButtonText:'取消',type:'warning'});}catch{return;}
 try{await props.request('/users/'+u.id,{method:'PATCH',body:JSON.stringify({role,disabled})});await load();ElMessage.success('用户状态已更新');}catch(e){error(e);}
}
async function resetPassword(){if(!resetTarget.value)return;saving.value=true;try{await props.request('/users/'+resetTarget.value.id+'/password',{method:'POST',body:JSON.stringify({password:newPassword.value})});resetOpen.value=false;newPassword.value='';ElMessage.success('密码已重置，该用户的旧登录会话已退出');}catch(e){error(e);}finally{saving.value=false;}}
async function remove(u:Account){
 const note=u.resource_count?`该用户的 ${u.resource_count} 份资料将移交给你，附件和发布状态保留。`:'该用户没有资料。';
 try{await ElMessageBox.confirm(note+'账号及其个人会话将永久删除，无法恢复。','删除用户 '+u.username,{confirmButtonText:u.resource_count?'移交资料并删除':'删除用户',cancelButtonText:'取消',type:'warning'});}catch{return;}
 try{await props.request('/users/'+u.id,{method:'DELETE',body:JSON.stringify({transfer_to:props.currentUserId})});await load();ElMessage.success('用户已删除');}catch(e){error(e);}
}
onMounted(load);
</script>
<template>
 <section class="user-management"><div class="section-heading"><h2>用户列表 <span>{{users.length}}</span></h2><div><el-button :icon="Refresh" @click="load">刷新</el-button><el-button type="primary" :icon="Plus" @click="openCreate">添加用户</el-button></div></div><div class="users-table-wrap"><el-table v-loading="loading" :data="users" class="users-table"><el-table-column prop="username" label="账号" min-width="110"/><el-table-column prop="display_name" label="昵称" min-width="120"/><el-table-column label="角色" width="100"><template #default="{row}"><el-tag :type="row.role==='admin'?'warning':'info'">{{row.role==='admin'?'管理员':'学生'}}</el-tag></template></el-table-column><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.disabled?'danger':'success'">{{row.disabled?'已停用':'正常'}}</el-tag></template></el-table-column><el-table-column prop="resource_count" label="资料数" width="80"/><el-table-column label="操作" min-width="340"><template #default="{row}"><span v-if="row.id===currentUserId" class="muted">当前账号，请到个人设置修改资料和密码</span><template v-else><el-button text @click="update(row,{role:row.role==='admin'?'student':'admin'})">{{row.role==='admin'?'设为学生':'设为管理员'}}</el-button><el-button text @click="update(row,{disabled:!row.disabled})">{{row.disabled?'启用':'停用'}}</el-button><el-button text @click="resetTarget=row;newPassword='';resetOpen=true">重置密码</el-button><el-button text type="danger" @click="remove(row)">删除</el-button></template></template></el-table-column></el-table></div><p class="muted">新用户可在登录页自行注册学生账号。删除有资料的用户时，资料移交给当前管理员。</p></section>
 <el-dialog v-model="createOpen" title="添加用户" width="min(480px,94vw)" :close-on-click-modal="false"><el-form label-position="top" :disabled="saving" @submit.prevent="create"><el-form-item label="账号" required><el-input v-model="form.username" placeholder="3至30位字母、数字、下划线或短横线" aria-label="新用户账号"/></el-form-item><el-form-item label="昵称" required><el-input v-model="form.display_name" maxlength="40" aria-label="新用户昵称"/></el-form-item><el-form-item label="初始密码" required><el-input v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="至少8位" aria-label="新用户密码"/></el-form-item><el-form-item label="角色"><el-radio-group v-model="form.role"><el-radio value="student">学生</el-radio><el-radio value="admin">管理员</el-radio></el-radio-group></el-form-item></el-form><template #footer><el-button :disabled="saving" @click="createOpen=false">取消</el-button><el-button type="primary" :loading="saving" @click="create">添加</el-button></template></el-dialog>
 <el-dialog v-model="resetOpen" :title="'重置密码：'+(resetTarget?.username??'')" width="min(440px,94vw)" :close-on-click-modal="false"><el-input v-model="newPassword" type="password" show-password autocomplete="new-password" placeholder="设置至少8位的新密码" aria-label="重置后的密码"/><template #footer><el-button @click="resetOpen=false">取消</el-button><el-button type="primary" :loading="saving" @click="resetPassword">确认重置</el-button></template></el-dialog>
</template>
