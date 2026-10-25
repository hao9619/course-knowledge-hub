import {z} from 'zod';
export function fail(status:number,message:string):never {throw Object.assign(new Error(message),{statusCode:status,publicMessage:true});}
/** Only explicitly authored Chinese validation messages reach the interface. */
export function parse<T>(schema:z.ZodType<T>,value:unknown):T {
 const result=schema.safeParse(value);
 if(!result.success){const issue=result.error.issues[0];fail(400,issue&&/^[\u3400-\u9fff]/.test(issue.message)?issue.message:'填写内容的格式或长度不正确，请检查后重试');}
 return result.data;
}
export const usernameSchema=z.string().trim().toLowerCase().min(3,'账号至少3位').max(30,'账号最多30位').regex(/^[a-z0-9_-]+$/,'账号只能包含英文字母、数字、下划线和短横线');
export const newPasswordSchema=z.string().min(8,'密码至少8位').max(200,'密码最多200位');
export const displayNameSchema=z.string().trim().min(1,'请填写昵称').max(40,'昵称最多40字');
