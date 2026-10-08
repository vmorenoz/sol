/** Synchronous file helpers. No agent sessions, queue, scheduler, timers or runtime state. */
import fs from 'node:fs';
import {assertSchema} from './schema.mjs';
import {bindEvidence,deriveWorkReadiness,evidenceBindingsCurrent,workContractDigest} from './contracts.mjs';
export {bindEvidence,compareShippingSnapshot,criterionContract,deriveTaskReadiness,deriveWorkReadiness,taskContract,workContractDigest} from './contracts.mjs';
import {safePath,exists,readJSON,readText,writeJSON,atomicWrite,assertID,now,fingerprint} from './fs.mjs';
const terminal = status => ['done','cancelled'].includes(status);
const wp = id => `.sol/work/${assertID(id)}/work.json`;
const unique = (values,label) => {if(new Set(values).size!==values.length)throw new Error(`${label}: duplicados`);};
const same = (a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function emptyState() {return {schemaVersion:1,revision:1,updatedAt:now(),focusWorkId:null,works:[]};}
export function initArtifacts(root) {
  if(!exists(root,'.sol/state.json'))writeJSON(root,'.sol/state.json',emptyState());
  if(!exists(root,'.sol/history.jsonl'))atomicWrite(root,'.sol/history.jsonl','');
  fs.mkdirSync(safePath(root,'.sol/work'),{recursive:true});
}
export function validateWork(root,w,{files=true,fresh=false}={}) {
  assertSchema('work',w);
  unique(w.objective.criteria.map(c=>c.id),'Criterios');unique(w.tasks.map(t=>t.id),'Tareas');unique(w.evidence.map(e=>e.id),'Evidencias');
  unique(w.documents.map(d=>d.path),'Documentos');
  if(w.shipping){
    unique(w.shipping.intents.map(x=>x.id),'Shipping intents');unique(w.shipping.receipts.map(x=>x.id),'Shipping receipts');
    const intents=new Map(w.shipping.intents.map(x=>[x.id,x]));
    for(const receipt of w.shipping.receipts)if(!intents.has(receipt.intentId))throw new Error(`Receipt Ship referencia intent inexistente: ${receipt.intentId}`);
    for(const intent of w.shipping.intents){if(intent.approval){if(!['approved','completed','invalidated'].includes(intent.status))throw new Error(`Aprobación Ship incompatible con estado: ${intent.id}`);if(intent.approval.snapshotSha256!==intent.snapshotSha256||intent.approval.actions.some(a=>!intent.actions.includes(a))||intent.approval.actions.some((a,i)=>i&&intent.actions.indexOf(a)<intent.actions.indexOf(intent.approval.actions[i-1])))throw new Error(`Aprobación Ship no corresponde al preview: ${intent.id}`);if(intent.status==='approved'&&intent.workContractSha256!==workContractDigest(w))throw new Error(`Aprobación Ship obsoleta por cambio de contrato: ${intent.id}`);if(intent.checkpointHeadSha&&intent.checkpointSnapshotSha256===undefined)throw new Error(`Checkpoint Ship incompleto: ${intent.id}`);}}
    for(const intent of w.shipping.intents){
      const receipts=w.shipping.receipts.filter(r=>r.intentId===intent.id),approved=intent.approval?.actions||[],completed=[];let checkpointHead=intent.headSha,checkpointSnapshot=intent.snapshotSha256;
      for(const receipt of receipts){
        if(receipt.snapshotSha256!==intent.approval?.snapshotSha256||receipt.contentSha256!==intent.contentSha256)throw new Error(`Receipt Ship fuera del snapshot/contenido autorizado: ${receipt.id}`);
        const next=approved.find(action=>!completed.includes(action));if(receipt.action!==next||receipt.beforeHeadSha!==checkpointHead||receipt.beforeSnapshotSha256!==checkpointSnapshot)throw new Error(`Cadena/checkpoint Ship inválido: ${receipt.id}`);
        if(receipt.action==='create_commit'&&receipt.status==='succeeded'&&receipt.afterHeadSha===receipt.beforeHeadSha)throw new Error(`create_commit sin nuevo HEAD: ${receipt.id}`);
        if(receipt.action!=='create_commit'&&receipt.afterHeadSha!==receipt.beforeHeadSha)throw new Error(`HEAD alterado por ${receipt.action}: ${receipt.id}`);
        if(receipt.action==='push_branch'&&receipt.status==='succeeded'&&receipt.pushedBranch!==intent.branch)throw new Error(`Branch receipt no aprobada: ${receipt.id}`);
        if(receipt.action==='create_pr'&&receipt.status==='succeeded'&&!receipt.prUrl)throw new Error(`PR receipt sin URL: ${receipt.id}`);
        if(receipt.status==='succeeded'){completed.push(receipt.action);checkpointHead=receipt.afterHeadSha;checkpointSnapshot=receipt.observedSnapshotSha256;}
      }
      if(intent.completedActions&&JSON.stringify(intent.completedActions)!==JSON.stringify(completed))throw new Error(`Acciones completadas Ship incoherentes: ${intent.id}`);
      if(intent.checkpointHeadSha&&intent.checkpointHeadSha!==checkpointHead||intent.checkpointSnapshotSha256&&intent.checkpointSnapshotSha256!==checkpointSnapshot)throw new Error(`Checkpoint Ship no coincide con receipts: ${intent.id}`);
      if(intent.status==='completed'&&completed.length!==approved.length||intent.status==='approved'&&completed.length===approved.length)throw new Error(`Estado completed Ship incoherente: ${intent.id}`);
    }
  }
  if(w.discovery){
    const discovery=w.discovery,sources=new Set(discovery.sources.map(x=>x.id)),questions=new Set(discovery.questions.map(x=>x.id)),decisions=new Map(discovery.decisions.map(x=>[x.id,x]));
    unique(discovery.sources.map(x=>x.id),'Fuentes');unique(discovery.claims.map(x=>x.id),'Afirmaciones');unique(discovery.assumptions.map(x=>x.id),'Supuestos');unique(discovery.questions.map(x=>x.id),'Preguntas');unique(discovery.decisions.map(x=>x.id),'Decisiones');
    for(const record of [...discovery.claims,...discovery.assumptions,...discovery.questions,...discovery.decisions])for(const id of record.sourceIds||[])if(!sources.has(id))throw new Error(`Discovery referencia fuente inexistente: ${id}`);
    for(const a of discovery.assumptions){if(a.status==='validated'&&!(a.sourceIds||[]).length)throw new Error(`Supuesto validado requiere fuentes: ${a.id}`);if(a.status==='rejected'&&(!a.resolution?.trim()||!(a.sourceIds||[]).length))throw new Error(`Supuesto rechazado requiere resolución y fuentes: ${a.id}`);}
    const taskIds=new Set(w.tasks.map(t=>t.id)),criterionIds=new Set(w.objective.criteria.map(c=>c.id));
    for(const record of [...discovery.assumptions,...discovery.questions,...discovery.decisions]){
      for(const [field,known,label] of [['taskIds',taskIds,'tarea'],['criterionIds',criterionIds,'criterio']]){
        unique(record[field]||[],`Discovery ${record.id} ${field}`);
        for(const id of record[field]||[])if(!known.has(id))throw new Error(`Discovery referencia ${label} inexistente: ${id}`);
      }
    }
    for(const q of discovery.questions){
      if(q.answer?.decisionId&&!decisions.has(q.answer.decisionId))throw new Error(`Pregunta referencia decisión inexistente: ${q.answer.decisionId}`);
      if(q.answer&&!q.answer.reportedAt)throw new Error(`Respuesta sin fecha: ${q.id}`);
      for(const id of q.answer?.sourceIds||[])if(!sources.has(id))throw new Error(`Respuesta de ${q.id} referencia fuente inexistente: ${id}`);
    }
    for(const d of discovery.decisions){
      for(const id of d.questionIds||[])if(!questions.has(id))throw new Error(`Decisión referencia pregunta inexistente: ${id}`);
      if(d.status==='confirmed'&&(!d.confirmedAt||!['user_reported','project_owner_reported','existing_source'].includes(d.confirmedBy)))throw new Error(`Decisión confirmada sin procedencia: ${d.id}`);
      if(d.status==='superseded'&&(!d.supersededBy||!d.supersessionReason?.trim()))throw new Error(`Decisión sustituida requiere reemplazo y motivo: ${d.id}`);
      if(d.supersedes){
        const prior=decisions.get(d.supersedes);
        if(!prior||prior.status!=='superseded'||prior.supersededBy!==d.id||!d.supersessionReason?.trim())throw new Error(`Cadena de sustitución inconsistente: ${d.id}`);
      }
      if(d.supersededBy){
        const replacement=decisions.get(d.supersededBy);
        if(d.status!=='superseded'||!replacement||replacement.supersedes!==d.id||!replacement.supersessionReason?.trim())throw new Error(`Cadena de sustitución inconsistente: ${d.id}`);
      }
    }
    for(const d of decisions.values()){
      const seen=new Set([d.id]);let next=d;
      while(next.supersededBy){
        if(seen.has(next.supersededBy))throw new Error('Ciclo de sustitución de decisiones');
        seen.add(next.supersededBy);next=decisions.get(next.supersededBy);
      }
      if(seen.size>1&&next.status!=='confirmed')throw new Error(`Cadena de sustitución sin decisión final confirmada: ${d.id}`);
    }
  }
  if (Date.parse(w.updatedAt)<Date.parse(w.createdAt))throw new Error('updatedAt anterior a createdAt');
  if (terminal(w.status)!==Boolean(w.closure))throw new Error('Cierre y estado terminal incoherentes');
  if(w.closure && (w.closure.cycle!==w.cycle || w.closure.outcome!==w.status || w.closure.id!==`${w.id}:c${w.cycle}`)) throw new Error('Identidad de cierre incoherente');
  const criteria=new Set(w.objective.criteria.map(c=>c.id)),tasks=new Map(w.tasks.map(t=>[t.id,t])), ev=new Map(w.evidence.map(e=>[e.id,e]));
  function refs(values,set,label){unique(values,label);for(const x of values)if(!set.has(x))throw new Error(`${label}: referencia inexistente ${x}`);}
  for(const c of w.objective.criteria)refs(c.evidenceIds,ev,`Criterio ${c.id}`);
  for(const t of w.tasks) {
    refs(t.criterionIds,criteria,`Tarea ${t.id} criterios`);refs(t.dependsOn,tasks,`Tarea ${t.id} dependencias`);refs(t.evidenceIds,ev,`Tarea ${t.id} evidencias`);
    for(const p of t.writeScope)safePath(root,p);
    if(t.dependsOn.includes(t.id))throw new Error(`Autodependencia: ${t.id}`);
    if(t.status==='cancelled' && !t.summary.trim())throw new Error(`Tarea ${t.id} cancelada sin motivo`);
  }
  const visiting=new Set(),visited=new Set();
  function visit(id){if(visiting.has(id))throw new Error(`Ciclo de dependencias: ${id}`);if(visited.has(id))return;visiting.add(id);for(const d of tasks.get(id).dependsOn)visit(d);visiting.delete(id);visited.add(id);}
  for(const t of w.tasks)visit(t.id);
  for(const d of w.documents){safePath(root,d.path);if(files&&!exists(root,d.path))throw new Error(`Documento no existe: ${d.path}`);}
  for(const e of w.evidence){
    refs(e.criterionIds,criteria,`Evidencia ${e.id} criterios`);refs(e.taskIds,tasks,`Evidencia ${e.id} tareas`);
    safePath(root,e.report);safePath(root,e.cwd,{allowDot:true});unique(e.files.map(f=>f.path),`Evidencia ${e.id} archivos`);
    if(files&&!exists(root,e.report))throw new Error(`Informe no existe: ${e.report}`);
    for(const f of e.files){safePath(root,f.path);} // Historical paths may be deleted; current acceptance checks freshness at close.
    if(e.kind==='not_run' && e.status!=='not_run' && e.status!=='blocked')throw new Error(`Evidencia ${e.id}: not_run no puede aprobar`);
    if(e.kind==='executed' && e.status==='pass' && (e.exitCode!==0 || !e.command?.trim()))throw new Error(`Evidencia ${e.id}: ejecución PASS requiere comando y exitCode=0`);
    if(e.kind!=='executed' && e.exitCode!==null)throw new Error(`Evidencia ${e.id}: exitCode solo para ejecución`);
    if(e.status==='pass' && fresh && !terminal(w.status) && (w.objective.criteria.some(c=>c.evidenceIds.includes(e.id)) || w.tasks.some(t=>t.evidenceIds.includes(e.id))))checkFresh(root,e);
  }
  for(const c of w.objective.criteria)for(const id of c.evidenceIds)if(!ev.get(id).criterionIds.includes(c.id))throw new Error(`Enlace de criterio ${c.id}/${id} no es recíproco`);
  for(const t of w.tasks)for(const id of t.evidenceIds)if(!ev.get(id).taskIds.includes(t.id))throw new Error(`Enlace de tarea ${t.id}/${id} no es recíproco`);
  if(w.closure){refs(w.closure.evidenceIds,ev,'Cierre evidencias');if(Date.parse(w.closure.at)<Date.parse(w.createdAt))throw new Error('Fecha de cierre anterior a creación');}
  if(w.status==='done')assertCompletion(root,w,{fresh:false});
  return w;
}
function checkFresh(root,e){for(const f of e.files)if(fingerprint(root,f.path).sha256!==f.sha256)throw new Error(`Evidencia obsoleta ${e.id}: ${f.path}`);}
export function readWork(root,id,options={}) {const w=readJSON(root,wp(id));if(w.id!==id)throw new Error('ID y ruta de Work no coinciden');return validateWork(root,w,options);}
export function status(root){const s=assertSchema('state',readJSON(root,'.sol/state.json'));unique(s.works.map(w=>w.id),'Índice del proyecto');for(const w of s.works){if(w.path!==wp(w.id))throw new Error('Ruta del índice incoherente');if(w.progress.done>w.progress.total)throw new Error('Progreso del índice incoherente');}if(s.focusWorkId&&!s.works.some(w=>w.id===s.focusWorkId))throw new Error('Foco inexistente');return s;}
export function history(root){
  const text=readText(root,'.sol/history.jsonl');const entries=[];
  for(const [i,line] of text.split('\n').entries()){if(!line.trim())continue;let e;try{e=JSON.parse(line);}catch{throw new Error(`Historial inválido en línea ${i+1}; no se sobrescribirá`);}assertSchema('history-entry',e);if(e.workPath!==wp(e.workId)||e.closureId!==`${e.workId}:c${e.cycle}`)throw new Error('Identidad inválida en historial');entries.push(e);}
  unique(entries.map(e=>e.closureId),'Cierres');return entries;
}
function summary(w){return {id:w.id,title:w.title,objective:w.objective.outcome,path:wp(w.id),status:w.status,priority:w.priority,workRevision:w.revision,cycle:w.cycle,progress:{done:w.tasks.filter(t=>t.status==='done').length,total:w.tasks.length},lastProgress:w.summary,blockers:w.blockers,decisionsPending:w.decisionsPending,nextAction:w.nextAction,updatedAt:w.updatedAt};}
function closureEntry(w){const c=w.closure;
  const entry={schemaVersion:1,closureId:c.id,workId:w.id,cycle:w.cycle,title:w.title,objective:w.objective.outcome,createdAt:w.createdAt,closedAt:c.at,outcome:c.outcome,summary:c.summary,limitations:c.limitations,evidenceIds:c.evidenceIds,workPath:wp(w.id)};
  return assertSchema('history-entry',entry);
}
function recordClosure(root,w){
  const h=history(root),entry=closureEntry(w);
  assertSchema('history-entry',entry);const old=h.find(e=>e.closureId===entry.closureId);
  if(old){if(!same(old,entry))throw new Error('Cierre existente diferente; requiere revisión humana');return;}
  // Logical append, whole-file atomic replacement to avoid partial trailing JSON records.
  atomicWrite(root,'.sol/history.jsonl',h.concat(entry).map(x=>JSON.stringify(x)).join('\n')+'\n');
}
function putSummary(root,w,focus=false){
  const s=status(root),index=s.works.findIndex(x=>x.id===w.id);
  if(terminal(w.status)){if(index>=0)s.works.splice(index,1);if(s.focusWorkId===w.id)s.focusWorkId=null;}
  else {const entry=summary(w);if(index<0)s.works.push(entry);else s.works[index]=entry;if(focus)s.focusWorkId=w.id;}
  s.revision++;s.updatedAt=now();writeJSON(root,'.sol/state.json',assertSchema('state',s));return s;
}
export function syncWork(root,id,{focus=false}={}) {const w=readWork(root,id,{files:false});if(w.closure)recordClosure(root,w);putSummary(root,w,focus);return w;}
export function createWork(root,{id,title,objective,criterion,verification,priority='normal'}) {
  assertID(id);if(exists(root,wp(id)))throw new Error(`Trabajo ya existe: ${id}`);
  status(root);history(root);const ts=now();
  const w={schemaVersion:1,id,revision:1,cycle:1,title,objective:{id:'OBJ-1',outcome:objective,criteria:[{id:'AC-1',description:criterion,verification,contractRevision:1,evidenceIds:[]}]},status:'pending',priority,createdAt:ts,updatedAt:ts,summary:'Trabajo creado; alcance pendiente de revisión.',blockers:[],decisionsPending:[],nextAction:'Revisar contexto y criterio de aceptación',documents:[],tasks:[],evidence:[],discovery:{schemaVersion:1,contextLane:'unknown',sources:[],claims:[],assumptions:[],questions:[],decisions:[]},shipping:{schemaVersion:1,intents:[],receipts:[]},closure:null};
  validateWork(root,w);writeJSON(root,wp(id),w);putSummary(root,w,true);return w;
}
export function recordContextSource(root,source){
  const item=structuredClone(source);
  if(Object.hasOwn(item,'fileSha256'))throw new Error('fileSha256 lo calcula el core; no se acepta del caller');
  if(Object.hasOwn(item,'inspectionProvenance'))throw new Error('inspectionProvenance lo calcula el core; no se acepta del caller');
  if(item.inspection!==undefined)item.inspectionProvenance='caller_reported';
  if(item.path){
    const target=safePath(root,item.path);
    if(item.inspection==='absent'){
      if(fs.existsSync(target))throw new Error(`Fuente declarada ausente pero existe: ${item.path}`);
    }else{
      if(!fs.existsSync(target))throw new Error(`Fuente local no encontrada: ${item.path}`);
      item.fileSha256=fingerprint(root,item.path).sha256;
    }
  }else if(item.inspection==='absent')throw new Error('Una observación absent requiere path local verificable');
  if(['repository','existing_document'].includes(item.kind)&&['read','contrasted'].includes(item.inspection)&&!item.path)
    throw new Error(`${item.inspection} de fuente local requiere path para fingerprint`);
  return item;
}

function validateContextMap(root,w,document='.sol/project.md'){
  const discovery=w.discovery,content=readText(root,document),sources=new Map((discovery?.sources||[]).map(s=>[s.id,s]));
  if(!discovery||!['existing-project','project-in-existing-repo','greenfield'].includes(discovery.contextLane))
    throw new Error('Mapeo incompleto: registre contextLane explícito (existing-project, project-in-existing-repo o greenfield).');
  const claims=(discovery.claims||[]).filter(c=>content.includes(`<!-- claim:${c.id} -->`));
  if(!claims.length)throw new Error('Mapeo incompleto: agregue al menos una afirmación Discovery enlazada en project.md con <!-- claim:ID -->.');
  const usedSources=new Map();
  for(const claim of claims){
    if(!claim.statement?.trim()||!claim.sourceIds?.length||!content.includes(claim.statement))throw new Error(`Afirmación ${claim.id} requiere texto y procedencia enlazados literalmente en project.md.`);
    for(const id of claim.sourceIds){
      const source=sources.get(id);if(!source)throw new Error(`Afirmación ${claim.id} referencia fuente inexistente: ${id}`);
      if(!content.includes(`<!-- source:${id} -->`))throw new Error(`project.md debe enlazar la fuente ${id} con <!-- source:${id} -->.`);
      if(source.path){
        const target=safePath(root,source.path),present=fs.existsSync(target);
        if(source.inspection==='absent'){
          if(present)throw new Error(`Fuente ${id} ya no está ausente; actualice solo el tema afectado y su afirmación.`);
        }else{
          if(!present)throw new Error(`Fuente ${id} desapareció: ${source.path}; refresque ese tema y registre una fuente nueva.`);
          const current=fingerprint(root,source.path).sha256;
          if(!source.fileSha256||current!==source.fileSha256)throw new Error(`Fuente ${id} cambió desde su lectura; refresque ese tema, registre una fuente nueva y actualice project.md.`);
        }
      }
      usedSources.set(id,source);
    }
  }
  const localRead=[...usedSources.values()].some(s=>['repository','existing_document'].includes(s.kind)&&['read','contrasted'].includes(s.inspection)&&s.inspectionProvenance==='caller_reported'&&s.path&&s.fileSha256);
  if(discovery.contextLane!=='greenfield'&&!localRead)throw new Error('Mapeo incompleto: cite al menos una fuente local repository/existing_document realmente marcada read o contrasted, con path y fingerprint vigente. “found” solo acredita localización.');
  if(discovery.contextLane==='greenfield'&&![...usedSources.values()].some(s=>s.kind==='user_statement'))throw new Error('Mapeo greenfield requiere intención reportada por el usuario enlazada a una afirmación; no invente arquitectura.');
  const files=new Map([[document,fingerprint(root,document)]]);
  for(const source of usedSources.values())if(source.path&&source.inspection!=='absent')files.set(source.path,fingerprint(root,source.path));
  return {claims,sources:[...usedSources.values()],files:[...files.values()]};
}

export function inspectContextMap(root,w){
  const mapTaskIds=new Set((w.tasks||[]).filter(t=>t.kind==='exploration').map(t=>t.id));
  const mapped=w.evidence?.some(e=>e.report==='.sol/project.md'&&e.taskIds?.some(id=>mapTaskIds.has(id)))||w.tasks?.some(t=>t.kind==='exploration'&&t.id==='T-1')||w.evidence?.some(e=>/sol-explorer/i.test(e.basis||''));
  if(!mapped)return {status:'not_mapped',reasons:[]};
  if(!w.discovery?.claims?.length||!w.discovery?.sources?.some(s=>s.path||s.kind==='user_statement'))return {status:'legacy_unverified',reasons:['El mapeo existente no conserva procedencia Discovery estructurada verificable.']};
  const closureEvidence=new Set(w.closure?.evidenceIds||[]);
  const mapEvidence=w.evidence?.find(e=>e.report==='.sol/project.md'&&e.taskIds?.some(id=>mapTaskIds.has(id)))||w.evidence?.find(e=>closureEvidence.has(e.id));
  if(!mapEvidence?.files?.some(file=>file.path==='.sol/project.md'))return {status:'legacy_unverified',reasons:['El mapeo no conserva fingerprint del documento en su evidencia; su vigencia no puede comprobarse.']};
  for(const file of mapEvidence.files){
    let current;try{current=fingerprint(root,file.path);}catch{return {status:'stale',reasons:[`No se puede comprobar el archivo archivado del mapeo: ${file.path}`]};}
    if(current.sha256!==file.sha256)return {status:'stale',reasons:[`${file.path==='.sol/project.md'?'Documento de mapeo':'Fuente del mapeo'} cambió desde la evidencia archivada: ${file.path}`]};
  }
  try{const result=validateContextMap(root,w);return {status:'current',reasons:[],claimIds:result.claims.map(c=>c.id),sourceIds:result.sources.map(s=>s.id)};}
  catch(error){if(/sin marcadores|al menos una afirmación Discovery/.test(error.message))return {status:'legacy_unverified',reasons:[error.message]};return {status:'stale',reasons:[error.message]};}
}

export function completeProjectMap(root,{workId,expectedRevision,summary:result,limitations=[]}={}){
  if(!result?.trim())throw new Error('Completar mapeo requiere summary');
  const id=workId,w=readWork(root,id,{files:false});
  if(!Number.isSafeInteger(expectedRevision)||w.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${w.revision}. Releer y reconciliar, no sobrescribir.`);
  if(terminal(w.status))throw new Error('El trabajo de mapeo ya está cerrado');
  if(w.evidence.length||w.objective.criteria.length!==1||w.documents.some(d=>d.path!=='.sol/project.md'))
    throw new Error('complete-map solo admite un trabajo de contexto sin consolidación previa');
  const task=w.tasks[0],criterion=w.objective.criteria[0];
  if(w.tasks.length!==1||task?.kind!=='exploration'||task.status!=='in_progress'||task.dependsOn.length||task.criterionIds.length!==1||task.criterionIds[0]!==criterion.id||!task.writeScope.some(p=>p==='.sol/project.md'||'.sol/project.md'.startsWith(p+'/')))
    throw new Error('complete-map requiere una tarea exploration en curso creada antes del mapeo, vinculada al criterio y con alcance de escritura sobre .sol/project.md');
  const document='.sol/project.md';
  if(!exists(root,document))throw new Error(`Documento no existe: ${document}`);
  if(!readText(root,document).includes('<!-- template: project@1.0 -->'))throw new Error('project.md no declara template project@1.0');
  const map=validateContextMap(root,w,document);
  const taskId=task.id,evidenceId='E-1',checkedAt=now();
  w.status='in_progress';w.summary=result;w.nextAction='Cerrar el mapeo con su evidencia estática';
  if(!w.documents.some(d=>d.path===document))w.documents.push({kind:'project',path:document,templateVersion:'project@1.0'});
  task.status='done';task.evidenceIds=[evidenceId];task.summary=result;
  const evidence={id:evidenceId,kind:'static',status:'pass',checkedAt,criterionIds:[criterion.id],taskIds:[taskId],report:document,command:null,cwd:'.',exitCode:null,basis:'Core comprobó enlaces Discovery/documento y fingerprints locales actuales; la etiqueta read/contrasted es caller_reported. No acredita verdad semántica, ejecución ni autenticidad de revisión humana o de agente.',files:map.files,summary:result};
  evidence.contractBindings=bindEvidence(w,evidence);w.evidence=[evidence];
  criterion.evidenceIds=[evidenceId];
  // Preflight the exact closure record and final Work before the first write. closeWork
  // validates these same schemas after saveWork; validating here avoids a half-completed map.
  const acceptedEvidence=assertCompletion(root,w);
  const closedAt=now(),projected=structuredClone(w);
  projected.revision+=2;projected.status='done';projected.summary=result;projected.nextAction=null;projected.updatedAt=closedAt;
  projected.closure={id:`${id}:c${w.cycle}`,cycle:w.cycle,at:closedAt,outcome:'done',summary:result,limitations,evidenceIds:acceptedEvidence};
  closureEntry(projected);validateWork(root,projected,{files:false});
  saveWork(root,w,w.revision);
  const closed=closeWork(root,id,{summary:result,limitations});
  return {schemaVersion:1,id:closed.id,status:closed.status,revision:closed.revision,document,evidenceId,closureId:closed.closure.id,mapStatus:'current',claimIds:map.claims.map(c=>c.id),sourceIds:map.sources.map(s=>s.id),fingerprintedFiles:map.files.map(f=>f.path)};
}
export function saveWork(root,candidate,expectedRevision){
  assertSchema('work',candidate);const old=readWork(root,candidate.id,{files:false});
  if(!Number.isSafeInteger(expectedRevision)||old.revision!==expectedRevision||candidate.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${old.revision}. Releer y reconciliar, no sobrescribir.`);
  if(terminal(old.status)||terminal(candidate.status))throw new Error('Usar close/reopen para estados terminales');
  if(candidate.cycle!==old.cycle||candidate.createdAt!==old.createdAt||candidate.objective.id!==old.objective.id)throw new Error('Identidad/ciclo/fecha de creación inmutables');
  status(root);const priorHistory=history(root); // Preflight before persisting canonical data.
  const archivedIDs=new Set(priorHistory.filter(e=>e.workId===old.id).flatMap(e=>e.evidenceIds));
  for(const id of archivedIDs){const before=old.evidence.find(e=>e.id===id),after=candidate.evidence.find(e=>e.id===id);if(!same(before,after))throw new Error(`Evidencia archivada inmutable: ${id}`);}
  const w=structuredClone(candidate);w.revision++;w.updatedAt=now();validateWork(root,w);
  writeJSON(root,wp(w.id),w);putSummary(root,w);return w;
}
export function saveShippingMetadata(root,candidate,expectedRevision){
  assertSchema('work',candidate);const old=readWork(root,candidate.id,{files:false});
  if(old.status!=='done'||candidate.status!=='done')throw new Error('Shipping tardío solo admite Work done');
  if(!Number.isSafeInteger(expectedRevision)||old.revision!==expectedRevision||candidate.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${old.revision}. Releer y reconciliar, no sobrescribir.`);
  const before=structuredClone(old),after=structuredClone(candidate);delete before.shipping;delete after.shipping;delete before.revision;delete after.revision;delete before.updatedAt;delete after.updatedAt;
  if(!same(before,after))throw new Error('Work done solo permite mutaciones aisladas de shipping metadata');
  const entry=closureEntry(old),archived=history(root).find(item=>item.closureId===old.closure.id);
  if(!archived||!same(entry,archived))throw new Error('Cierre/historial inconsistente; no se escribirá Shipping');
  const saved=structuredClone(candidate);saved.revision++;saved.updatedAt=now();validateWork(root,saved);
  writeJSON(root,wp(saved.id),saved);putSummary(root,saved);return saved;
}
function assertCompletion(root,w,{fresh=true}={}){
  const readiness=deriveWorkReadiness(w),researchOnly=w.tasks.length>0&&w.tasks.every(t=>['research','exploration','specification','planning'].includes(t.kind));
  if(w.blockers.length||w.decisionsPending.length&&!researchOnly)throw new Error('Trabajo con bloqueos o decisiones pendientes');
  if(w.tasks.some(t=>!terminal(t.status)))throw new Error('Hay tareas abiertas');
  if(!readiness.completionReady)throw new Error(`Trabajo no listo para completar: ${readiness.completionReasons.join('; ')}`);
  const ev=new Map(w.evidence.map(e=>[e.id,e]));const used=new Set();
  const covering=(ids,predicate,label)=>{if(ids.some(id=>ev.get(id)?.status!=='pass'))throw new Error(`Aceptación contiene evidencia no positiva: ${label}`);const es=ids.map(id=>ev.get(id)).filter(e=>e&&e.status==='pass'&&e.kind!=='not_run'&&predicate(e)&&evidenceBindingsCurrent(w,e));if(!es.length)throw new Error(`Falta evidencia positiva vinculada al contrato vigente: ${label}`);for(const e of es){if(fresh)checkFresh(root,e);used.add(e.id);}};
  for(const c of w.objective.criteria)covering(c.evidenceIds,e=>e.criterionIds.includes(c.id),c.id);
  for(const t of w.tasks.filter(t=>t.status==='done')){
    const taskAcceptanceIds=t.criterionIds.length>0?t.evidenceIds.filter(id=>(ev.get(id)?.criterionIds?.length??0)>0):t.evidenceIds;
    covering(taskAcceptanceIds,e=>e.taskIds.includes(t.id),t.id);
  }
  return [...used];
}
export function closeWork(root,id,{outcome='done',summary:result,limitations=[]}={}){
  if(!['done','cancelled'].includes(outcome)||!result?.trim())throw new Error('Cierre requiere outcome y summary válidos');
  const w=readWork(root,id);status(root);history(root);
  if(w.closure){if(w.closure.outcome!==outcome||w.closure.summary!==result||!same(w.closure.limitations,limitations))throw new Error('Trabajo ya cerrado con otro resultado');syncWork(root,id);return w;}
  const evid=outcome==='done'?assertCompletion(root,w):w.evidence.map(e=>e.id);
  if(outcome==='cancelled')for(const t of w.tasks)if(!terminal(t.status)){t.status='cancelled';t.summary=`Cancelada al cerrar trabajo: ${result}`;}
  w.revision++;w.status=outcome;w.summary=result;w.nextAction=null;w.updatedAt=now();
  w.closure={id:`${id}:c${w.cycle}`,cycle:w.cycle,at:w.updatedAt,outcome,summary:result,evidenceIds:evid,limitations};
  validateWork(root,w);writeJSON(root,wp(id),w);recordClosure(root,w);putSummary(root,w);return w;
}
export function reopenWork(root,id,reason){
  if(!reason?.trim())throw new Error('Reapertura requiere motivo');const w=readWork(root,id,{files:false});if(!w.closure)throw new Error('Trabajo ya abierto');status(root);recordClosure(root,w);
  w.cycle++;w.revision++;w.status='pending';w.closure=null;w.updatedAt=now();w.summary=`Reabierto: ${reason}`;w.nextAction='Revisar alcance, tareas y evidencia antes de continuar';
  // The original closure keeps its evidence references; active criteria/tasks need new acceptance.
  for(const c of w.objective.criteria)c.evidenceIds=[];
  for(const t of w.tasks){t.status='pending';t.evidenceIds=[];t.summary='Revisión requerida tras reapertura';}
  validateWork(root,w,{files:false});writeJSON(root,wp(id),w);putSummary(root,w,true);return w;
}
export function repair(root){
  const oldHistory=history(root);const folder=safePath(root,'.sol/work');const works=[];
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){if(item.isSymbolicLink())throw new Error('Symlink en work');if(item.isDirectory()){assertID(item.name);works.push(readWork(root,item.name,{files:false}));}}
  // Validate every work before any changes; never use a partial successful subset.
  const ids=new Set(works.map(w=>w.id));
  for(const e of oldHistory)if(!ids.has(e.workId))throw new Error(`Historial apunta a trabajo ausente: ${e.workId}; restaurar carpeta antes de reparar.`);
  let old;try{old=status(root);}catch{old=null;}
  if(old)for(const e of old.works)if(!ids.has(e.id))throw new Error(`Índice apunta a trabajo ausente: ${e.id}; no se descartará.`);
  for(const w of works)if(w.closure)recordClosure(root,w);
  const s=emptyState();s.revision=(old?.revision||0)+1;s.works=works.filter(w=>!terminal(w.status)).map(summary);
  s.focusWorkId=s.works.some(w=>w.id===old?.focusWorkId)?old.focusWorkId:null;
  // Preserve malformed index before explicit repair, not silently discard it.
  if(!old&&exists(root,'.sol/state.json'))atomicWrite(root,`.sol/recovery/state-${Date.now()}.json`,readText(root,'.sol/state.json'));
  writeJSON(root,'.sol/state.json',s);return s;
}
export function validateProject(root,{fresh=false}={}){
  const s=status(root),h=history(root),seen=new Set();let count=0;
  for(const item of fs.readdirSync(safePath(root,'.sol/work'),{withFileTypes:true})){
    if(item.isSymbolicLink())throw new Error('Symlink en work');if(!item.isDirectory())continue;
    const w=readWork(root,item.name,{fresh});seen.add(w.id);count++;
    const entry=s.works.find(x=>x.id===w.id);
    if(w.closure){if(entry)throw new Error(`Cerrado aún en índice: ${w.id}. Ejecutar sync.`);const archived=h.find(x=>x.closureId===w.closure.id);if(!archived)throw new Error(`Cierre sin historial: ${w.id}. Ejecutar sync.`);if(!same(archived,closureEntry(w)))throw new Error(`Cierre inconsistente con historial: ${w.id}`);}
    else if(!entry||!same(entry,summary(w)))throw new Error(`Índice desactualizado: ${w.id}. Ejecutar sync.`);
  }
  for(const entry of s.works)if(!seen.has(entry.id))throw new Error(`Índice sin archivo: ${entry.id}`);
  for(const entry of h)if(!seen.has(entry.workId))throw new Error(`Historial apunta a trabajo ausente: ${entry.workId}`);
  return {valid:true,works:count,active:s.works.length,closures:h.length,freshnessChecked:fresh};
}
export function validateResult(root,delegation,result){
  assertSchema('delegation',delegation);assertSchema('result',result);
  for(const p of [...delegation.inputs,delegation.template,delegation.output,...delegation.writeScope])safePath(root,p);
  for(const [left,right] of [['id','delegationId'],['workId','workId'],['workRevision','workRevision'],['agent','agent']])if(delegation[left]!==result[right])throw new Error(`Resultado no corresponde al encargo: ${right}`);
  // An empty taskIds list means the delegation has no task-level scope. When IDs
  // are declared, validate them against the referenced Work without requiring its
  // current revision to equal the delegation snapshot (parallel metadata edits are valid).
  if(delegation.taskIds?.length){
    const work=readWork(root,delegation.workId,{files:false});
    const known=new Set(work.tasks.map(task=>task.id));
    for(const taskId of delegation.taskIds)if(!known.has(taskId))throw new Error(`Encargo referencia tarea inexistente en ${delegation.workId}: ${taskId}`);
  }
  const allowed=p=>delegation.writeScope.some(scope=>p===scope||p.startsWith(scope+'/'));
  for(const p of [...result.artifacts,...result.changedFiles]){safePath(root,p);if(!allowed(p))throw new Error(`Resultado fuera del alcance de escritura: ${p}`);if(!exists(root,p))throw new Error(`Archivo declarado inexistente: ${p}`);}
  return {valid:true,semanticAcceptance:'PENDING_REVIEW',note:'No prueba ejecución, identidad nativa ni ausencia de otros cambios. Revisar diff y evidencia.'};
}
