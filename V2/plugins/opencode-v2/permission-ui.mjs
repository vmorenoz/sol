import { permissionBridgeDefinition } from './permission-bridge.mjs';

/** Present server-owned requests in OpenCode's native permission UI.
 * This transport cannot approve: only the server's exact native events do so.
 */
export function createPermissionPresenter(ctx) {
  if(typeof ctx.client?.rpc!=='function'||!ctx.client?.permission?.create||!ctx.data?.on)return {dispose(){}};
  const rpc=ctx.client.rpc(permissionBridgeDefinition);
  const active=new Map();
  let disposed=false;
  const key=input=>JSON.stringify([input.sessionID,input.requestID,input.nonce]);
  const rejectNative=async entry=>{
    if(!entry.created||entry.nativeRejected||!ctx.client.permission.reply)return;
    entry.nativeRejected=true;
    try{await ctx.client.permission.reply({sessionID:entry.input.sessionID,requestID:entry.input.requestID,decision:'reject'});}catch{/* Already answered or disconnected: never retry an uncertain reply. */}
  };
  const cancel=async(entry,reason)=>{
    if(!entry.cancelled){
      entry.cancelled=true;
      try{await rpc.cancel({...entry.input,reason},{location:entry.location});}catch{/* No client-side success fallback; absence of native approval remains blocked. */}
    }
    await rejectNative(entry);
  };
  const present=async event=>{
    if(disposed)return;
    const input=event.data;
    if(!input||typeof input.sessionID!=='string'||typeof input.requestID!=='string'||typeof input.nonce!=='string')return;
    const identity=key(input);
    if(active.has(identity))return;
    const entry={input:{sessionID:input.sessionID,requestID:input.requestID,nonce:input.nonce},location:event.location,cancelled:false};
    active.set(identity,entry);
    try{
      // describe is a server-side single claim; null means another TUI owns it.
      const descriptor=await rpc.describe(entry.input,{location:entry.location});
      if(!descriptor){active.delete(identity);return;}
      if(disposed||entry.cancelled){await cancel(entry,'La interfaz se cerró antes de presentar el permiso.');return;}
      if(descriptor.id!==input.requestID||descriptor.sessionID!==input.sessionID||descriptor.metadata?.solPermission?.nonce!==input.nonce)throw new Error('Descriptor de permiso no coincide.');
      // Preserve the complete immutable descriptor, including source and hash.
      const result=await ctx.client.permission.create(descriptor);
      if(result.effect!=='ask'||result.id!==descriptor.id)throw new Error('No se confirmó la solicitud nativa exacta.');
      entry.created=true;
      if(disposed||entry.cancelled)await cancel(entry,'La interfaz se cerró durante la solicitud.');
    }catch(error){await cancel(entry,error?.message||'No se pudo presentar el permiso nativo.');active.delete(identity);}
  };
  const offRequest=rpc.events.on('requested',present);
  const offReply=ctx.data.on('permission.replied',event=>{
    for(const [identity,entry] of active)if(entry.input.sessionID===event.data?.sessionID&&entry.input.requestID===event.data?.requestID)active.delete(identity);
  });
  const clear=()=>{for(const entry of active.values())void cancel(entry,'La interfaz de permisos se cerró o recargó.');active.clear();};
  const offShutdown=ctx.data.on('location.shutdown',clear);
  return {dispose(){if(disposed)return;disposed=true;offRequest();offReply();offShutdown();clear();}};
}
