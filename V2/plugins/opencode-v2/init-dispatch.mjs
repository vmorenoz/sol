import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const check = signal => { if (signal?.aborted) throw new Error('Init cancelado; no se reactivó Sol.'); };
const abortable = (promise, signal) => {
  check(signal);
  if (!signal) return promise;
  return new Promise((resolve,reject) => {
    const stop=()=>reject(new Error('Init cancelado.'));
    signal.addEventListener('abort',stop,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
  });
};

/** Real native permission evaluation; an absent request is never approval. */
export async function requestInitPermission(ctx, input, signal) {
  if (!ctx.client?.permission?.create || !ctx.data?.on) throw new Error('OpenCode no expone evaluación nativa de permisos y respuestas; init detenido.');
  const replies=new Map(); let settle,rejectWait,expectedID,pendingID,unavailable=false;
  const answered=new Promise((resolve,reject)=>{settle=resolve;rejectWait=reject;});
  // Attach a handler immediately: a reload may arrive while create is in flight.
  answered.catch(()=>{});
  const off=ctx.data.on('permission.replied',event=>{
    const data=event.data;
    if(data?.sessionID===input.sessionID){replies.set(data.requestID,data.reply);if(data.requestID===expectedID)settle(data);}
  });
  const offShutdown=ctx.data.on('location.shutdown',()=>{unavailable=true;rejectWait(new Error('OpenCode recargó la ubicación; aprobación no confirmada. Reintenta explícitamente.'));});
  try {
    check(signal);
    const result=await ctx.client.permission.create({...input,save:[]},{signal});
    // Capture only this create response before checking cancellation: it may have
    // reached the host just as the local operation was aborted.
    if(result.effect==='ask'&&result.id)pendingID=result.id;
    check(signal);
    if(unavailable)throw new Error('OpenCode recargó la ubicación durante la aprobación; init detenido.');
    if(result.effect==='allow')return;
    if(result.effect==='deny')throw new Error(`Permiso denegado: ${input.action} (${input.resources.join(', ')}).`);
    if(result.effect!=='ask'||!result.id)throw new Error('Respuesta de permiso desconocida; init detenido.');
    expectedID=result.id;
    // Other requests can settle first: wait for this exact identifier only.
    while(!replies.has(result.id)) {
      await abortable(answered,signal);
      if(!replies.has(result.id))throw new Error('Llegó una respuesta de permiso ajena; vuelve a intentar init para confirmar la solicitud exacta.');
    }
    if(!['once','always'].includes(replies.get(result.id)))throw new Error(`Permiso rechazado: ${input.action}.`);
  } finally {
    off();offShutdown();
    if(pendingID&&!replies.has(pendingID)&&ctx.client.permission.reply){
      try{await ctx.client.permission.reply({sessionID:input.sessionID,requestID:pendingID,decision:'reject'});}catch{/* Already answered or disconnected; never retry an uncertain reply. */}
    }
  }
}

/** Prove the TUI and its existing server see the same session filesystem. */
export async function verifyInitLocal(ctx,session,signal) {
  const root=session.location?.directory;
  if(!path.isAbsolute(root||'')||!fs.statSync(root).isDirectory()||!ctx.client?.file?.read)throw new Error('Init requiere un workspace local verificable y file.read nativo.');
  const relative=`.sol-local-check-${crypto.randomUUID()}.tmp`,file=path.join(root,relative),token=crypto.randomBytes(32).toString('hex');
  await requestInitPermission(ctx,{sessionID:session.id,agent:session.agent,action:'edit',resources:[relative],metadata:{purpose:'Crear y retirar comprobación temporal de acceso local de Sol'}},signal);
  await requestInitPermission(ctx,{sessionID:session.id,agent:session.agent,action:'read',resources:[relative]},signal);
  check(signal);
  try {
    fs.writeFileSync(file,token,{flag:'wx',mode:0o600});
    const bytes=await ctx.client.file.read({location:{directory:root},path:relative},{signal});
    if(Buffer.from(bytes).toString()!==token)throw new Error('El servidor no comparte este workspace local; init no preparó .sol.');
  } finally {if(fs.existsSync(file))fs.unlinkSync(file);}
  return root;
}

/** Runs only in the native CLI, through the existing host client. */
export function createInitDispatcher({ctx,core,tracking,verifyLocal=verifyInitLocal}) {
  const running=new Map();
  async function execute(sessionID,scope,signal) {
    if(typeof scope!=='string'||scope.length>4000)throw new Error('El alcance de init debe ser texto de hasta 4000 caracteres.');
    for(const name of ['get','create','prompt','wait','synthetic','context','interrupt'])if(typeof ctx.client?.session?.[name]!=='function')throw new Error(`OpenCode no expone session.${name}; init detenido.`);
    if(!ctx.client?.session?.inbox?.list||!ctx.client?.agent?.get)throw new Error('OpenCode no expone catálogo de agentes e inbox nativos; init detenido.');
    const parent=await ctx.client.session.get({sessionID});
    if(parent.agent!=='sol')throw new Error('Selecciona el agente Sol antes de /sol-init; no se cambió el agente activo.');
    const root=await verifyLocal(ctx,parent,signal);
    let current=tracking.readArtifactTracking(root);
    if(!current.available)throw new Error(current.blockers.join('; '));
    if(!['local','versioned'].includes(current.mode)) {
      const mode=await ctx.ui.dialog.select({title:'Artefactos Sol',options:[{title:'Local',value:'local',description:'Excluir .sol solo en este clon'},{title:'Versionado',value:'versioned',description:'Dejar .sol disponible para Git; no crea commits'}]});
      if(!mode)throw new Error('Init cancelado antes de preparar .sol.');
      const plan=tracking.planArtifactTracking(root,{mode,expectedRevision:current.revision});
      if(!await ctx.ui.dialog.confirm({title:'Guardar elección de artefactos',message:`${plan.changes.join('\n')}\nArchivo: ${plan.excludePath}\nSe conserva copia privada de recuperación; no se modifica el índice Git.`}))throw new Error('Elección cancelada.');
      await requestInitPermission(ctx,{sessionID,agent:parent.agent,action:'sol_artifacts_set',resources:[mode],metadata:{workspace:root,excludePath:plan.excludePath}},signal);
      check(signal);tracking.applyArtifactTracking(plan);
    }
    await requestInitPermission(ctx,{sessionID,agent:parent.agent,action:'sol_workspace_prepare',resources:['*'],metadata:{workspace:root}},signal);
    check(signal);
    let run=core.bootstrapInit(root,{scope});
    if(run.completed||run.continuation?.status==='sent')return {status:'already-complete',workId:run.workId};
    const agentResult=await ctx.client.agent.get({agentID:'sol-explorer',location:{directory:root}});
    const agent=agentResult.data;
    if(!agent||agent.mode==='primary')throw new Error('sol-explorer nativo no disponible; no se lanzaron hijos.');
    const children=new Set();
    const stop=()=>{for(const childID of children)void ctx.client.session.interrupt({sessionID:childID,resume:false}).catch(()=>{});};
    signal.addEventListener('abort',stop,{once:true});
    try {
      const outcomes=await Promise.allSettled(run.assignments.map(async assignment=>{
        const saved=run.results.find(r=>r.taskId===assignment.taskId);
        if(saved.status!=='pending')return;
        check(signal);
        await requestInitPermission(ctx,{sessionID,agent:parent.agent,action:'subagent',resources:[assignment.agent]},signal);
        const childID=assignment.sessionId||id('ses'),promptID=assignment.promptMessageId||id('msg');
        core.registerInitChild(root,{workId:run.workId,taskId:assignment.taskId,sessionId:childID,promptMessageId:promptID});
        const child=await ctx.client.session.create({id:childID,parentID:sessionID,title:assignment.description,agent:assignment.agent,model:agent.model??parent.model,metadata:{...parent.metadata,solInit:{workId:run.workId,taskId:assignment.taskId,output:assignment.output}}},{signal});
        if(child.id!==childID||child.parentID!==sessionID||child.agent!==assignment.agent||child.location?.directory!==root)throw new Error('La identidad de la sesión hija no coincide; init detenido.');
        children.add(child.id);
        await requestInitPermission(ctx,{sessionID:child.id,agent:assignment.agent,action:'edit',resources:[assignment.output]},signal);
        check(signal);
        // A stable prompt ID is admitted once by the native inbox. Reconcile first
        // so an already delivered prompt is not used to wake a finished child.
        const history=await ctx.client.session.context({sessionID:child.id});
        const pending=await ctx.client.session.inbox.list({sessionID:child.id});
        if(!history.some(m=>m.id===promptID)&&!pending.some(m=>m.id===promptID))await ctx.client.session.prompt({sessionID:child.id,id:promptID,text:assignment.prompt,delivery:'queue'},{signal});
        await ctx.client.session.wait({sessionID:child.id},{signal});
        check(signal);
        const terminal=await ctx.client.session.get({sessionID:child.id});
        if(!terminal.outcome||!terminal.time?.idle)throw new Error(`${assignment.taskId}: no hay resultado terminal confirmado; conserva la tarea pendiente.`);
        if(terminal.outcome==='interrupted')throw new Error(`${assignment.taskId}: ejecución interrumpida; no se reactivó Sol.`);
        const summary=terminal.outcome==='succeeded'?'Exploración terminada por el host; entrega verificada por el core.':'El host informó fallo de exploración.';
        try{core.recordInitResult(root,{workId:run.workId,taskId:assignment.taskId,status:terminal.outcome==='succeeded'?'completed':'failed',summary});}
        catch(error){if(terminal.outcome!=='succeeded')throw error;core.recordInitResult(root,{workId:run.workId,taskId:assignment.taskId,status:'failed',summary:`Entrega inválida: ${error.message}`});}
      }));
      check(signal);
      const unknown=outcomes.filter(o=>o.status==='rejected');
      if(unknown.length)throw new Error(unknown.map(o=>o.reason.message).join('\n'));
      run=core.readInit(root,{workId:run.workId});
      if(!run.allTerminal)throw new Error('Aún hay exploraciones pendientes; Sol no fue reactivado.');
      if((await ctx.client.session.get({sessionID})).agent!=='sol')throw new Error('El agente principal cambió durante init; las entregas se conservaron sin reactivarlo.');
      run=core.reserveInitContinuation(root,{workId:run.workId,messageId:id('msg')});
      const messageID=run.continuation.messageId;
      const history=await ctx.client.session.context({sessionID});
      const pending=await ctx.client.session.inbox.list({sessionID});
      if(!history.some(m=>m.id===messageID)&&!pending.some(m=>m.id===messageID)){
        check(signal);
        await ctx.client.session.synthetic({sessionID,id:messageID,delivery:'queue',text:`Finalizar init ${run.workId}. Todos los exploradores terminaron. Lee las entregas, registra fuentes y claims verificables, integra .sol/project.md usando sol_init_project_publish y cierra con sol_init_complete solo si los gates se cumplen. Si hay fallos informa límites y no declares inicialización completada.\n${run.results.map(r=>`${r.taskId}: ${r.status}; ${r.output}; ${r.summary}`).join('\n')}`,metadata:{source:'sol-init',workId:run.workId},resume:true},{signal});
      }
      core.ackInitContinuation(root,{workId:run.workId,messageId:messageID});
      return {status:'dispatched',workId:run.workId};
    } finally {signal.removeEventListener('abort',stop);}
  }
  return {
    run(sessionID,scope=''){
      if(running.has(sessionID))return running.get(sessionID).promise;
      const controller=new AbortController();
      const promise=execute(sessionID,scope,controller.signal).finally(()=>running.delete(sessionID));
      running.set(sessionID,{controller,promise});return promise;
    },
    cancel(sessionID){running.get(sessionID)?.controller.abort();},
    dispose(){for(const r of running.values())r.controller.abort();},
  };
}
