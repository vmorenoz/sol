/** Minimal deterministic host harness for the real server permission bridge. */
export function createNativePermissionHost(){
  const evaluations=[];let handlers;
  const queue=[];let wake;
  const emit=event=>{queue.push(event);wake?.();};
  const event={subscribe:({signal})=>({async *[Symbol.asyncIterator](){
    while(!signal.aborted){
      if(!queue.length)await new Promise(resolve=>{wake=resolve;signal.addEventListener('abort',resolve,{once:true});});
      while(queue.length)yield queue.shift();
    }
  }})};
  const permission={hook:async(_name,callback)=>{evaluations.push(callback);return ()=>{const index=evaluations.indexOf(callback);if(index>=0)evaluations.splice(index,1);};}};
  const rpc={register:async(_definition,value)=>{handlers=value;return {
    ...handlers,
    events:{emit:async(name,ref)=>{
      assertRequestedEventName(name);
      const descriptor=await handlers.describe(ref);if(!descriptor)return;
      const evaluated={sessionID:descriptor.sessionID,action:descriptor.action,resources:descriptor.resources,metadata:descriptor.metadata,source:descriptor.source,effect:'ask'};
      for(const evaluate of evaluations)await evaluate(evaluated);
      if(evaluated.effect==='deny')throw new Error('Host permission policy denied fixture request');
      emit({type:'permission.asked',data:{...descriptor,effect:evaluated.effect,save:[]}});
      emit({type:'permission.replied',data:{sessionID:descriptor.sessionID,requestID:descriptor.id,reply:'once'}});
    }},
  };}};
  return {event,permission,rpc};
}
function assertRequestedEventName(name){if(name!=='requested')throw new Error(`Unexpected bridge event: ${name}`);}
