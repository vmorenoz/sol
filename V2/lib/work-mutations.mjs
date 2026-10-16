import {closeWork,createWork,readWork,reopenWork,recordContextSource,saveShippingMetadata,saveWork,status,history,validateProject,completeProjectMap} from './artifacts.mjs';
import {assertID,fingerprint,now,safePath} from './fs.mjs';
import {workReceipt} from './receipts.mjs';
import {assertSchema,schema} from './schema.mjs';
import {bindEvidence,deriveTaskReadiness,evidenceBindingsCurrent,workContractDigest} from './contracts.mjs';

function invalidateContracts(work,{criterionIds=[],taskIds=[]},reason){
  const criteria=new Set(criterionIds),tasks=new Set(taskIds);let changed=true;
  for(const task of work.tasks)if(task.criterionIds.some(id=>criteria.has(id)))tasks.add(task.id);
  while(changed){changed=false;for(const task of work.tasks)if(!tasks.has(task.id)&&(task.dependsOn||[]).some(id=>tasks.has(id))){tasks.add(task.id);changed=true;}}
  for(const task of work.tasks)if(tasks.has(task.id)||task.criterionIds.some(id=>criteria.has(id))){if(task.status!=='cancelled')task.status='pending';task.contractRevision=(task.contractRevision||1)+1;task.summary=reason;}
  const invalidEvidence=new Set(work.evidence.filter(e=>e.criterionIds.some(id=>criteria.has(id))||e.taskIds.some(id=>tasks.has(id))).map(e=>e.id));
  for(const criterion of work.objective.criteria)criterion.evidenceIds=criterion.evidenceIds.filter(id=>!invalidEvidence.has(id));
  for(const task of work.tasks)task.evidenceIds=task.evidenceIds.filter(id=>!invalidEvidence.has(id));
}

function assertTaskAcceptanceFresh(root,work,task){
  const positive=work.evidence.filter(e=>e.status==='pass'&&e.kind!=='not_run'&&e.contractBindings&&evidenceBindingsCurrent(work,e)&&e.taskIds.includes(task.id));
  for(const criterionId of task.criterionIds){const criterion=work.objective.criteria.find(c=>c.id===criterionId);const covered=positive.find(e=>e.criterionIds.includes(criterionId)&&criterion?.evidenceIds.includes(e.id)&&task.evidenceIds.includes(e.id));if(!covered)throw new Error(`Completar ${task.id} requiere evidencia positiva vigente para ${criterionId}`);for(const file of covered.files)if(fingerprint(root,file.path).sha256!==file.sha256)throw new Error(`Evidencia obsoleta ${covered.id}: ${file.path}`);}
  if(!positive.some(e=>task.evidenceIds.includes(e.id)))throw new Error(`Completar ${task.id} requiere evidencia positiva vinculada al contrato vigente`);
}

const text=(value,label,{required=true,max=4000}={})=>{
  if(typeof value!=='string'||(required&&!value.trim())||value.length>max)throw new Error(`${label}: texto inválido`);
  return value;
};
const list=(value,label,max=50)=>{
  if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=='string'))throw new Error(`${label}: lista inválida`);
  return value;
};
const keys=(value,allowed)=>{for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(`Campo de acción no admitido: ${key}`);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sameRecord=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const priorities=schema('work').properties.priority.enum;
const assertPriority=value=>{if(!priorities.includes(value))throw new Error(`priority inválida: usa ${priorities.join(', ')}`);};

export function createWorkOperation(root,input) {
  assertPriority(input?.priority||'normal');
  assertSchema('work-create',input);
  const priority=input.priority||'normal';
  const work=createWork(root,{id:input.workId,title:text(input.title,'title',{max:240}),objective:text(input.objective,'objective'),criterion:text(input.criterion,'criterion'),verification:text(input.verification,'verification'),priority});
  return workReceipt(work,{operation:'work.create',changes:['objetivo y criterio registrados']});
}

export function applyWorkMutation(root,{workId,expectedRevision,actions}) {
  if(Array.isArray(actions))for(const action of actions)if(action?.type==='work.set_overview'&&action.priority!==undefined)assertPriority(action.priority);
  assertSchema('work-update',{workId,expectedRevision,actions});
  assertID(workId);
  if(!Number.isSafeInteger(expectedRevision))throw new Error('expectedRevision es obligatorio');
  if(!Array.isArray(actions)||actions.length<1||actions.length>20)throw new Error('actions debe contener entre 1 y 20 acciones');
  const work=readWork(root,workId,{files:false});
  if(work.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${work.revision}. Releer y reconciliar, no sobrescribir.`);
  const candidate=structuredClone(work),changes=[];
  for(const action of actions){
    if(!action||typeof action!=='object'||Array.isArray(action))throw new Error('Acción inválida');
    switch(action.type){
      case 'work.set_overview': {
        keys(action,['type','summary','blockers','decisionsPending','nextAction','priority','status']);
        if(action.summary!==undefined)candidate.summary=text(action.summary,'summary',{max:2000});
        if(action.blockers!==undefined)candidate.blockers=list(action.blockers,'blockers',30).map(x=>text(x,'blocker',{max:500}));
        if(action.decisionsPending!==undefined)candidate.decisionsPending=list(action.decisionsPending,'decisionsPending',30).map(x=>text(x,'decision',{max:500}));
        if(action.nextAction!==undefined)candidate.nextAction=action.nextAction===null?null:text(action.nextAction,'nextAction',{max:1000});
        if(action.priority!==undefined){assertPriority(action.priority);candidate.priority=action.priority;}
        if(action.status!==undefined){if(!['pending','in_progress','blocked','paused'].includes(action.status))throw new Error('work status terminal requiere close/reopen');candidate.status=action.status;}
        changes.push('resumen del trabajo actualizado');break;
      }
      case 'task.add': {
        keys(action,['type','task']);
        assertID(action.task?.id);if(candidate.tasks.some(t=>t.id===action.task.id))throw new Error(`Tarea duplicada: ${action.task.id}`);
        const task=structuredClone(action.task);task.kind=task.kind||'implementation';task.contractRevision=task.contractRevision||1;
        task.title=text(task.title,'task.title',{max:300});
        candidate.tasks.push(task);
        if(task.status==='in_progress'&&!deriveTaskReadiness(candidate,task.id).ready)throw new Error(`No se puede iniciar ${(task.kind||'implementation')==='implementation'?'implementación':'tarea'}: ${deriveTaskReadiness(candidate,task.id).reasons.join('; ')}`);
        if(task.status==='done'){if(!deriveTaskReadiness(candidate,task.id).ready)throw new Error(`No se puede completar ${(task.kind||'implementation')==='implementation'?'implementación':'tarea'}: ${deriveTaskReadiness(candidate,task.id).reasons.join('; ')}`);assertTaskAcceptanceFresh(root,candidate,task);}
        changes.push(`${task.id} agregada`);break;
      }
      case 'task.update': {
        keys(action,['type','taskId','patch']);
        assertID(action.taskId);const task=candidate.tasks.find(t=>t.id===action.taskId);if(!task)throw new Error(`Tarea inexistente: ${action.taskId}`);
        const patch=action.patch;if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('task.update requiere patch');
        const allowed=new Set(['title','kind','criterionIds','agent','dependsOn','writeScope','resources','acceptance','summary']);
        for(const key of Object.keys(patch))if(!allowed.has(key))throw new Error(`Campo de tarea no actualizable: ${key}`);
        if(patch.title!==undefined)task.title=text(patch.title,'task.title',{max:300});
        if(patch.agent!==undefined)task.agent=text(patch.agent,'task.agent',{max:80});
        if(patch.kind!==undefined)task.kind=patch.kind;
        if(patch.summary!==undefined)task.summary=text(patch.summary,'task.summary',{required:false,max:2000});
        for(const key of ['criterionIds','dependsOn','resources','acceptance','writeScope'])if(patch[key]!==undefined)task[key]=list(patch[key],`task.${key}`).map(v=>text(v,`task.${key}`,{max:1000}));
        if(task.status==='in_progress'&&!deriveTaskReadiness(candidate,task.id).ready)throw new Error(`No se puede iniciar ${(task.kind||'implementation')==='implementation'?'implementación':'tarea'}: ${deriveTaskReadiness(candidate,task.id).reasons.join('; ')}`);
        if(['title','kind','criterionIds','dependsOn','writeScope','resources','acceptance'].some(k=>patch[k]!==undefined))invalidateContracts(candidate,{taskIds:[task.id]},`Contrato de tarea ${task.id} actualizado`);
        changes.push(`${task.id} actualizada`);break;
      }
      case 'task.set_status': {
        keys(action,['type','taskId','status','summary']);
        assertID(action.taskId);const task=candidate.tasks.find(t=>t.id===action.taskId);if(!task)throw new Error(`Tarea inexistente: ${action.taskId}`);
        if(!['pending','in_progress','blocked','paused','done','cancelled'].includes(action.status))throw new Error('Estado de tarea inválido');
        if(task.status==='done'&&action.status!=='done')invalidateContracts(candidate,{taskIds:[task.id]},`Aceptación de ${task.id} retirada al cambiar a ${action.status}`);
        // Preserve the explicitly requested state (including cancellation); only dependant acceptance is reset.
        task.status=action.status;if(action.summary!==undefined)task.summary=text(action.summary,'task.summary',{max:2000});
        if(action.status==='in_progress'&&!deriveTaskReadiness(candidate,task.id).ready)throw new Error(`No se puede iniciar ${(task.kind||'implementation')==='implementation'?'implementación':'tarea'}: ${deriveTaskReadiness(candidate,task.id).reasons.join('; ')}`);
        if(action.status==='done'){if(!deriveTaskReadiness(candidate,task.id).ready)throw new Error(`No se puede completar ${(task.kind||'implementation')==='implementation'?'implementación':'tarea'}: ${deriveTaskReadiness(candidate,task.id).reasons.join('; ')}`);assertTaskAcceptanceFresh(root,candidate,task);}
        if(action.status==='cancelled'&&!task.summary.trim())throw new Error('Tarea cancelada requiere motivo');
        changes.push(`${task.id} ${action.status==='done'?'completada':action.status}`);break;
      }
      case 'evidence.add': {
        keys(action,['type','evidence']);
        const e=structuredClone(action.evidence);assertID(e?.id);if(candidate.evidence.some(x=>x.id===e.id))throw new Error(`Evidencia duplicada: ${e.id}`);
        e.checkedAt=e.checkedAt||now();e.command=e.command??null;e.exitCode=e.exitCode??null;
        const explicitCriteria=Object.hasOwn(action.evidence,'criterionIds');
        if(explicitCriteria){
          if(!Array.isArray(action.evidence.criterionIds))throw new Error('evidence.criterionIds: lista inválida');
          for(const id of action.evidence.criterionIds){assertID(id);const c=candidate.objective.criteria.find(x=>x.id===id);if(!c)throw new Error(`Criterio inexistente: ${id}`);}
          e.criterionIds=[...new Set(action.evidence.criterionIds)];
        } else {
          e.criterionIds=[...new Set((e.taskIds||[]).flatMap(id=>candidate.tasks.find(t=>t.id===id)?.criterionIds||[]))];
        }
        e.files=list(e.files||[],'evidence.files',50).map(p=>fingerprint(root,p));if(!e.files.length)throw new Error('evidence.add requiere al menos un archivo fingerprintado');
        if(Object.hasOwn(e,'contractBindings'))throw new Error('contractBindings los calcula el core');e.contractBindings=bindEvidence(candidate,e);
        safePath(root,e.report);text(e.summary,'evidence.summary',{max:2000});
        candidate.evidence.push(e);
        for(const id of e.criterionIds||[]){const c=candidate.objective.criteria.find(x=>x.id===id);if(!c)throw new Error(`Criterio inexistente: ${id}`);if(!c.evidenceIds.includes(e.id))c.evidenceIds.push(e.id);}
        for(const id of e.taskIds||[]){const t=candidate.tasks.find(x=>x.id===id);if(!t)throw new Error(`Tarea inexistente: ${id}`);if(!t.evidenceIds.includes(e.id))t.evidenceIds.push(e.id);}
        changes.push(`${e.id} registrada`);break;
      }
      case 'evidence.update': {
        keys(action,['type','evidenceId','patch']);
        assertID(action.evidenceId);const evidence=candidate.evidence.find(e=>e.id===action.evidenceId);if(!evidence)throw new Error(`Evidencia inexistente: ${action.evidenceId}`);
        const patch=action.patch;if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('evidence.update requiere patch');
        const allowed=new Set(['kind','status','report','command','cwd','exitCode','basis','files','summary']);
        for(const key of Object.keys(patch))if(!allowed.has(key))throw new Error(`Campo de evidencia no actualizable: ${key}`);
        const beforeEvidence=structuredClone(evidence);
        const acceptedTaskIds=candidate.tasks.filter(t=>t.status==='done'&&t.evidenceIds.includes(evidence.id)).map(t=>t.id);
        Object.assign(evidence,patch);
        if(patch.files!==undefined)evidence.files=list(patch.files,'evidence.files',50).map(p=>fingerprint(root,p));
        if(!evidence.files.length)throw new Error('La evidencia requiere al menos un archivo');
        if(acceptedTaskIds.length&&!sameRecord(beforeEvidence,evidence))invalidateContracts(candidate,{taskIds:acceptedTaskIds},`Evidencia aceptada ${evidence.id} modificada; requiere nueva aceptación`);
        evidence.checkedAt=now();changes.push(`${evidence.id} actualizada`);break;
      }
      case 'evidence.remove': {
        keys(action,['type','evidenceId']);
        assertID(action.evidenceId);const index=candidate.evidence.findIndex(e=>e.id===action.evidenceId);if(index<0)throw new Error(`Evidencia inexistente: ${action.evidenceId}`);
        const acceptedTaskIds=candidate.tasks.filter(t=>t.status==='done'&&t.evidenceIds.includes(action.evidenceId)).map(t=>t.id);
        if(acceptedTaskIds.length)invalidateContracts(candidate,{taskIds:acceptedTaskIds},`Evidencia aceptada ${action.evidenceId} retirada; requiere nueva aceptación`);
        candidate.evidence.splice(index,1);for(const c of candidate.objective.criteria)c.evidenceIds=c.evidenceIds.filter(id=>id!==action.evidenceId);for(const t of candidate.tasks)t.evidenceIds=t.evidenceIds.filter(id=>id!==action.evidenceId);
        changes.push(`${action.evidenceId} retirada`);break;
      }
      case 'criterion.add': {
        keys(action,['type','criterion']);
        const criterion=structuredClone(action.criterion);assertID(criterion?.id);if(candidate.objective.criteria.some(c=>c.id===criterion.id))throw new Error(`Criterio duplicado: ${criterion.id}`);
        criterion.description=text(criterion.description,'criterion.description',{max:2000});criterion.verification=text(criterion.verification,'criterion.verification',{max:2000});criterion.evidenceIds=[];
        candidate.objective.criteria.push(criterion);changes.push(`${criterion.id} agregada`);break;
      }
      case 'criterion.update': {
        keys(action,['type','criterionId','reason','description','verification']);
        assertID(action.criterionId);const criterion=candidate.objective.criteria.find(c=>c.id===action.criterionId);if(!criterion)throw new Error(`Criterio inexistente: ${action.criterionId}`);
        if(!text(action.reason,'reason',{max:1000}))throw new Error('Cambiar un criterio requiere motivo');
        if(action.description!==undefined)criterion.description=text(action.description,'criterion.description',{max:2000});if(action.verification!==undefined)criterion.verification=text(action.verification,'criterion.verification',{max:2000});criterion.contractRevision=(criterion.contractRevision||1)+1;invalidateContracts(candidate,{criterionIds:[criterion.id]},`Contrato de criterio ${criterion.id} actualizado`);
        changes.push(`${criterion.id} actualizado con motivo registrado`);break;
      }
      case 'criterion.remove': {
        keys(action,['type','criterionId']);
        assertID(action.criterionId);const criterion=candidate.objective.criteria.find(c=>c.id===action.criterionId);if(!criterion)throw new Error(`Criterio inexistente: ${action.criterionId}`);
        if(criterion.evidenceIds.length||candidate.tasks.some(t=>t.criterionIds.includes(action.criterionId)))throw new Error(`Criterio ${action.criterionId} tiene dependencias`);
        candidate.objective.criteria=candidate.objective.criteria.filter(c=>c.id!==action.criterionId);changes.push(`${action.criterionId} retirada`);break;
      }
      case 'task.remove': {
        keys(action,['type','taskId']);
        assertID(action.taskId);const task=candidate.tasks.find(t=>t.id===action.taskId);if(!task)throw new Error(`Tarea inexistente: ${action.taskId}`);
        if(task.evidenceIds.length||candidate.tasks.some(t=>t.dependsOn.includes(action.taskId)))throw new Error(`Tarea ${action.taskId} tiene dependencias`);
        candidate.tasks=candidate.tasks.filter(t=>t.id!==action.taskId);changes.push(`${action.taskId} retirada`);break;
      }
      case 'document.register': {
        keys(action,['type','document']);
        const doc=structuredClone(action.document);safePath(root,doc?.path);
        if(candidate.documents.some(d=>d.path===doc.path))throw new Error(`Documento ya registrado: ${doc.path}`);
        candidate.documents.push(doc);changes.push('documento registrado');break;
      }
      case 'document.unregister': {
        keys(action,['type','path']);
        safePath(root,action.path);if(candidate.evidence.some(e=>e.report===action.path))throw new Error('El documento es informe de evidencia vigente');
        if(!candidate.documents.some(d=>d.path===action.path))throw new Error(`Documento no registrado: ${action.path}`);
        candidate.documents=candidate.documents.filter(d=>d.path!==action.path);changes.push('documento retirado del registro');break;
      }
      case 'discovery.context.set': {
        keys(action,['type','contextLane']);
        const discovery=candidate.discovery||(candidate.discovery={schemaVersion:1,contextLane:'unknown',sources:[],claims:[],assumptions:[],questions:[],decisions:[]});
        discovery.contextLane=action.contextLane;changes.push(`context lane ${action.contextLane}`);break;
      }
      case 'discovery.source.add': case 'discovery.claim.add': case 'discovery.assumption.add': case 'discovery.question.add': case 'discovery.decision.add': {
        const [,kind]=action.type.split('.');keys(action,['type',kind]);
        const ledger=candidate.discovery||(candidate.discovery={schemaVersion:1,contextLane:'unknown',sources:[],claims:[],assumptions:[],questions:[],decisions:[]});
        const plural={source:'sources',claim:'claims',assumption:'assumptions',question:'questions',decision:'decisions'}[kind];let item=structuredClone(action[kind]);
        if(kind==='source')item=recordContextSource(root,item);
        assertID(item?.id);if(ledger[plural].some(x=>x.id===item.id))throw new Error(`Discovery ${kind} duplicado: ${item.id}`);
        ledger[plural].push(item);changes.push(`${kind} ${item.id} registrado`);break;
      }
      case 'discovery.assumption.resolve': {
        keys(action,['type','assumptionId','status','sourceIds','resolution']);const a=candidate.discovery?.assumptions.find(x=>x.id===action.assumptionId);if(!a)throw new Error('Supuesto inexistente');if(!['validated','rejected'].includes(action.status))throw new Error('Resolución inválida');a.status=action.status;a.sourceIds=list(action.sourceIds||[],'sourceIds',50);if(!a.sourceIds.length)throw new Error('Resolver supuesto requiere fuentes');if(action.status==='rejected')a.resolution=text(action.resolution,'resolution',{max:2000});else if(action.resolution!==undefined)a.resolution=text(action.resolution,'resolution',{max:2000});changes.push(`supuesto ${a.id} ${a.status}`);break;
      }
      case 'discovery.question.answer': {
        keys(action,['type','questionId','answer']);const q=candidate.discovery?.questions.find(x=>x.id===action.questionId);if(!q)throw new Error('Pregunta inexistente');const answer=structuredClone(action.answer);if(q.answer&&!sameRecord(q.answer,answer))throw new Error(`Respuesta de ${q.id} es inmutable; registre nueva pregunta y decisión.supersede con motivo`);q.answer=answer;changes.push(`pregunta ${q.id} respondida`);break;
      }
      case 'discovery.decision.supersede': {
        keys(action,['type','decisionId','replacement','reason']);const prior=candidate.discovery?.decisions.find(x=>x.id===action.decisionId);if(!prior)throw new Error('Decisión inexistente');if(prior.status==='superseded')throw new Error(`Decisión ${prior.id} ya fue sustituida`);const replacement=structuredClone(action.replacement);assertID(replacement?.id);if(candidate.discovery.decisions.some(x=>x.id===replacement.id)||replacement.id===prior.id)throw new Error('ID de decisión de reemplazo duplicado');if(replacement.status!=='confirmed'||!replacement.confirmedAt||!['user_reported','project_owner_reported'].includes(replacement.confirmedBy))throw new Error('La decisión de reemplazo requiere confirmación humana reportada');const reason=text(action.reason,'reason',{max:1000});prior.supersededBy=replacement.id;prior.supersessionReason=reason;prior.supersededFrom=prior.status;prior.status='superseded';replacement.supersedes=prior.id;replacement.supersessionReason=reason;candidate.discovery.decisions.push(replacement);
        // Both sides matter: a replacement may narrow or widen the old decision's scope.
        // Preserve historical evidence, but remove it from current acceptance and reset dependants.
        const global=[prior,replacement].some(d=>!(d.taskIds?.length||d.criterionIds?.length));
        const criterionIds=global?candidate.objective.criteria.map(c=>c.id):[...new Set([...(prior.criterionIds||[]),...(replacement.criterionIds||[])])];
        const taskIds=global?candidate.tasks.map(t=>t.id):[...new Set([...(prior.taskIds||[]),...(replacement.taskIds||[])])];
        for(const criterion of candidate.objective.criteria)if(criterionIds.includes(criterion.id))criterion.contractRevision=(criterion.contractRevision||1)+1;
        invalidateContracts(candidate,{criterionIds,taskIds},`Decisión ${prior.id} sustituida por ${replacement.id}: ${reason}`);
        changes.push(`decisión ${prior.id} sustituida por ${replacement.id}`);break;
      }
      case 'shipping.intent.record': {
        keys(action,['type','intent']);const s=candidate.shipping||(candidate.shipping={schemaVersion:1,intents:[],receipts:[]}),intent=structuredClone(action.intent);assertSchema('shipping-intent-input',intent);assertID(intent?.id);if(s.intents.some(x=>x.id===intent.id))throw new Error(`Intent duplicado: ${intent.id}`);if(intent.status!=='previewed'||intent.approval!==undefined)throw new Error('Intent debe ser previewed y no puede incluir aprobación');if(intent.actions.some((a,i)=>['create_commit','push_branch','create_pr'].indexOf(a)<(i?['create_commit','push_branch','create_pr'].indexOf(intent.actions[i-1]):-1))||new Set(intent.actions).size!==intent.actions.length)throw new Error('Acciones Ship duplicadas o fuera de orden');intent.sourceWorkRevision=work.revision;intent.workContractSha256=workContractDigest(candidate);intent.completedActions=[];intent.checkpointHeadSha=intent.headSha;intent.checkpointSnapshotSha256=intent.snapshotSha256;s.intents.push(intent);changes.push(`preview Ship ${intent.id} registrado`);break;
      }
      case 'shipping.approval.record': {
        keys(action,['type','intentId','snapshotSha256','actions','approvedAt']);assertSchema('shipping-approval',{intentId:action.intentId,snapshotSha256:action.snapshotSha256,actions:action.actions,approvedAt:action.approvedAt});const intent=candidate.shipping?.intents.find(x=>x.id===action.intentId),prior=work.shipping?.intents.find(x=>x.id===action.intentId);if(['approved','completed'].includes(intent?.status)&&intent.approval?.snapshotSha256===action.snapshotSha256&&sameRecord(intent.approval.actions,action.actions)){changes.push(`aprobación ya registrada para ${intent.id}`);break;}if(!intent||intent.status!=='previewed'||!prior||prior.status!=='previewed')throw new Error('Solo se aprueba un intent previewed persistido antes de esta revisión');if(intent.workContractSha256!==workContractDigest(candidate))throw new Error('Contrato de Work cambió desde el preview');const ordered=intent.actions.filter(x=>action.actions?.includes(x));if(action.snapshotSha256!==intent.snapshotSha256||!Array.isArray(action.actions)||!action.actions.length||new Set(action.actions).size!==action.actions.length||JSON.stringify(ordered)!==JSON.stringify(action.actions)||action.actions.some(x=>!intent.actions.includes(x)))throw new Error('Aprobación no coincide con el preview/orden de acciones');intent.approval={status:'user_reported',approvedAt:action.approvedAt,snapshotSha256:action.snapshotSha256,actions:[...action.actions]};intent.status='approved';changes.push(`aprobación reportada para ${intent.id}`);break;
      }
      case 'shipping.intent.invalidate': {
        keys(action,['type','intentId','reason']);const intent=candidate.shipping?.intents.find(x=>x.id===action.intentId);if(!intent)throw new Error('Intent inexistente');intent.status='invalidated';intent.invalidationReason=text(action.reason,'reason',{max:1000});changes.push(`intent ${intent.id} invalidado`);break;
      }
      case 'shipping.receipt.record': {
        keys(action,['type','receipt']);const s=candidate.shipping||(candidate.shipping={schemaVersion:1,intents:[],receipts:[]}),receipt=structuredClone(action.receipt);receipt.schemaVersion=receipt.schemaVersion||1;assertSchema('shipping-receipt',receipt);assertID(receipt?.id);if(s.receipts.some(x=>x.id===receipt.id))throw new Error(`Receipt duplicado: ${receipt.id}`);const intent=s.intents.find(x=>x.id===receipt.intentId),prior=work.shipping?.intents.find(x=>x.id===receipt.intentId);if(!intent?.approval||!['approved','completed'].includes(prior?.status)||intent.workContractSha256!==workContractDigest(candidate)||!intent.approval.actions.includes(receipt.action)||intent.approval.snapshotSha256!==receipt.snapshotSha256)throw new Error('Receipt no corresponde a una aprobación vigente anterior a esta revisión');const approved=intent.approval.actions,next=approved.find(a=>!intent.completedActions.includes(a));if(receipt.action!==next)throw new Error(`Acción Ship fuera de secuencia; siguiente=${next||'ninguna'}`);if(receipt.contentSha256!==intent.contentSha256||receipt.beforeHeadSha!==intent.checkpointHeadSha||receipt.beforeSnapshotSha256!==intent.checkpointSnapshotSha256)throw new Error('Receipt no continúa el checkpoint/contenido aprobado');if(receipt.action==='create_commit'&&receipt.status==='succeeded'&&receipt.afterHeadSha===receipt.beforeHeadSha)throw new Error('create_commit requiere nuevo HEAD');if(receipt.action!=='create_commit'&&receipt.afterHeadSha!==receipt.beforeHeadSha)throw new Error(`${receipt.action} no puede cambiar HEAD aprobado`);if(receipt.action==='push_branch'&&receipt.status==='succeeded'&&receipt.pushedBranch!==intent.branch)throw new Error('push_branch debe observar la branch aprobada');if(receipt.action==='create_pr'&&receipt.status==='succeeded'&&!receipt.prUrl)throw new Error('create_pr requiere URL de PR observada');if(receipt.status==='succeeded'){intent.checkpointHeadSha=receipt.afterHeadSha;intent.checkpointSnapshotSha256=receipt.observedSnapshotSha256;intent.completedActions.push(receipt.action);if(intent.completedActions.length===approved.length)intent.status='completed';}s.receipts.push(receipt);changes.push(`observación Ship ${receipt.id} registrada`);break;
      }
      default: throw new Error(`Acción no admitida: ${action.type}`);
    }
  }
  if(candidate.shipping)for(const intent of candidate.shipping.intents)if(['previewed','approved'].includes(intent.status)&&intent.workContractSha256!==workContractDigest(candidate)){intent.status='invalidated';intent.invalidationReason='Cambió el contrato del Work desde el preview/aprobación';}
  const shippingOnly=actions.every(action=>typeof action?.type==='string'&&action.type.startsWith('shipping.'));
  if(sameRecord(candidate,work))return workReceipt(work,{changes});
  const saved=work.status==='done'&&shippingOnly?saveShippingMetadata(root,candidate,expectedRevision):saveWork(root,candidate,expectedRevision);
  return workReceipt(saved,{changes});
}

export function closeWorkOperation(root,{workId,expectedRevision,outcome='done',summary,limitations=[]}) {
  assertID(workId);const current=readWork(root,workId,{files:false});
  if(current.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${current.revision}. Releer y reconciliar, no sobrescribir.`);
  const closed=closeWork(root,workId,{outcome,summary:text(summary,'summary'),limitations:list(limitations,'limitations',30)});
  return workReceipt(closed,{operation:'work.close',changes:[outcome==='done'?'trabajo cerrado':'trabajo cancelado']});
}

export function reopenWorkOperation(root,{workId,expectedRevision,reason}) {
  assertID(workId);const current=readWork(root,workId,{files:false});
  if(current.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${current.revision}. Releer y reconciliar, no sobrescribir.`);
  const opened=reopenWork(root,workId,text(reason,'reason'));
  return workReceipt(opened,{operation:'work.reopen',changes:['trabajo reabierto']});
}

export function readStatus(root){return status(root);}
export function readHistory(root,{workId,since,until,limit=20}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('limit debe estar entre 1 y 100');
  const validDate=value=>value===undefined||typeof value==='string'&&Number.isFinite(Date.parse(value));
  if(!validDate(since)||!validDate(until))throw new Error('since/until debe ser fecha ISO válida');
  const entries=history(root).filter(e=>(!workId||e.workId===workId)&&(!since||Date.parse(e.closedAt)>=Date.parse(since))&&(!until||Date.parse(e.closedAt)<=Date.parse(until)));
  return entries.slice(-limit).reverse();
}
export function validateWorkspace(root,{fresh=false}={}){return validateProject(root,{fresh});}
export function completeMapOperation(root,{workId,expectedRevision,summary,limitations=[]}){
  const current=readWork(root,workId,{files:false});
  if(!Number.isSafeInteger(expectedRevision)||current.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${current.revision}. Releer y reconciliar, no sobrescribir.`);
  return completeProjectMap(root,{workId,expectedRevision,summary:text(summary,'summary'),limitations:list(limitations,'limitations',30)});
}
