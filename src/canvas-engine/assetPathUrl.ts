/** Append before decoding a native file URL. Windows extended-length paths
 * (\\\\?\\C:\\...) cannot mix a raw URL slash with their encoded backslashes. */
export function appendAssetPathUrl(base:string,relative:string):string {
 if(!relative||relative.length>256||relative.split('/').some(part=>!part||part==='.'||part==='..'||!/^[a-zA-Z0-9_.-]+$/.test(part)))throw Error('ASSET_RELATIVE_PATH_INVALID')
 const url=new URL(base)
 if(!['http:','https:','asset:','file:'].includes(url.protocol))throw Error('ASSET_URL_PROTOCOL_INVALID')
 const windows=/%5c/i.test(url.pathname),suffix=windows?encodeURIComponent(relative.replaceAll('/','\\')):relative.split('/').map(encodeURIComponent).join('/')
 url.pathname=url.pathname.replace(/(?:\/|%5c)$/i,'')+(windows?'%5C':'/')+suffix
 return url.href
}
