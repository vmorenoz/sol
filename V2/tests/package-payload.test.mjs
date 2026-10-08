import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmpBase=os.tmpdir();
function filesUnder(directory,prefix=''){
  const files=[];
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=prefix?`${prefix}/${entry.name}`:entry.name,target=path.join(directory,entry.name);
    assert.equal(entry.isSymbolicLink(),false,`No se empaquetan symlinks: ${target}`);
    if(entry.isDirectory())files.push(...filesUnder(target,relative));else if(entry.isFile())files.push(relative);
  }
  return files;
}
function run(command,args,options={}){
  const result=spawnSync(command,args,{encoding:'utf8',timeout:120_000,...options});
  assert.equal(result.error,undefined,`${command}: ${result.error?.message}`);
  assert.equal(result.status,0,`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

test('tarball aislado instala sus recursos y ejerce el plugin sobre dos raíces de sesión',async t=>{
  if(!process.allowedNodeEnvironmentFlags.has('--experimental-strip-types'))t.skip('Node no ofrece --experimental-strip-types; no se afirma verificación del plugin TS.');
  fs.mkdirSync(tmpBase,{recursive:true});
  const sandbox=fs.mkdtempSync(path.join(tmpBase,'sol-package-smoke-'));
  t.after(()=>fs.rmSync(sandbox,{recursive:true,force:true}));
  const packDir=path.join(sandbox,'pack'),extractDir=path.join(sandbox,'extract'),home=path.join(sandbox,'home');
  fs.mkdirSync(packDir);fs.mkdirSync(extractDir);
  const packed=run('npm',['pack','--ignore-scripts','--pack-destination',packDir],{cwd:root,env:{...process.env,npm_config_cache:path.join(sandbox,'npm-cache')}});
  const tarball=path.join(packDir,packed.split('\n').at(-1));assert.ok(fs.statSync(tarball).isFile());
  run('tar',['-xzf',tarball,'-C',extractDir]);
  const packageRoot=path.join(extractDir,'package');assert.ok(fs.statSync(packageRoot).isDirectory());

  const {install}=await import(pathToFileURL(path.join(packageRoot,'lib/install.mjs')).href);
  install({homeDir:home,env:{},probeVersion:()=> 'opencode v2.0.20'});
  const packagedSkills=filesUnder(path.join(packageRoot,'skills'));
  for(const relative of packagedSkills)assert.ok(fs.existsSync(path.join(home,'.config/opencode/skills',relative)),`falta skill/recurso instalado ${relative}`);
  for(const relative of ['contracts.mjs','artifacts.mjs','work-mutations.mjs','schema.mjs','fs.mjs','shipping.mjs','shipping-snapshot.mjs','shipping-authority.mjs'])assert.ok(fs.existsSync(path.join(home,'.sol/lib',relative)),relative);
  for(const relative of filesUnder(path.join(packageRoot,'schemas')))assert.ok(fs.existsSync(path.join(home,'.sol/schemas',relative)),relative);
  for(const command of ['sol-init','sol-config'])assert.ok(fs.existsSync(path.join(home,`.config/opencode/commands/${command}.md`)),command);
  for(const skill of ['sol-new-project','sol-onboard','sol-discuss','sol-plan','sol-execute','sol-verify','sol-ship','sol-status','sol-recap','sol-resume']){assert.ok(fs.existsSync(path.join(home,`.config/opencode/skills/${skill}/SKILL.md`)),skill);assert.equal(fs.existsSync(path.join(home,`.config/opencode/commands/${skill}.md`)),false,skill);}

  const projectA=path.join(sandbox,'project-a'),projectB=path.join(sandbox,'project-b');
  fs.mkdirSync(projectA);fs.mkdirSync(projectB);
  const pluginPath=path.join(home,'.config/opencode/plugins/sol/index.ts');
  const child=`
    import fs from 'node:fs';
    import path from 'node:path';
    import {pathToFileURL} from 'node:url';
    import plugin from ${JSON.stringify(pluginPath)};
    const roots={A:process.env.SOL_TEST_A,B:process.env.SOL_TEST_B};
    const registered=new Map();
    const ctx={tool:{transform:async callback=>callback({add:tool=>registered.set(tool.name,tool)})},session:{get:async ({sessionID})=>({location:{directory:roots[sessionID]}})}};
    await plugin.setup(ctx);
    const call=async(name,sessionID,args={})=>registered.get(name).execute(args,{sessionID,signal:new AbortController().signal});
    await call('sol_workspace_prepare','A'); await call('sol_workspace_prepare','B');
    const createdA=await call('sol_work_create','A',{workId:'SAME-ID',title:'Proyecto A',objective:'Resultado A',criterion:'Criterio A',verification:'Verificar A'});
    const createdB=await call('sol_work_create','B',{workId:'SAME-ID',title:'Proyecto B',objective:'Resultado B',criterion:'Criterio B',verification:'Verificar B'});
    const getA=await call('sol_work_get','A',{workId:'SAME-ID'});
    const apply=registered.get('sol_work_apply');
    const input=apply.input;
    const unknown=await call('sol_work_apply','A',{workId:'SAME-ID',expectedRevision:1,actions:[{type:'action.not.real',surprise:true}]});
    const afterUnknown=JSON.parse(fs.readFileSync(roots.A+'/.sol/work/SAME-ID/work.json','utf8'));
    const files=['.sol/work/SAME-ID/work.json','.sol/state.json','.sol/history.jsonl'];
    const beforeApproval=files.map(file=>fs.readFileSync(roots.A+'/'+file,'utf8'));
    const approvalAttempt=await call('sol_work_apply','A',{workId:'SAME-ID',expectedRevision:1,actions:[{type:'work.set_overview',summary:'must roll back'},{type:'shipping.approval.record',intentId:'INTENT-1',snapshotSha256:'d'.repeat(64),actions:['create_commit'],approvedAt:new Date().toISOString(),approvedBy:'user',sessionID:'A'}]});
    const afterApproval=files.map(file=>fs.readFileSync(roots.A+'/'+file,'utf8'));
    const fakeRoot=await call('sol_work_create','A',{workId:'FAKE-ROOT',title:'x',objective:'x',criterion:'x',verification:'x',root:roots.B});
    const fakeRootExists=fs.existsSync(roots.B+'/.sol/work/FAKE-ROOT/work.json');
    const changedA=await call('sol_work_apply','A',{workId:'SAME-ID',expectedRevision:1,actions:[{type:'work.set_overview',summary:'actual A'}]});
    const intent={schemaVersion:1,id:'INTENT-1',createdAt:new Date().toISOString(),repository:'owner/repo',branch:'feat/change',remote:'origin',base:'main',title:'Ship change',body:'Summary',commitMessage:'feat: change',headSha:'a'.repeat(40),diffSha256:'b'.repeat(64),contentSha256:'c'.repeat(64),snapshotSha256:'d'.repeat(64),workScope:['src/value.mjs'],expectedPaths:['src/value.mjs'],evidenceIds:[],includedCommitShas:[],actions:['create_commit'],status:'previewed'};
    const bindingIntent={...intent,approval:{status:'user_reported',snapshotSha256:intent.snapshotSha256,actions:intent.actions,approvedAt:new Date().toISOString(),sessionID:'A'}};
    const fakeBinding=await call('sol_work_apply','A',{workId:'SAME-ID',expectedRevision:2,actions:[{type:'shipping.intent.record',intent:bindingIntent}]});
    const afterFakeBinding=JSON.parse(fs.readFileSync(roots.A+'/.sol/work/SAME-ID/work.json','utf8'));
    const intentRecord=await call('sol_work_apply','A',{workId:'SAME-ID',expectedRevision:2,actions:[{type:'shipping.intent.record',intent}]});
    const {applyWorkMutation}=await import(pathToFileURL(path.join(process.env.HOME,'.sol/lib/work-mutations.mjs')).href);
    applyWorkMutation(roots.A,{workId:'SAME-ID',expectedRevision:3,actions:[{type:'shipping.approval.record',intentId:'INTENT-1',snapshotSha256:intent.snapshotSha256,actions:intent.actions,approvedAt:new Date().toISOString()}]});
    const receipt={schemaVersion:1,id:'RCP-1',intentId:'INTENT-1',observedAt:new Date().toISOString(),action:'create_commit',status:'succeeded',beforeHeadSha:intent.headSha,afterHeadSha:'e'.repeat(40),beforeSnapshotSha256:intent.snapshotSha256,observedSnapshotSha256:'f'.repeat(64),contentSha256:intent.contentSha256,snapshotSha256:intent.snapshotSha256,summary:'Observed only; no Git command executed'};
    const receiptRecord=await call('sol_work_apply','A',{workId:'SAME-ID',expectedRevision:4,actions:[{type:'shipping.receipt.record',receipt}]});
    const deref=(node,schema,seen=new Set())=>{if(!node||typeof node!=='object'||!node.$ref)return node;if(seen.has(node.$ref))throw Error('cyclic schema ref');seen.add(node.$ref);return deref(node.$ref.slice(2).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~')).reduce((v,k)=>v?.[k],schema),schema,seen)};
    const inspectClosed=(node,schema,seen=new Set())=>{node=deref(node,schema);if(!node||typeof node!=='object'||seen.has(node))return true;seen.add(node);if(node.type==='object'&&node.additionalProperties!==false)return false;for(const child of Object.values(node.properties||{}))if(!inspectClosed(child,schema,seen))return false;if(node.items&&!inspectClosed(node.items,schema,seen))return false;for(const keyword of ['anyOf','oneOf'])for(const child of node[keyword]||[])if(!inspectClosed(child,schema,seen))return false;return true};
    const workA=JSON.parse(fs.readFileSync(roots.A+'/.sol/work/SAME-ID/work.json','utf8'));
    const workB=JSON.parse(fs.readFileSync(roots.B+'/.sol/work/SAME-ID/work.json','utf8'));
    const preflightNoRepo=await call('sol_ship_preflight','A',{workId:'SAME-ID',expectedRevision:5,request:{repository:'owner/repo',remote:'origin',branch:'feature',base:'main',title:'Ship',body:'',commitMessage:'Ship',actions:['create_commit'],expectedPaths:['src/value.mjs'],includedCommitShas:[]}});
    const forgedAuthorize=await call('sol_ship_authorize','A',{workId:'SAME-ID',expectedRevision:5,intentId:'INTENT-1',snapshotSha256:'d'.repeat(64),approved:true,root:roots.B,actor:'user'});
    const authorizeInput=registered.get('sol_ship_authorize').input,preflightInput=registered.get('sol_ship_preflight').input;
    const missingSession=await registered.get('sol_status').execute({},{});
     const actionSchema=input.properties.actions.items;
    const union=actionSchema.anyOf||actionSchema.oneOf;
    const actionKinds=union.map(branch=>deref(branch,input).properties?.type?.const);
    const canonical=JSON.parse(fs.readFileSync(path.join(process.env.HOME,'.sol/schemas/work-update.schema.json'),'utf8'));
    const canonicalUnion=canonical.properties.actions.items.anyOf||canonical.properties.actions.items.oneOf;
    const canonicalKinds=canonicalUnion.flatMap(branch=>{const type=branch.properties?.type;return [type?.const,...(type?.enum||[])].filter(value=>typeof value==='string')});
    const taskAdd=union.map(branch=>deref(branch,input)).find(branch=>branch.properties?.type?.const==='task.add');
    const evidenceAdd=union.map(branch=>deref(branch,input)).find(branch=>branch.properties?.type?.const==='evidence.add');
    const schemaClosed=union.every(branch=>inspectClosed(branch,input));
    console.log(JSON.stringify({tools:[...registered.keys()],createdA,createdB,getA,unknown,afterUnknownRevision:afterUnknown.revision,approvalAttempt,beforeApproval,afterApproval,fakeRoot,fakeRootExists,changedA,bindingIntent,fakeBinding,afterFakeBindingRevision:afterFakeBinding.revision,intentRecord,receiptRecord,workASummary:workA.summary,workBTitle:workB.title,workBRevision:workB.revision,hasRootInput:Object.hasOwn(input.properties,'root'),actionKinds,canonicalKinds,taskAddRequired:taskAdd.properties.task.required,evidenceAddFiles:evidenceAdd.properties.evidence.properties.files,schemaClosed,authorizeProperties:Object.keys(authorizeInput.properties),authorizeClosed:authorizeInput.additionalProperties===false,preflightClosed:preflightInput.additionalProperties===false,preflightNoRepo,forgedAuthorize,missingSession}));
  `;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',child],{cwd:sandbox,encoding:'utf8',timeout:60_000,env:{...process.env,HOME:home,USERPROFILE:home,SOL_TEST_A:projectA,SOL_TEST_B:projectB}});
  assert.equal(result.error,undefined,`${result.error?.message}`);assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  const response=JSON.parse(result.stdout.trim().split('\n').at(-1));
  for(const name of ['sol_workspace_prepare','sol_work_get','sol_work_create','sol_work_apply'])assert.ok(response.tools.includes(name),name);
  assert.match(response.getA.content,/Discovery para implementar:/);assert.match(response.getA.content,/Skills sugeridas \(no cargadas automáticamente\):/);
  assert.match(response.unknown.content,/No se completó sol_work_apply/);assert.equal(response.afterUnknownRevision,1);
  assert.match(response.fakeRoot.content,/No se completó sol_work_create/);assert.equal(response.fakeRootExists,false);
  assert.match(response.approvalAttempt.content,/shipping\.approval\.record no está disponible/);assert.deepEqual(response.afterApproval,response.beforeApproval,'la mutación mixta se rechaza sin escritura parcial');
  assert.match(response.fakeBinding.content,/No se completó sol_work_apply/);assert.equal(response.afterFakeBindingRevision,2,'un approval embebido en preview no modifica el Work');
  assert.match(response.changedA.content,/Skills sugeridas \(no cargadas automáticamente\):/);assert.equal(response.workASummary,'actual A');
  assert.equal(response.workBTitle,'Proyecto B');assert.equal(response.workBRevision,1);assert.equal(response.hasRootInput,false);
  assert.match(response.intentRecord.content,/preview Ship INTENT-1 registrado/);assert.match(response.receiptRecord.content,/observación Ship RCP-1 registrada/);
  assert.match(response.missingSession.content,/no proporcionó la sesión actual/);
  assert.ok(response.actionKinds.length>0,'el esquema del tool conserva variantes tipadas');
  assert.ok(response.actionKinds.every(kind=>typeof kind==='string'),'no queda fallback genérico ni variante sin discriminador');
  assert.equal(new Set(response.actionKinds).size,response.actionKinds.length,'cada acción pública tiene una única variante');
   assert.equal(response.actionKinds.includes('shipping.approval.record'),false,'la acción reportada de aprobación se filtra del schema público');
   assert.deepEqual([...response.actionKinds].sort(),[...new Set(response.canonicalKinds)].filter(kind=>kind!=='shipping.approval.record').sort(),'cada acción canónica ejecutable se expone con una variante pública tipada salvo la aprobación privada');
   assert.ok(response.taskAddRequired.includes('dependsOn')&&response.taskAddRequired.includes('acceptance'),'task.add exige los campos persistidos que el core valida');
   assert.equal(response.evidenceAddFiles.items.type,'string','evidence.add recibe paths; el core genera fingerprints');
  assert.ok(response.actionKinds.includes('shipping.intent.record'));assert.ok(response.actionKinds.includes('shipping.receipt.record'));
  assert.equal(response.schemaClosed,true,'payloads públicos con objetos cerrados, incluidos refs locales');
  assert.equal(response.tools.includes('sol_ship_preflight'),true,'preflight readonly se registra en el paquete instalado');
  assert.equal(response.tools.includes('sol_ship_authorize'),true,'autorización nativa se registra en el paquete instalado');
  assert.deepEqual(response.authorizeProperties,['workId','expectedRevision','intentId','snapshotSha256'],'no hay actor/approved/root/token caller-controlled');
  assert.equal(response.authorizeClosed,true);assert.equal(response.preflightClosed,true);
  assert.match(response.preflightNoRepo.content,/No se completó sol_ship_preflight/);
  assert.match(response.forgedAuthorize.content,/Intent ausente, no previsualizado o snapshot diferente/,'approved/root arbitrarios no suplen intent ni native ASK');

  const refSchema={type:'object',additionalProperties:false,required:['workId','expectedRevision','actions'],properties:{workId:{type:'string'},expectedRevision:{type:'integer'},actions:{type:'array',items:{$ref:'#/$defs/actionUnion'}}},$defs:{
    actionUnion:{oneOf:[{$ref:'#/$defs/intentAction'},{$ref:'#/$defs/approvalAction'}]},
    intentAction:{type:'object',additionalProperties:false,required:['type','intent'],properties:{type:{const:'shipping.intent.record'},intent:{$ref:'#/$defs/intentPayload'}}},
    intentPayload:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string'}}},
    approvalAction:{type:'object',additionalProperties:false,required:['type','approvedAt'],properties:{type:{const:'shipping.approval.record'},approvedAt:{type:'string'}}},
  }};
  fs.writeFileSync(path.join(home,'.sol/schemas/work-update.schema.json'),JSON.stringify(refSchema));
  const refChild=`import plugin from ${JSON.stringify(pluginPath)}; const registered=new Map(); await plugin.setup({tool:{transform:async callback=>callback({add:tool=>registered.set(tool.name,tool)})}}); const input=registered.get('sol_work_apply').input; console.log(JSON.stringify({itemRef:input.properties.actions.items.$ref,union:input.$defs.actionUnion.oneOf,hasPayloadDef:!!input.$defs.intentPayload,hasPrivateDefinition:!!input.$defs.approvalAction}));`;
  const refRun=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',refChild],{cwd:sandbox,encoding:'utf8',timeout:60_000,env:{...process.env,HOME:home,USERPROFILE:home}});
  assert.equal(refRun.error,undefined,`${refRun.error?.message}`);assert.equal(refRun.status,0,`${refRun.stdout}\n${refRun.stderr}`);
  const refOutput=JSON.parse(refRun.stdout.trim().split('\n').at(-1));
  assert.equal(refOutput.itemRef,'#/$defs/actionUnion','se conserva el $ref de la entrada');
  assert.deepEqual(refOutput.union,[{$ref:'#/$defs/intentAction'}],'la rama privada se excluye del union alcanzable');
  assert.equal(refOutput.hasPayloadDef,true,'se conservan $defs necesarios por las ramas públicas');
  assert.equal(refOutput.hasPrivateDefinition,true,'definición sin referencia no hace pública la acción privada');
});
