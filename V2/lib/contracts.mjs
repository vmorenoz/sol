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
  const decisions=[
    ...(discovery.decisions||[]).filter(d=>d.status==='confirmed').map(d=>({id:d.id,questionIds:[...(d.questionIds||[])].sort(),statement:d.statement,rationale:d.rationale,status:d.status,confirmedBy:d.confirmedBy,supersedes:d.supersedes})),
    ...(discovery.questions||[]).filter(q=>(q.resolutionKind||'human_decision')==='human_decision'&&q.answer?.kind==='user_reported').map(q=>({id:`${q.id}:answer`,questionIds:[q.id],statement:q.answer.text,status:'confirmed',confirmedBy:'user_reported'})),
    ...(discovery.assumptions||[]).filter(a=>a.impact==='material'&&['validated','rejected'].includes(a.status)).map(a=>({id:`${a.id}:assumption`,statement:a.statement,status:a.status,resolution:a.resolution||''}))
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
export function deriveWorkReadiness(work){
  const implementationReasons=[],completionReasons=[],discovery=work.discovery;
  if(discovery){
    const decisionById=new Map((discovery.decisions||[]).map(d=>[d.id,d]));
    for(const q of discovery.questions||[])if(q.impact==='material'){
      const resolutionKind=q.resolutionKind||'human_decision',answer=q.answer;
      let linkedDecision=decisionById.get(answer?.decisionId);while(linkedDecision?.status==='superseded')linkedDecision=decisionById.get(linkedDecision.supersededBy);
      if(!linkedDecision)linkedDecision=(discovery.decisions||[]).find(d=>d.status==='confirmed'&&(d.questionIds||[]).includes(q.id));
      const resolved=resolutionKind==='investigation'?Boolean(answer&&answer.kind==='investigated'&&answer.sourceIds?.length):Boolean(answer?.kind==='user_reported'||answer?.kind==='investigated'&&linkedDecision?.status==='confirmed'&&(linkedDecision.questionIds||[]).includes(q.id)&&['user_reported','project_owner_reported'].includes(linkedDecision?.confirmedBy));
      if(!resolved)implementationReasons.push(`Pregunta material sin resolver: ${q.id}`);
    }
    for(const a of discovery.assumptions||[])if(a.impact==='material'&&a.status!=='validated'&&!(a.status==='rejected'&&a.resolution?.trim()&&a.sourceIds?.length))implementationReasons.push(`Supuesto material sin validación o resolución explícita: ${a.id}`);
    for(const d of discovery.decisions||[])if(d.status==='proposed')implementationReasons.push(`Decisión propuesta pendiente: ${d.id}`);
  }
  for(const decision of work.decisionsPending||[])implementationReasons.push(`Decisión pendiente: ${decision}`);
  const implementationTasks=work.tasks.filter(t=>(t.kind||'implementation')==='implementation');
  const implementationReady=implementationReasons.length===0;
  // Unknown discovery is compatible with closing a genuinely classified research/planning-only Work,
  // but an unclassified/empty Work retains the safe historical implementation default.
  const researchKinds=new Set(['research','exploration','specification','planning']);
  const researchOnly=work.tasks.length>0&&work.tasks.every(t=>researchKinds.has(t.kind));
  if(!researchOnly)completionReasons.push(...implementationReasons);
  return {ready:implementationReady,implementationReady,completionReady:completionReasons.length===0,reasons:implementationReasons,implementationReasons,completionReasons,suggestedSkills:implementationReasons.length?['sol-discovery','sol-discuss']:implementationTasks.length?['sol-plan','sol-execute']:['sol-discovery','sol-plan']};
}
