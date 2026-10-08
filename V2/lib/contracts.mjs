import {sha256} from './fs.mjs';

export function criterionContract(criterion){
  return {revision:criterion.contractRevision||1,sha256:sha256(JSON.stringify({id:criterion.id,description:criterion.description,verification:criterion.verification}))};
}
export function taskContract(task){
  const sorted=values=>[...(values||[])].sort();
  return {revision:task.contractRevision||1,sha256:sha256(JSON.stringify({id:task.id,title:task.title,kind:task.kind||'implementation',criterionIds:sorted(task.criterionIds),dependsOn:sorted(task.dependsOn),writeScope:sorted(task.writeScope),resources:sorted(task.resources),acceptance:task.acceptance}))};
}
export function bindEvidence(work,evidence){
  const taskIds=[...new Set(evidence.taskIds||[])].sort(),taskMap=new Map(work.tasks.map(t=>[t.id,t]));
  const explicit=evidence.criterionIds!==undefined;
  const criterionIds=new Set(explicit?evidence.criterionIds:[]);
  if(!explicit){for(const id of taskIds){const task=taskMap.get(id);if(!task)throw new Error(`Tarea inexistente: ${id}`);for(const criterionId of task.criterionIds||[])criterionIds.add(criterionId);}}
  const criteria=[...criterionIds].sort().map(id=>{const c=work.objective.criteria.find(x=>x.id===id);if(!c)throw new Error(`Criterio inexistente: ${id}`);return {id,...criterionContract(c)};});
  const tasks=taskIds.map(id=>{const t=taskMap.get(id);return {id,...taskContract(t)};});
  return {schemaVersion:1,criteria,tasks};
}
export function evidenceBindingsCurrent(work,evidence){
  if(!evidence.contractBindings){
    const explicit=evidence.criterionIds!==undefined;
    const criteria=new Set(explicit?evidence.criterionIds:[]);
    if(!explicit){for(const taskId of evidence.taskIds||[])for(const id of work.tasks.find(t=>t.id===taskId)?.criterionIds||[])criteria.add(id);}
    return [...criteria].every(id=>(work.objective.criteria.find(c=>c.id===id)?.contractRevision||1)===1)&&(evidence.taskIds||[]).every(id=>(work.tasks.find(t=>t.id===id)?.contractRevision||1)===1);
  }
  try{return JSON.stringify(evidence.contractBindings)===JSON.stringify(bindEvidence(work,evidence));}catch{return false;}
}
export function workContractDigest(work){
  const discovery=work.discovery||{};
  const scope=record=>Object.fromEntries(['taskIds','criterionIds'].filter(key=>record[key]?.length).map(key=>[key,[...record[key]].sort()]));
  const decisions=[
    ...(discovery.decisions||[]).filter(d=>d.status==='confirmed').map(d=>({id:d.id,...scope(d),questionIds:[...(d.questionIds||[])].sort(),statement:d.statement,rationale:d.rationale,status:d.status,confirmedBy:d.confirmedBy,supersedes:d.supersedes})),
    ...(discovery.questions||[]).filter(q=>(q.resolutionKind||'human_decision')==='human_decision'&&q.answer?.kind==='user_reported').map(q=>({id:`${q.id}:answer`,...scope(q),questionIds:[q.id],statement:q.answer.text,status:'confirmed',confirmedBy:'user_reported'})),
    ...(discovery.assumptions||[]).filter(a=>a.impact==='material'&&['validated','rejected'].includes(a.status)).map(a=>({id:`${a.id}:assumption`,...scope(a),statement:a.statement,status:a.status,resolution:a.resolution||''}))
  ].sort((a,b)=>a.id.localeCompare(b.id));
  return sha256(JSON.stringify({goal:work.objective.outcome,criteria:work.objective.criteria.map(c=>({id:c.id,...criterionContract(c)})).sort((a,b)=>a.id.localeCompare(b.id)),tasks:work.tasks.map(t=>({id:t.id,...taskContract(t)})).sort((a,b)=>a.id.localeCompare(b.id)),decisions}));
}
export function compareShippingSnapshot(intent,currentSnapshot,{receipts=[]}={}){
  const reasons=[];const successful=receipts.filter(r=>r.intentId===intent.id&&r.status==='succeeded');
  if(intent.status==='invalidated'||intent.status==='cancelled')reasons.push(`intent status ${intent.status}`);
  const checkpoint=successful.at(-1);
  const committed=successful.find(r=>r.action==='create_commit');
  const expectedHead=checkpoint?.afterHeadSha||intent.checkpointHeadSha||intent.headSha;
  const expectedSnapshot=checkpoint?.observedSnapshotSha256||intent.checkpointSnapshotSha256||intent.snapshotSha256;
  if(currentSnapshot.repository!==intent.repository)reasons.push('repository cambió');
  if(currentSnapshot.remote!==intent.remote)reasons.push('remote cambió');
  if(currentSnapshot.branch!==intent.branch)reasons.push('branch cambió');
  if(currentSnapshot.base!==intent.base)reasons.push('base cambió');
  if(currentSnapshot.headSha!==expectedHead)reasons.push('HEAD no coincide con checkpoint autorizado');
  if(currentSnapshot.snapshotSha256!==expectedSnapshot)reasons.push('snapshot no coincide con checkpoint autorizado');
  if(currentSnapshot.contentSha256!==intent.contentSha256)reasons.push('contenido aprobado cambió');
  if(currentSnapshot.workContractSha256!==undefined&&currentSnapshot.workContractSha256!==intent.workContractSha256)reasons.push('contrato del Work cambió');
  for(const key of ['title','body','commitMessage','actions'])if(intent[key]!==undefined&&JSON.stringify(currentSnapshot[key])!==JSON.stringify(intent[key]))reasons.push(`${key} cambió`);
  if(!committed&&currentSnapshot.diffSha256!==intent.diffSha256)reasons.push('diffSha256 cambió antes del commit aprobado');
  for(const key of ['workScope','expectedPaths','evidenceIds'])if(JSON.stringify([...(currentSnapshot[key]||[])].sort())!==JSON.stringify([...(intent[key]||[])].sort()))reasons.push(`${key} cambió`);
  const expectedCommits=[...(intent.includedCommitShas||[]),...(committed?[committed.afterHeadSha]:[])].sort();
  if(JSON.stringify([...(currentSnapshot.includedCommitShas||[])].sort())!==JSON.stringify(expectedCommits))reasons.push('includedCommitShas cambió fuera del commit aprobado');
  return {matches:reasons.length===0,reasons,expected:{headSha:expectedHead,snapshotSha256:expectedSnapshot,contentSha256:intent.contentSha256}};
}
// An absent or empty scope is deliberately global for legacy records.
function uncertaintyApplies(record,taskIds,criterionIds){
  if(!taskIds)return true;
  const tasks=record.taskIds||[],criteria=record.criterionIds||[];
  return (!tasks.length&&!criteria.length)||tasks.some(id=>taskIds.has(id))||criteria.some(id=>criterionIds.has(id));
}
function discoveryReasons(work,{taskIds,criterionIds}={}){
  const reasons=[],discovery=work.discovery;
  if(discovery){
    const decisionById=new Map((discovery.decisions||[]).map(d=>[d.id,d]));
    const sources=new Set((discovery.sources||[]).map(s=>s.id));
    const cited=ids=>Array.isArray(ids)&&ids.length>0&&ids.every(id=>sources.has(id));
    const applicable=record=>uncertaintyApplies(record,taskIds,criterionIds);
    const confirmedDecision=decision=>{
      const seen=new Set();
      while(decision?.status==='superseded'){
        if(seen.has(decision.id))return undefined;
        seen.add(decision.id);
        const next=decisionById.get(decision.supersededBy);
        if(!next||next.supersedes!==decision.id)return undefined;
        decision=next;
      }
      return decision?.status==='confirmed'?decision:undefined;
    };
    for(const q of discovery.questions||[])if(q.impact==='material'&&applicable(q)){
      const resolutionKind=q.resolutionKind||'human_decision',answer=q.answer;
      let linkedDecision=confirmedDecision(decisionById.get(answer?.decisionId));
      if(!linkedDecision)linkedDecision=(discovery.decisions||[]).find(d=>d.status==='confirmed'&&(d.questionIds||[]).includes(q.id));
      const answerSourcesValid=answer&&(answer.sourceIds||[]).every(id=>sources.has(id));
      const resolved=resolutionKind==='investigation'
        ?Boolean(answer?.kind==='investigated'&&cited(answer.sourceIds))
        :Boolean(answerSourcesValid&&(answer.kind==='user_reported'||answer.kind==='investigated'&&linkedDecision?.status==='confirmed'&&(linkedDecision.questionIds||[]).includes(q.id)&&['user_reported','project_owner_reported'].includes(linkedDecision.confirmedBy)));
      if(!resolved)reasons.push(`Pregunta material sin resolver: ${q.id}`);
    }
    for(const a of discovery.assumptions||[])if(a.impact==='material'&&applicable(a)&&!(a.status==='validated'&&cited(a.sourceIds))&&!(a.status==='rejected'&&a.resolution?.trim()&&cited(a.sourceIds)))reasons.push(`Supuesto material sin validación o resolución explícita: ${a.id}`);
    for(const d of discovery.decisions||[])if(d.status==='proposed'&&applicable(d))reasons.push(`Decisión propuesta pendiente: ${d.id}`);
  }
  // Free-text legacy decisions have no safe task-level scope.
  for(const decision of work.decisionsPending||[])reasons.push(`Decisión pendiente: ${decision}`);
  return reasons;
}
export function deriveWorkReadiness(work){
  const implementationReasons=discoveryReasons(work),completionReasons=[];
  const implementationTasks=work.tasks.filter(t=>(t.kind||'implementation')==='implementation');
  const implementationReady=implementationReasons.length===0;
  // Unknown discovery is compatible with closing a genuinely classified research/planning-only Work,
  // but an unclassified/empty Work retains the safe historical implementation default.
  const researchKinds=new Set(['research','exploration','specification','planning']);
  const researchOnly=work.tasks.length>0&&work.tasks.every(t=>researchKinds.has(t.kind));
  if(!researchOnly)completionReasons.push(...implementationReasons);
  return {ready:implementationReady,implementationReady,completionReady:completionReasons.length===0,reasons:implementationReasons,implementationReasons,completionReasons,suggestedSkills:implementationReasons.length?['sol-discovery','sol-discuss']:implementationTasks.length?['sol-plan','sol-execute']:['sol-discovery','sol-plan']};
}
export function deriveTaskReadiness(work,taskId){
  const tasks=new Map(work.tasks.map(task=>[task.id,task])),task=tasks.get(taskId);
  if(!task)throw new Error(`Tarea inexistente: ${taskId}`);
  const relevantTaskIds=new Set(),criterionIds=new Set(),visiting=new Set();
  function visit(id){
    if(visiting.has(id))throw new Error(`Ciclo de dependencias: ${id}`);
    if(relevantTaskIds.has(id))return;
    const current=tasks.get(id);if(!current)throw new Error(`Dependencia inexistente: ${id}`);
    visiting.add(id);
    for(const dependency of current.dependsOn||[])visit(dependency);
    visiting.delete(id);relevantTaskIds.add(id);
    for(const criterionId of current.criterionIds||[])criterionIds.add(criterionId);
  }
  visit(taskId);
  const criteria=new Set(work.objective.criteria.map(c=>c.id));
  for(const record of [...(work.discovery?.questions||[]),...(work.discovery?.assumptions||[]),...(work.discovery?.decisions||[])]){
    for(const id of record.taskIds||[])if(!tasks.has(id))throw new Error(`Discovery referencia tarea inexistente: ${id}`);
    for(const id of record.criterionIds||[])if(!criteria.has(id))throw new Error(`Discovery referencia criterio inexistente: ${id}`);
  }
  const dependencyReasons=[...relevantTaskIds].filter(id=>id!==taskId&&tasks.get(id).status!=='done').map(id=>`Dependencia sin completar: ${id}`);
  const implementationReasons=[...discoveryReasons(work,{taskIds:relevantTaskIds,criterionIds}),...dependencyReasons];
  const reasons=(task.kind||'implementation')==='implementation'?implementationReasons:dependencyReasons;
  return {taskId,ready:reasons.length===0,implementationReady:implementationReasons.length===0,completionReady:reasons.length===0,reasons,implementationReasons,completionReasons:reasons,relevantTaskIds:[...relevantTaskIds].sort(),criterionIds:[...criterionIds].sort(),suggestedSkills:reasons.length?['sol-discovery','sol-plan']:['sol-execute']};
}
