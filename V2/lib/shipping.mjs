/** Pure shipping preview and argv planning. This module never runs Git/gh or reads artifacts. */
import {createHash} from 'node:crypto';
import {compareShippingSnapshot,deriveWorkReadiness,workContractDigest,evidenceBindingsCurrent} from './contracts.mjs';

export {compareShippingSnapshot};

const ACTIONS=['create_commit','push_branch','create_pr'];
const PUB=new Set(['shipping','delivery']);
const PRIVATE=/^(?:\.env(?:\.|$)|.*\/(?:\.env(?:\.|$)|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?))$/i;
const HEX=/^[a-f0-9]{40,64}$/;
const HASH=/^[a-f0-9]{64}$/;
const sha=s=>createHash('sha256').update(s).digest('hex');
const stable=v=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`:JSON.stringify(v);
const sortUnique=a=>[...new Set(a)].sort();
const cleanPath=p=>typeof p==='string'&&p.length>0&&p.length<=1000&&!/[\x00-\x1f]/.test(p)&&!p.includes('\\')&&!p.startsWith('/')&&!/^[A-Za-z]:/.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..')&&!/[?*\[\]{}!]/.test(p);
const cleanBranch=b=>typeof b==='string'&&b.length<=300&&!/[\x00-\x20~^:?*\[\\]/.test(b)&&!b.startsWith('-')&&!b.startsWith('.')&&!b.endsWith('.')&&!b.endsWith('/')&&!b.includes('..')&&!b.includes('@{')&&!b.split('/').some(x=>!x||x.startsWith('.')||x.endsWith('.lock'));
const inScope=(p,s)=>p===s||p.startsWith(`${s.replace(/\/$/,'')}/`);
const bookkeeping=id=>new Set([`.sol/work/${id}/work.json`,'.sol/state.json','.sol/history.jsonl']);
function bad(reason){return {ready:false,reasons:[reason]};}

/** Canonical digests shared by the readonly Git provider and this planner. Inputs are observed facts, never caller assertions. */
export function computeShippingSnapshot({gitSnapshot,work,request,workScope,expectedPaths,evidenceIds,includedCommitShas}={}){
  if(!gitSnapshot||!work||!request)throw new TypeError('gitSnapshot, work y request son requeridos');
  const expected=new Set(request.expectedPaths||[]);
  const files=(gitSnapshot.files||[]).filter(f=>!bookkeeping(work.id).has(f.path)&&(expected.has(f.path)||f.staged||f.unstaged||f.untracked)).map(f=>({path:f.path,sha256:f.sha256,staged:!!f.staged,unstaged:!!f.unstaged,untracked:!!f.untracked,ignored:!!f.ignored})).sort((a,b)=>a.path.localeCompare(b.path));
  const contentSha256=sha(stable(files.map(({path,sha256})=>({path,sha256}))));
  const diffSha256=gitSnapshot.diffSha256;
  const included=sortUnique(includedCommitShas||[]);
  const relevant={repository:gitSnapshot.repository,remote:gitSnapshot.remote,branch:gitSnapshot.branch,base:gitSnapshot.base,baseSha:gitSnapshot.baseSha,headSha:gitSnapshot.headSha,diffSha256,contentSha256,files,stagedPaths:sortUnique(files.filter(f=>f.staged).map(f=>f.path)),unstagedPaths:sortUnique(files.filter(f=>f.unstaged).map(f=>f.path)),untrackedPaths:sortUnique(files.filter(f=>f.untracked).map(f=>f.path)),includedCommitShas:included,workContractSha256:workContractDigest(work),title:request.title,body:request.body,commitMessage:request.commitMessage,actions:request.actions,workScope:sortUnique(workScope||[]),expectedPaths:sortUnique(expectedPaths||[]),evidenceIds:sortUnique(evidenceIds||[])};
  return {...relevant,snapshotSha256:sha(stable(relevant))};
}

function validateEvidence(work,gitSnapshot,blockers){
  const evidence=new Map((work.evidence||[]).map(e=>[e.id,e]));
  const observed=gitSnapshot.evidenceFiles;
  const current=e=>{
    if(!e.contractBindings||!evidenceBindingsCurrent(work,e))return false;
    if(!Array.isArray(e.files)||!e.files.length)return e.kind==='manual'&&gitSnapshot.manualEvidenceVerified?.includes(e.id);
    if(!observed||gitSnapshot.evidenceFilesComplete!==true)return false;
    const map=new Map(Array.isArray(observed)?observed.map(f=>[f.path,f.sha256]):Object.entries(observed));
    return e.files.every(f=>map.get(f.path)===f.sha256);
  };
  const suitable=(e,criterionId,taskId)=>e&&e.status==='pass'&&e.kind!=='not_run'&&(!criterionId||e.criterionIds?.includes(criterionId))&&(!taskId||e.taskIds?.includes(taskId))&&current(e);
  const criteria=work.objective?.criteria||[];
  for(const c of criteria){if(!(c.evidenceIds||[]).some(id=>suitable(evidence.get(id),c.id)))blockers.push(`Criterio ${c.id}: falta evidencia positiva, vigente, vinculada al contrato y comprobable ahora.`);}
  const tasks=work.tasks||[],byId=new Map(tasks.map(t=>[t.id,t]));
  for(const t of tasks.filter(t=>!PUB.has(t.kind||'implementation')&&t.status==='done')){
    for(const c of t.criterionIds||[])if(!(t.evidenceIds||[]).some(id=>suitable(evidence.get(id),c,t.id)))blockers.push(`Tarea ${t.id}: falta evidencia positiva y vigente para ${c}.`);
  }
  return {suitable,byId};
}

function validateTasks(work,blockers){
  const tasks=work.tasks||[],ids=new Set(tasks.map(t=>t.id)),pub=tasks.filter(t=>PUB.has(t.kind));
  if(!tasks.length)blockers.push('El Work no tiene tareas clasificadas; no se puede demostrar que los prerrequisitos estén completos.');
  const visiting=new Set(),visited=new Set();
  function visit(t){if(visiting.has(t.id)){blockers.push(`Ciclo de dependencias en ${t.id}.`);return;}if(visited.has(t.id))return;visiting.add(t.id);for(const dep of t.dependsOn||[]){const d=tasks.find(x=>x.id===dep);if(!d){blockers.push(`Dependencia inexistente ${dep}.`);continue;}visit(d);if(d.status!=='done')blockers.push(`Prerrequisito ${dep} de ${t.id} no está done.`);}visiting.delete(t.id);visited.add(t.id);}
  tasks.forEach(visit);
  for(const t of tasks)if(!PUB.has(t.kind||'implementation')&&t.status!=='done'&&t.status!=='cancelled')blockers.push(`Prerrequisito ${t.id} (${t.kind||'implementation'}) no está done.`);
  if(!pub.length)blockers.push('El Work no contiene tarea shipping/delivery que ancle esta publicación.');
  const readiness=deriveWorkReadiness(work);
  if(!readiness.implementationReady)blockers.push(...readiness.implementationReasons);
  return pub;
}

function validateSnapshot(g,request,blockers){
  if(!g||g.complete!==true)blockers.push('Snapshot Git readonly ausente o incompleto.');
  if(g?.filesComplete!==true)blockers.push('Proveedor no acreditó enumeración completa de paths staged/unstaged/untracked/ignored.');
  if(g?.rootVerified!==true||g?.pathSafetyVerified!==true)blockers.push('Proveedor no acreditó root Git/workspace canónico y validación de symlinks/rutas.');
  if(g?.targetResolved!==true)blockers.push('Proveedor no acreditó resolución única del remote y base reales.');
  if(g?.detached||!g?.branch)blockers.push('HEAD detached o branch actual no resuelto.');
  for(const key of ['repository','remote','base','headSha','baseSha','diffSha256'])if(typeof g?.[key]!=='string'||!g[key])blockers.push(`Snapshot Git carece de ${key}.`);
  if(g?.headSha&&!HEX.test(g.headSha))blockers.push('HEAD SHA inválido.');
  if(g?.baseSha&&!HEX.test(g.baseSha))blockers.push('Base SHA inválido.');
  if(g?.diffSha256&&!HASH.test(g.diffSha256))blockers.push('diffSha256 inválido.');
  if(!cleanBranch(g?.branch)||!cleanBranch(g?.base))blockers.push('Branch/base inválido o inseguro.');
  if(request.repository!==g?.repository||request.remote!==g?.remote||request.branch!==g?.branch||request.base!==g?.base)blockers.push('Destino solicitado no coincide exactamente con repository/remote/branch/base observados.');
  if(request.actions?.includes('create_pr')&&(!g?.headRepository||g.headRepository!==request.repository))blockers.push('Pull request entre repositorios/fork o head remoto no resuelto: no se puede construir un --head inequívoco.');
  if(!Array.isArray(g?.files))blockers.push('Snapshot debe enumerar todos los archivos afectados.');
  else for(const f of g.files){if(!f||typeof f!=='object'||!cleanPath(f.path)||!HASH.test(f.sha256||''))blockers.push(`Path/hash Git inválido: ${String(f?.path).slice(0,120)}.`);}
  if(!Array.isArray(g?.localCommits))blockers.push('No se observó la lista completa de commits locales pendientes.');
}

export function buildShippingPreflight({work,expectedRevision,gitSnapshot,request}={}){
  const blockers=[];
  if(!work||typeof work!=='object')return {schemaVersion:1,workId:null,expectedRevision,intent:null,blockers:['Work ausente o inválido.'],argvPreview:[]};
  const workId=work.id;
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(workId||''))blockers.push('ID de Work inválido.');
  if(!work.objective||!Array.isArray(work.objective.criteria)||!Array.isArray(work.tasks)||!Array.isArray(work.evidence))return {schemaVersion:1,workId,expectedRevision,intent:null,blockers:['Work incompleto: faltan objective.criteria/tasks/evidence.'],warnings:[],argvPreview:[]};
  if(work.objective.criteria.some(c=>!c||typeof c.id!=='string'||!Array.isArray(c.evidenceIds))||work.tasks.some(t=>!t||typeof t.id!=='string'||!Array.isArray(t.criterionIds)||!Array.isArray(t.dependsOn)||!Array.isArray(t.writeScope)||!Array.isArray(t.evidenceIds))||work.evidence.some(e=>!e||typeof e.id!=='string'||!Array.isArray(e.criterionIds)||!Array.isArray(e.taskIds)||!Array.isArray(e.files)))return {schemaVersion:1,workId,expectedRevision,intent:null,blockers:['Work malformado: las referencias estructurales no son arrays válidos.'],warnings:[],argvPreview:[]};
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||work.revision!==expectedRevision)blockers.push(`Revisión obsoleta: expectedRevision=${expectedRevision}, Work=${work.revision}.`);
  if(work.status==='cancelled')blockers.push('No se puede publicar un Work cancelado.');
  if(!work.shipping||work.shipping.schemaVersion!==1||!Array.isArray(work.shipping.intents)||!Array.isArray(work.shipping.receipts))blockers.push('Metadata shipping del Work ausente o malformada.');
  if(!request||typeof request!=='object')blockers.push('Solicitud explícita ausente.');
  const req=request||{};
  const actions=req.actions;
  if(!Array.isArray(actions)||!actions.length||actions.some((a,i)=>!ACTIONS.includes(a)||actions.indexOf(a)!==i)||actions.some((a,i)=>ACTIONS.indexOf(a)!==i))blockers.push('actions debe ser una secuencia única y ordenada de acciones shipping permitidas.');
  for(const key of ['repository','remote','branch','base','title','commitMessage'])if(typeof req[key]!=='string'||!req[key].trim())blockers.push(`Solicitud sin ${key} explícito.`);
  if(typeof req.body!=='string')blockers.push('Solicitud sin body explícito (puede ser cadena vacía).');
  if(req.repository&&!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(req.repository))blockers.push('repository debe ser owner/repo explícito, sin URL ni credenciales.');
  if(req.id!==undefined&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(req.id))blockers.push('ID de intent inválido.');
  if(typeof req.title==='string'&&req.title.length>300||typeof req.body==='string'&&req.body.length>10000||typeof req.commitMessage==='string'&&req.commitMessage.length>1000||typeof req.remote==='string'&&!/^[A-Za-z0-9_.-]{1,200}$/.test(req.remote))blockers.push('Título/body/commitMessage/remote excede formato o límite del contrato.');
  validateSnapshot(gitSnapshot,req,blockers);
  const pub=validateTasks(work,blockers);
  const evidence=validateEvidence(work,gitSnapshot||{},blockers);
  const scope=sortUnique(work.tasks.filter(t=>t.status==='done'||PUB.has(t.kind)).flatMap(t=>t.writeScope||[]));
  if(!scope.length)blockers.push('Las tareas shipping/delivery no definen writeScope.');
  if(scope.length>100)blockers.push('writeScope excede el límite del contrato.');
  for(const p of scope)if(!cleanPath(p))blockers.push(`writeScope inseguro o no normalizado: ${String(p).slice(0,120)}.`);
  const expected=req.expectedPaths;
  if(!Array.isArray(expected)||!expected.length||expected.length>500||expected.some(p=>!cleanPath(p))||new Set(expected).size!==expected.length)blockers.push('expectedPaths debe enumerar explícitamente hasta 500 paths únicos, relativos y normalizados.');
  const expectedPaths=Array.isArray(expected)?sortUnique(expected):[];
  for(const p of expectedPaths)if(!scope.some(s=>cleanPath(s)&&inScope(p,s)))blockers.push(`Path fuera del writeScope: ${p}.`);
  const bookkeepingPaths=bookkeeping(workId||'');
  for(const p of expectedPaths)if(bookkeepingPaths.has(p))blockers.push(`Path mutable de bookkeeping Sol no se puede incluir: ${p}; use export inmutable separado.`);
  for(const p of expectedPaths)if(PRIVATE.test(p)&&!/(?:^|\/)(?:\.env\.(?:example|sample|template)|credentials\.example)$/i.test(p))blockers.push(`Path sensible bloqueado por defecto: ${p}.`);
  const files=Array.isArray(gitSnapshot?.files)?gitSnapshot.files:[];
  if(new Set(files.map(f=>f?.path)).size!==files.length)blockers.push('Snapshot Git contiene paths duplicados.');
  const changed=sortUnique(files.filter(f=>f&&(f.staged||f.unstaged||f.untracked)).filter(f=>!bookkeepingPaths.has(f.path)).map(f=>f.path));
  if(actions?.includes('create_pr')&&changed.length&&(!actions.includes('create_commit')||!actions.includes('push_branch')))blockers.push('PR con cambios locales requiere secuencia explícita create_commit→push_branch→create_pr.');
  if(actions?.includes('create_pr')&&(gitSnapshot?.localCommits||[]).length&&!actions.includes('push_branch'))blockers.push('PR con commits locales no publicados requiere push_branch antes de create_pr.');
  if(stable(changed)!==stable(expectedPaths))blockers.push('expectedPaths no coincide exactamente con los paths staged/unstaged/untracked observados (excluido bookkeeping local reconocido).');
  for(const f of files)if(f&&(f.staged||f.unstaged||f.untracked)&&!bookkeepingPaths.has(f.path)&&!expectedPaths.includes(f.path))blockers.push(`Cambio fuera del alcance aprobado: ${f.path}.`);
  for(const f of files)if(f?.staged&&bookkeepingPaths.has(f.path))blockers.push(`Bookkeeping Sol staged requiere resolución separada: ${f.path}.`);
  const local=(gitSnapshot?.localCommits||[]).map(c=>typeof c==='string'?c:c?.sha);
  if(new Set(local).size!==local.length)blockers.push('Snapshot contiene commits locales duplicados.');
  if(local.some(s=>!HEX.test(s||'')))blockers.push('Lista de commits locales contiene SHA inválido.');
  const included=req.includedCommitShas;
  if(!Array.isArray(included)||new Set(included).size!==included.length||included.some(s=>!HEX.test(s||''))||stable(sortUnique(included))!==stable(sortUnique(local)))blockers.push('includedCommitShas debe declarar exactamente todos los commits locales no publicados observados.');
  for(const p of expectedPaths){const f=files.find(x=>x?.path===p);if(!f)blockers.push(`Path esperado no aparece en snapshot: ${p}.`);}
  for(const p of expectedPaths)if(files.find(f=>f?.path===p)?.ignored)blockers.push(`Path ignorado no se puede agregar sin force: ${p}.`);
  const evidenceIds=sortUnique([
    ...(work.objective?.criteria||[]).flatMap(c=>(c.evidenceIds||[]).filter(id=>{const e=(work.evidence||[]).find(x=>x.id===id);return e&&evidence.suitable?.(e,c.id);})),
    ...(work.tasks||[]).filter(t=>t.status==='done').flatMap(t=>(t.evidenceIds||[]).filter(id=>{const e=(work.evidence||[]).find(x=>x.id===id);return e&&evidence.suitable?.(e,undefined,t.id);}))
  ]);
  if(evidenceIds.length>100||included?.length>100||actions?.length>3)blockers.push('evidenceIds/includedCommitShas/actions excede límite de schema.');
  const now=gitSnapshot?.observedAt;
  if(typeof now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(now)||!Number.isFinite(Date.parse(now)))blockers.push('Snapshot no proporciona observedAt válido.');
  const intent=blockers.length?null:{schemaVersion:1,id:req.id||`ship-${sha(stable([work.id,expectedRevision,gitSnapshot.headSha])).slice(0,32)}`,createdAt:now,repository:req.repository,branch:req.branch,remote:req.remote,base:req.base,title:req.title,body:req.body,commitMessage:req.commitMessage,headSha:gitSnapshot.headSha,diffSha256:gitSnapshot.diffSha256,contentSha256:'',snapshotSha256:'',workScope:scope,expectedPaths,evidenceIds,includedCommitShas:sortUnique(included),actions,status:'previewed'};
  if(intent){const snap=computeShippingSnapshot({gitSnapshot,work,request:req,workScope:scope,expectedPaths,evidenceIds,includedCommitShas:included});intent.contentSha256=snap.contentSha256;intent.snapshotSha256=snap.snapshotSha256;}
  const argvPreview=intent?actions.flatMap(a=>buildShippingArgv(intent,a,{preview:true})):[];
  const warnings=files.filter(f=>f&&bookkeepingPaths.has(f.path)&&(f.unstaged||f.untracked||f.ignored)).map(f=>`Bookkeeping Sol local fuera del contenido aprobado: ${f.path}.`);
  return {schemaVersion:1,workId,expectedRevision,intent,blockers:[...new Set(blockers)],warnings:[...new Set(warnings)],argvPreview};
}

export function buildShippingArgv(intent,action,{preview=false,receipts=[],currentSnapshot,currentWork,expectedWorkId,expectedRevision}={}){
  if(!intent||!ACTIONS.includes(action)||!intent.actions?.includes(action))throw new Error('Acción no aprobada en el intent.');
  if(!cleanBranch(intent.branch)||!cleanBranch(intent.base)||!/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(intent.repository||'')||typeof intent.remote!=='string'||! /^[A-Za-z0-9_.-]{1,200}$/.test(intent.remote))throw new Error('Destino shipping incompleto o inseguro.');
  if(!preview){
    if(intent.status!=='approved'||intent.approval?.status!=='user_reported'||intent.approval.snapshotSha256!==intent.snapshotSha256||!intent.approval.actions?.includes(action))throw new Error('Falta aprobación activa coincidente; el planner no constituye autorización.');
    if(!currentWork||!Number.isSafeInteger(expectedRevision)||currentWork.revision!==expectedRevision||currentWork.id!==expectedWorkId||!Number.isSafeInteger(intent.sourceWorkRevision)||intent.sourceWorkRevision>expectedRevision)throw new Error('Work/revisión actual ausente o desactualizado.');
    if(currentWork.status==='cancelled'||workContractDigest(currentWork)!==intent.workContractSha256)throw new Error('Contrato del Work cambió o Work cancelado.');
    const last=receipts.filter(r=>r.intentId===intent.id).at(-1);
    if(receipts.some(r=>r.intentId===intent.id&&r.action===action&&r.status==='succeeded'))throw new Error('La acción ya tiene receipt exitoso.');
    let compareIntent=intent;
    if(last&&last.status!=='succeeded'){
      if(last.action!==action||currentSnapshot?.headSha!==last.beforeHeadSha)throw new Error('Operación previa fallida: solo se reintenta la misma acción sin avance inesperado de HEAD.');
      if(!HASH.test(last.observedSnapshotSha256||''))throw new Error('Receipt fallido sin snapshot observado; requiere reconciliación readonly.');
      compareIntent={...intent,checkpointHeadSha:last.beforeHeadSha,checkpointSnapshotSha256:last.observedSnapshotSha256,diffSha256:currentSnapshot.diffSha256};
    }
    if(!currentSnapshot||!compareShippingSnapshot(compareIntent,currentSnapshot,{receipts}).matches)throw new Error('Snapshot actual no coincide con el intent/checkpoint aprobado.');
    const completed=new Set((intent.completedActions||[]));
    if(completed.has(action))throw new Error('La acción ya consta completada.');
    const earlier=intent.actions.slice(0,intent.actions.indexOf(action));
    if(earlier.some(x=>!completed.has(x)||!receipts.some(r=>r.intentId===intent.id&&r.action===x&&r.status==='succeeded')))throw new Error('La acción anterior de la secuencia aún no tiene checkpoint exitoso.');
    if(last&&last.status!=='succeeded'&&last.action!==action)throw new Error('Hay una operación previa fallida/blocked: solo puede reintentarse esa misma acción.');
  }
  if(action==='create_commit'){
    const paths=intent.expectedPaths||[];
    if(!paths.length||paths.some(p=>!cleanPath(p)))throw new Error('Paths de commit vacíos o inseguros.');
    return [['git','--literal-pathspecs','add','--',...paths],['git','commit','-m',intent.commitMessage]];
  }
  if(action==='push_branch')return [['git','push','--porcelain',intent.remote,`refs/heads/${intent.branch}:refs/heads/${intent.branch}`]];
  if(action==='create_pr')return [['gh','pr','create','--repo',intent.repository,'--base',intent.base,'--head',intent.branch,'--title',intent.title,'--body',intent.body]];
  throw new Error('Acción no soportada.');
}
