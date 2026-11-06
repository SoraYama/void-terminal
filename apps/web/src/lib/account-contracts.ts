/** Public account metadata only. Session credentials stay in HttpOnly cookies. */
export interface AccountUsage {
 requestId:string;
 createdAt:string;
 depth:'standard'|'deep';
 units:number;
 status:'reserved'|'completed'|'released'|'expired';
 usedTokens:number|null;
 model:string;
 allocation?:{
  dailyUnits:number;
  reserveUnits:number;
  dailyPeriod:string|null; // Asia/Shanghai date (YYYY-MM-DD), or null for reserve-only usage.
  dailyPeriodEnded:boolean; // At summary time; does not describe when a release happened.
 };
}
export interface AccountGrant {
 id:string;
 createdAt:string;
 source:'legacy'|'trial'|'manual'|'payment';
 units:number;
}
export type AccountRisk =
 | {status:'verified'|'unavailable'}
 | {status:'verification_required';siteKey:string;challengeAction:'account_device'};
export interface AccountSummary {
 enabled:boolean;
 authenticated:boolean;
 user?:{id:string;email:string};
 credits?:{
  available:number;held:number;totalGranted:number;
  daily?:{available:number;held:number;limit:number;resetsAt:string};
  reserve?:{available:number;held:number};
 };
 risk?:AccountRisk;
 eligibility?:{status:'ready'|'verification_required'|'device_limit';reason?:string};
 trialCredits?:number;
 costs?:{standard:number;deep:number};
 usage?:AccountUsage[];
 grants?:AccountGrant[];
}
export type AccountIdentity=string|null|undefined; // undefined: unverified, null: signed out (guest history only in self-hosted)
export interface AccountFailure {code:string;message:string;retryAfter?:number}
export function accountErrorText(error:AccountFailure,zh:boolean):string {
 const messages:Record<string,[string,string]>={
  INVALID_EMAIL:['请输入有效的邮箱地址。','Enter a valid email address.'],
  INVALID_OTP:['验证码无效或已过期，请重新输入或发送新验证码。','The code is invalid or expired. Try again or send a new code.'],
  DEVICE_VERIFICATION_REQUIRED:['请先完成设备验证。','Verify this device before continuing.'],
  DEVICE_CHALLENGE_FAILED:['设备验证未通过，请完成新的验证。','The device challenge failed. Solve a fresh challenge and try again.'],
  ACCOUNT_RISK_UNAVAILABLE:['设备验证暂不可用，请稍后再试。','Device verification is temporarily unavailable. Please retry.'],
  ACCOUNT_RISK_LIMIT:['请求过于频繁，请稍后再试。','Too many requests. Please wait and try again.'],
  AUTH_RATE_LIMIT:['验证码请求过于频繁，请稍后再试。','Too many code requests. Please wait and try again.'],
  AUTH_DISABLED:['账户服务暂未开放，请稍后重试。','Accounts are not available yet. Please retry later.'],
  AUTH_UNAVAILABLE:['暂时无法连接登录服务，请稍后重试。','Sign-in is temporarily unavailable. Please retry.'],
  ACCOUNT_UNAVAILABLE:['暂时无法读取账户额度，请刷新重试。','Your balance is temporarily unavailable. Refresh to retry.'],
  LOGIN_REQUIRED:['登录已过期，请重新验证邮箱。','Your session has expired. Verify your email again.'],
  INVALID_ORIGIN:['请求未被接受，请刷新页面后重试。','The request was not accepted. Reload the page and retry.'],
  MODE_NOT_ALLOWED:['站点服务模式已变更，请刷新页面后重试。','The site service mode has changed. Reload the page and retry.'],
  DEPLOYMENT_CONFIG:['站点服务配置暂不可用，请稍后重试。','The site service configuration is unavailable. Please retry later.'],
 };
 return (messages[error.code]||['操作未完成，请检查网络后重试。','Could not complete the request. Check your connection and retry.'])[zh?0:1];
}
