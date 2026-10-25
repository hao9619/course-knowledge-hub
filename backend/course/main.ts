import { fileURLToPath } from 'node:url';
import { buildCourseApp } from './app.js';
const dir=fileURLToPath(new URL('../runtime/course/',import.meta.url));
const app=await buildCourseApp({dir,codex:process.env.COURSE_MODEL_PROVIDER==='codex',webDir:fileURLToPath(new URL('../../frontend/dist/',import.meta.url)),model:{url:process.env.COURSE_MODEL_URL||'',key:process.env.COURSE_MODEL_KEY||'',name:process.env.COURSE_MODEL_NAME||''}});
const port=Number(process.env.COURSE_PORT||8210);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid COURSE_PORT');
await app.listen({host:'127.0.0.1',port});
console.log(`Course Knowledge Hub: http://127.0.0.1:${port}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
