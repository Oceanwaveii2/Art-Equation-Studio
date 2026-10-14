export type SavePolicy={mode:'continuous'|'interval';intervalMinutes:number}
export const defaultSavePolicy:SavePolicy={mode:'continuous',intervalMinutes:10}
export function validSavePolicy(value:unknown):SavePolicy{const v=value as Partial<SavePolicy>|null;return {mode:v?.mode==='interval'?'interval':'continuous',intervalMinutes:typeof v?.intervalMinutes==='number'&&Number.isInteger(v.intervalMinutes)&&v.intervalMinutes>=1&&v.intervalMinutes<=1440?v.intervalMinutes:10}}

