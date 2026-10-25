import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
export const codexModel=()=>process.env.COURSE_CODEX_MODEL||'gpt-5.6-luna';
export const codexEffort=()=>process.env.COURSE_CODEX_REASONING||'low';
/** CLI adapter: fixed argv, stdin-only questions, read-only sandbox, no inherited plugins/tools. */
export async function generateWithCodex(workDir:string,prompt:string):Promise<string> {
  mkdirSync(workDir,{recursive:true});
  const requestDir=mkdtempSync(join(workDir,'request-'));
  const output=join(requestDir,'answer.txt');
  const args=['exec','--model',codexModel(),'-c','model_reasoning_effort='+JSON.stringify(codexEffort()),'--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','-c','approval_policy="never"','-c','project_doc_max_bytes=0','-c','web_search="disabled"'];
  for(const feature of ['shell_tool','unified_exec','apps','plugins','hooks','memories','browser_use','computer_use','view_image','multi_agent','multi_agent_v2','shell_snapshot'])args.push('--disable',feature);
  args.push('-C',requestDir,'--output-last-message',output,'-');
  try {
    return await new Promise((resolve,reject)=>{
      const child=spawn('codex',args,{cwd:requestDir,stdio:['pipe','ignore','ignore'],detached:true});
      const timer=setTimeout(()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}reject(new Error('Codex response timeout'));},90000);
      child.on('error',e=>{clearTimeout(timer);reject(e);});
      child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(new Error('Codex call failed'));return;}try{const text=readFileSync(output,'utf-8').trim();if(!text)throw new Error('Empty model output');resolve(text);}catch(e){reject(e);}});
      child.stdin.on('error',()=>{});
      child.stdin.end(prompt);
    });
  } finally {rmSync(requestDir,{recursive:true,force:true});}
}
