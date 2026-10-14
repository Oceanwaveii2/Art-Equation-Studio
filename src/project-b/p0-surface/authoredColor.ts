import {parse,formatHex8} from 'culori'
/** Resolve declared model colors without a DOM probe or computed style. */
export function authoredColor(source:string):string {const value=parse(source);const result=value&&formatHex8(value);if(!result)throw Error('MODEL_COLOR_UNSUPPORTED:'+source);return result}
