import {preparePluginVersionFixture} from './plugin-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function fixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sol-config-real-plugin-'));
  preparePluginVersionFixture(home);
  const project=path.join(home,'repo');fs.mkdirSync(project);
  execFileSync('git',['init','--quiet'],{cwd:project});
  const lib=path.join(home,'.sol/lib'),schemas=path.join(home,'.sol/schemas'),config=path.join(home,'.config/opencode/opencode.jsonc');
  fs.mkdirSync(lib,{recursive:true});fs.mkdirSync(schemas,{recursive:true});fs.mkdirSync(path.dirname(config),{recursive:true});
  for(const name of ['artifact-tracking.mjs','model-config.mjs','model-profiles.mjs','jsonc.mjs','fs.mjs'])fs.copyFileSync(path.join(root,'lib',name),path.join(lib,name));
  fs.copyFileSync(path.join(root,'schemas/work-update.schema.json'),path.join(schemas,'work-update.schema.json'));
  // Match the canonical schema assets installed beside the real plugin.
  fs.copyFileSync(path.join(root,'schemas/work.schema.json'),path.join(schemas,'work.schema.json'));
  fs.writeFileSync(path.join(home,'.sol/installation.json'),JSON.stringify({schemaVersion:1,version:'2.0.0',runtimes:['opencode-v2'],files:{}}));
  const initial='{"provider":{"openai":{"options":{"apiKey":"fixture-secret"}}},"agents":{"sol":{"prompt":"keep this"}}}\n';
  fs.writeFileSync(config,initial);
  return {home,project,config,initial,dispose:()=>fs.rmSync(home,{recursive:true,force:true})};
}

function pluginSource({home,project,config,initial,scenario}){return String.raw`
  import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
  import {createNativePermissionHost} from ${JSON.stringify(path.join(root,'tests/native-permission-host.mjs'))};
  import plugin from ${JSON.stringify(path.join(root,'plugins/opencode-v2/index.ts'))};
  const home=${JSON.stringify(home)},project=${JSON.stringify(project)},config=${JSON.stringify(config)},initial=${JSON.stringify(initial)},scenario=${JSON.stringify(scenario)};
  const lib=path.join(home,'.sol/lib');
  const {readModelConfig}=await import(pathToFileURL(path.join(lib,'model-config.mjs')));
  const {readArtifactTracking}=await import(pathToFileURL(path.join(lib,'artifact-tracking.mjs')));
  const registered={};const activeModel={providerID:'openai',id:'gpt-6.1-sol',variant:'medium'};
  const ctx={...createNativePermissionHost(),tool:{transform:async fn=>fn({add:tool=>registered[tool.name]=tool})},session:{get:async()=>({location:{directory:project},model:activeModel})},model:{list:async options=>({location:options.location,data:[{providerID:'openai',id:'vendor/path-model',name:'Model Fixture',enabled:true,status:'active',variants:[{id:'high'}]}]})}};
  await plugin.setup(ctx);let callIndex=0;const call=(name,args)=>registered[name].execute(args,{sessionID:'ses-integration',agent:'sol',id:'call-'+(++callIndex),messageID:'message-'+callIndex,signal:new AbortController().signal});
  const infoPath=execFileSync('git',['rev-parse','--git-path','info/exclude'],{cwd:project,encoding:'utf8'}).trim();
  const exclude=path.resolve(project,infoPath);const initialExclude=fs.existsSync(exclude)?fs.readFileSync(exclude):null;
  const view=await call('sol_config_get',{});const output=String(view.content);
  if(!output.includes('Tracking local del repo')||!output.includes('revisión'))throw Error('config_get no muestra tracking/revisión local: '+output);
  if(output.includes('fixture-secret')||output.includes('apiKey'))throw Error('config_get expuso settings sensibles');
  if(!output.includes('openai/vendor/path-model'))throw Error('catálogo no conserva id de modelo con slash');
  const snap=readModelConfig(),tracking=readArtifactTracking(project);
  if(!tracking.available||tracking.mode!=='unconfigured')throw Error('fixture Git no está en estado unconfigured');
  const args={profile:'custom',overrides:[{agentId:'sol',model:'openai/vendor/path-model#high'}],expectedRevision:snap.revision,artifactTracking:scenario.startsWith('rollback')||scenario==='local-success'?'local':'versioned',artifactExpectedRevision:tracking.revision};
  const preview=await call('sol_config_apply',args);
  if(!String(preview.content).includes('Vista previa combinada')||!String(preview.content).includes('Tracking local del repo'))throw Error('falta preview combinada');
  if(fs.readFileSync(config,'utf8')!==initial)throw Error('preview modificó preferencias globales');
  if(fs.existsSync(exclude)!==(initialExclude!==null)||(initialExclude!==null&&!fs.readFileSync(exclude).equals(initialExclude)))throw Error('preview modificó metadata Git');
  if(scenario.startsWith('rollback')){
    const rename=fs.renameSync;fs.renameSync=function(from,to,...rest){if(path.resolve(String(to))===config){if(scenario==='rollback-conflict')fs.appendFileSync(exclude,'\n# concurrent user change\n');throw Object.assign(new Error('fixture global config write failure'),{code:'EIO'});}return rename.call(this,from,to,...rest)};
    try{
      const result=await call('sol_config_apply',{...args,dryRun:false});
      const message=String(result.content);
      if(scenario==='rollback'&&!message.includes('Falló el guardado global de modelos'))throw Error('fallo del segundo guardado no reportado: '+message);
      if(scenario==='rollback-conflict'&&(!message.includes('también falló la restauración del tracking')||!message.includes('sol-artifacts-backups')))throw Error('restauración parcial no comunicada con recuperación: '+message);
    }
    finally{fs.renameSync=rename;}
    if(scenario==='rollback'&&readArtifactTracking(project).mode!=='unconfigured')throw Error('tracking no se restauró tras fallo global');
    if(scenario==='rollback'&&(fs.existsSync(exclude)!==(initialExclude!==null)||(initialExclude!==null&&!fs.readFileSync(exclude).equals(initialExclude))))throw Error('rollback alteró info/exclude original');
    if(scenario==='rollback-conflict'&&(!fs.readFileSync(exclude,'utf8').includes('# concurrent user change')||!fs.readFileSync(exclude,'utf8').includes('# mode: local')))throw Error('se perdió el contenido concurrente o se afirmó rollback íntegro');
    if(fs.readFileSync(config,'utf8')!==initial)throw Error('rollback global alteró config');
  }else{
    const result=await call('sol_config_apply',{...args,dryRun:false});
     if(!String(result.content).includes('Guardado coordinado')||!String(result.content).includes('no sube datos'))throw Error('recibo/versionado incorrecto: '+String(result.content));
    const configured=JSON.parse(fs.readFileSync(config,'utf8'));
    if(configured.agents.sol.model.providerID!=='openai'||configured.agents.sol.model.model!=='vendor/path-model'||configured.agents.sol.model.variant!=='high'||configured.agents.sol.prompt!=='keep this')throw Error('preferencia custom no se guardó preservando prompt');
    const expectedTracking=scenario==='local-success'?'local':'versioned';
    if(readArtifactTracking(project).mode!==expectedTracking)throw Error('modo '+expectedTracking+' no quedó activo');
    const excludeText=fs.readFileSync(exclude,'utf8');if(!excludeText.includes('# mode: '+expectedTracking)||(expectedTracking==='local'?!excludeText.includes('/.sol/'):excludeText.includes('/.sol/')))throw Error(expectedTracking+' dejó un patrón de exclusión incorrecto');
    const manifest=JSON.parse(fs.readFileSync(path.join(home,'.sol/installation.json'),'utf8'));
    if(manifest.tracking||manifest.artifactTracking||JSON.stringify(manifest).includes('versioned'))throw Error('tracking fue globalizado en manifest');
    if(fs.existsSync(path.join(project,'.sol')))throw Error('plugin creó .sol sin workspace_prepare');
    if(activeModel.id!=='gpt-6.1-sol'||activeModel.variant!=='medium'||'switchModel' in ctx.session)throw Error('el plugin cambió o intentó cambiar modelo de sesión');
  }
`}

test('plugin integra los helpers reales: wizard coordinado, privacidad, rollback y sin init de workspace',()=>{
  for(const scenario of ['success','local-success','rollback','rollback-conflict']){
    const f=fixture();
    try{
      const source=pluginSource({...f,scenario});
      const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,HOME:f.home,USERPROFILE:f.home,XDG_CONFIG_HOME:path.join(f.home,'.config'),OPENCODE_CONFIG_DIR:path.join(f.home,'.config/opencode')}});
      assert.equal(result.status,0,`${scenario}\n${result.stdout}\n${result.stderr}`);
    }finally{f.dispose();}
  }
});

test('sol-init ordena el tracking antes de cualquier preparación y config no altera el perfil al iniciar',()=>{
  const init=fs.readFileSync(path.join(root,'skills/sol-init/SKILL.md'),'utf8');
  const dispatch=fs.readFileSync(path.join(root,'plugins/opencode-v2/init-dispatch.mjs'),'utf8');
  const tui=fs.readFileSync(path.join(root,'plugins/opencode-v2/tui.ts'),'utf8');
  const config=fs.readFileSync(path.join(root,'skills/sol-config/SKILL.md'),'utf8');
  const sol=fs.readFileSync(path.join(root,'agents/sol.md'),'utf8');
  assert.match(init,/not a Markdown dispatcher|no un dispatcher Markdown/i);
  const before=(first,second,label)=>{const a=dispatch.indexOf(first),b=dispatch.indexOf(second);assert.notEqual(a,-1,`${label}: falta ${first}`);assert.notEqual(b,-1,`${label}: falta ${second}`);assert.ok(a<b,label);};
  before('tracking.readArtifactTracking(root)',"action:'sol_workspace_prepare'",'tracking is checked before workspace preparation');
  before('tracking.applyArtifactTracking(plan)',"action:'sol_workspace_prepare'",'tracking is applied before workspace preparation');
  assert.match(tui,/slash: \{ name: "sol-init"/);
  assert.match(init,/bootstrap exige tracking Local\/Versionado previamente configurado y autorizado/);
  assert.match(dispatch,/title:'Local',value:'local'[\s\S]*title:'Versionado',value:'versioned'/);
  assert.match(dispatch,/if\(!current\.available\)throw new Error\(current\.blockers\.join\('; '\)\)/);
  assert.match(init,/No inicializa Git ni cambia modelos/);
  const profileStep=config.indexOf('**Paso 1, perfil:**'),trackingStep=config.indexOf('**Paso 2, tracking:**');
  assert.notEqual(profileStep,-1,'config declara el paso de perfil');assert.notEqual(trackingStep,-1,'config declara el paso de tracking');assert.ok(profileStep<trackingStep);
  assert.match(config,/tracking es estrictamente local a este repo y nunca una preferencia global/i);
  assert.match(config,/si está `unconfigured`[\s\S]*`Local` como valor sugerido\/predeterminado[\s\S]*`Versionado` como alternativa explícita/i);
  assert.ok(config.includes('no significa que `.sol/` ya esté excluido'));
  assert.match(sol,/encargo ordinario, selección del agente o carga de una skill no lo activa/);
});
