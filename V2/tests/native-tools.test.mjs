import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {formatStatusPage,formatWorkView} from '../plugins/opencode-v2/work-views.mjs';
import {composeNativeFiles,solToolNames} from '../lib/composition.mjs';
import {preparePluginVersionFixture} from './plugin-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function work(){
  return {id:'WORK-1',revision:7,status:'in_progress',title:'Multiple fronts',objective:{outcome:'A scoped outcome',criteria:Array.from({length:35},(_,i)=>({id:`AC-${i+1}`,description:`criterion ${i+1}`,verification:'check',evidenceIds:[]}))},tasks:Array.from({length:35},(_,i)=>({id:`T-${i+1}`,title:`task ${i+1}`,status:'pending',criterionIds:[`AC-${i+1}`],dependsOn:[],writeScope:[`src/${i}.mjs`],acceptance:['check']})),summary:'coordination',nextAction:'continue',blockers:[],decisionsPending:[],documents:[{kind:'spec',path:'docs/spec.md'}],evidence:[{id:'E-1',summary:'Observed metadata only',report:'never-open-me.md',taskIds:['T-1'],criterionIds:['AC-1'],status:'pass',files:[{path:'src/0.mjs',sha256:'a'.repeat(64)}]}],discovery:{contextLane:'existing-project',sources:[],claims:[],assumptions:[],questions:[{id:'Q-GLOBAL',question:'global',impact:'material'},{id:'Q-1',question:'for task 1',taskIds:['T-1']},{id:'Q-2',question:'for task 2',taskIds:['T-2']}],decisions:[{id:'D-1',statement:'x'.repeat(1000)+'END-OF-DECISION',status:'confirmed',sourceIds:[],taskIds:['T-1']}]}};
}
test('sol_status conserva otros frentes con foco y hace accesibles todas las páginas',()=>{
  const state={focusWorkId:'W-1',works:Array.from({length:25},(_,i)=>({id:`W-${i+1}`,status:'in_progress',priority:'normal',objective:`objective ${i+1}`,progress:{done:0,total:1},blockers:[],decisionsPending:[],nextAction:'continue'}))};
  const first=formatStatusPage(state,0,10),second=formatStatusPage(state,10,10),last=formatStatusPage(state,20,10);
  assert.match(first,/W-1 \[foco\]/);assert.match(first,/W-10 ·/);assert.match(first,/offset 10/);assert.doesNotMatch(first,/W-11 ·/);
  assert.match(second,/W-20 ·/);assert.match(last,/W-25 ·/);assert.doesNotMatch(last,/Más frentes/);
  assert.throws(()=>formatStatusPage(state,0,21),/limit/);assert.throws(()=>formatStatusPage(state,-1,10),/offset/);
});
test('sol_work_get pagina criterios y tareas más allá de los antiguos cortes 12 y 20',()=>{
  const w=work();
  const criteria=formatWorkView(w,{section:'criteria',offset:20,limit:10});
  const tasks=formatWorkView(w,{section:'tasks',offset:30,limit:10});
  assert.match(criteria,/AC-30/);assert.doesNotMatch(criteria,/AC-31/);assert.match(criteria,/offset 30/);
  assert.match(tasks,/T-35/);assert.doesNotMatch(tasks,/Más:/);
  const detail=formatWorkView(w,{section:'tasks',itemId:'T-35'});assert.match(detail,/writeScope:/);assert.match(detail,/src\/34\.mjs/);
  assert.throws(()=>formatWorkView(w,{section:'tasks',limit:0}),/limit/);
});
test('consultas selectivas incluyen incertidumbre global y detalle completo sin abrir archivos',()=>{
  const w=work();
  const questions=formatWorkView(w,{section:'questions',taskId:'T-1'},{relevantTaskIds:['T-1'],criterionIds:['AC-1']});
  assert.match(questions,/Q-GLOBAL/);assert.match(questions,/Q-1/);assert.doesNotMatch(questions,/Q-2/);
  const byCriterion=formatWorkView(w,{section:'questions',criterionId:'AC-1'});assert.match(byCriterion,/Q-1/);assert.doesNotMatch(byCriterion,/Q-2/);
  const decisions=formatWorkView(w,{section:'decisions',itemId:'D-1'});assert.match(decisions,/END-OF-DECISION/);
  const evidence=formatWorkView(w,{section:'evidence',itemId:'E-1'});assert.match(evidence,/never-open-me.md/);assert.match(evidence,/sha256:/);
  const document=formatWorkView(w,{section:'documents',itemId:'docs/spec.md'});assert.match(document,/kind: spec/);
  assert.throws(()=>formatWorkView(w,{section:'tasks',taskId:'missing'}),/Tarea inexistente/);
  assert.throws(()=>formatWorkView(w,{section:'summary',itemId:'D-1'}),/requiere una sección/);
});
test('composición mantiene especialistas visibles y permisos de autoridad intactos',()=>{
  const files=composeNativeFiles({root});
  for(const [file,body] of files)if(/^\.opencode\/agents\/sol-.+\.md$/.test(file)){
    assert.doesNotMatch(String(body),/hidden: true|runtime_adapter/);
    assert.match(String(body),/mode: "subagent"/);assert.match(String(body),/"action":"subagent","resource":"\*","effect":"deny"/);
    assert.match(String(body),/"action":"sol_ship_authorize","resource":"\*","effect":"deny"/);
  }
  assert.ok(solToolNames.includes('sol_version'));
  assert.match(String(files.get('.opencode/agents/sol.md')),/"action":"sol_ship_authorize","resource":"\*","effect":"ask"/);
});
test('sol_version conserva identidad cargada y detecta cambios de instalación sin una sesión',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sol-native-version-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const identity=preparePluginVersionFixture(home,{version:'2.1.1'});
  const schemas=path.join(home,'.sol/schemas');fs.mkdirSync(schemas,{recursive:true});
  for(const file of ['work.schema.json','work-update.schema.json'])fs.copyFileSync(path.join(root,'schemas',file),path.join(schemas,file));
  fs.writeFileSync(path.join(home,'.sol/installation.json'),JSON.stringify({schemaVersion:1,files:{},...identity}));
  const code=`
    import fs from 'node:fs';import path from 'node:path';import plugin from ${JSON.stringify(path.join(root,'plugins/opencode-v2/index.ts'))};
    const registered=new Map();let sessionCalls=0;
    await plugin.setup({app:{version:'2.0.20-fixture'},permission:{hook:async()=>{}},tool:{transform:async edit=>edit({add:tool=>registered.set(tool.name,tool)})},session:{get:async()=>{sessionCalls++;throw Error('session unavailable')}}});
    const tool=registered.get('sol_version'),before=await tool.execute({},{});
    const manifest=path.join(process.env.HOME,'.sol/installation.json');
    fs.writeFileSync(manifest,JSON.stringify({schemaVersion:1,files:{},...${JSON.stringify(identity)},version:'2.2.0',buildHash:'b'.repeat(64)}));
    const after=await tool.execute({},{});
    fs.unlinkSync(manifest);const missing=await tool.execute({},{});
    fs.writeFileSync(manifest,'not json');const invalid=await tool.execute({},{});
    console.log(JSON.stringify({before,after,missing,invalid,sessionCalls}));
  `;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);const response=JSON.parse(result.stdout.trim());
  assert.equal(response.sessionCalls,0);assert.match(response.before.content,/reloadRequired: false/);
  assert.match(response.after.content,/Sol cargado por esta instancia: 2\.1\.1/);assert.match(response.after.content,/Sol instalado actualmente: 2.2.0/);assert.match(response.after.content,/reloadRequired: true/);
  assert.match(response.missing.content,/reloadRequired: unknown/);assert.match(response.invalid.content,/Instalación actual: no legible/);
});
test('/sol-version abre un diálogo CLI estático sin llamadas a modelo ni sesión',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sol-cli-version-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const identity=preparePluginVersionFixture(home,{version:'2.1.1'});
  fs.writeFileSync(path.join(home,'.sol/installation.json'),JSON.stringify({schemaVersion:1,files:{},...identity}));
  const code=`
    import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
    import plugin from ${JSON.stringify(path.join(root,'plugins/opencode-v2/tui.ts'))};
    const layers=[],dialogs=[];let modelCalls=0;
    const forbidden=new Proxy({}, {get(){modelCalls++;throw Error('No model/session/client access permitted')}});
    await plugin.setup({app:{version:'2.0.20-fixture'},keymap:{layer:factory=>{const layer=factory();assert.equal(JSON.stringify(factory()),JSON.stringify(layer));layers.push(layer)}},ui:{dialog:{alert:async input=>{dialogs.push(input)}}},client:{session:forbidden,model:forbidden},session:forbidden,model:forbidden,generate:forbidden});
    const command=layers[0].commands[0];assert.equal(command.slash.name,'sol-version');assert.equal(command.palette,true);
    assert.equal(dialogs.length,0);await command.run();
    fs.writeFileSync(path.join(process.env.HOME,'.sol/installation.json'),JSON.stringify({schemaVersion:1,files:{},...${JSON.stringify(identity)},version:'2.2.0',buildHash:'b'.repeat(64)}));
    await command.run();console.log(JSON.stringify({dialogs,modelCalls}));
  `;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);const response=JSON.parse(result.stdout.trim());
  assert.equal(response.modelCalls,0);assert.equal(response.dialogs.length,2);
  assert.match(response.dialogs[0].message,/reloadRequired: false/);
  assert.match(response.dialogs[0].message,/CLI local; no acredita el plugin de un servidor remoto/);
  assert.match(response.dialogs[1].message,/Sol cargado por esta instancia: 2\.1\.1/);
  assert.match(response.dialogs[1].message,/Sol instalado actualmente: 2.2.0/);
  assert.match(response.dialogs[1].message,/reloadRequired: true/);
  const files=composeNativeFiles({root});
  const pkg=JSON.parse(String(files.get('.opencode/plugins/sol/package.json')));
  assert.equal(pkg.exports['./tui'],'./tui.ts');
  assert.ok(files.has('.opencode/plugins/sol/tui.ts'));
  assert.ok(files.has('.opencode/plugins/sol/version-view.mjs'));
  assert.equal(files.has('.opencode/commands/sol-version.md'),false);
});
