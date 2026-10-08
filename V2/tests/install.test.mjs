import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {install,uninstall} from '../lib/install.mjs';
import {prepareWorkspace} from '../lib/workspace.mjs';
import {sha256} from '../lib/fs.mjs';
import {temp} from './helpers.mjs';
import {main,HELP} from '../install.mjs';

const v2=()=> 'opencode v2.0.20';
const options=homeDir=>({homeDir,env:{},probeVersion:v2});
const modelCatalog=[['openai','gpt-6.1-sol',['medium','high']],['openai','gpt-6-luna',['medium','high']]].map(([providerID,id,variants])=>({providerID,id,enabled:true,status:'active',variants:variants.map(id=>({id}))}));

test('CLI ayuda disponible antes de comprobar Node u OpenCode',()=>{
  const output=[];assert.equal(main(['--help'],{out:text=>output.push(text),nodeVersion:'0.0.1'}),undefined);
  assert.match(output.join('\n'),/Uso:[\s\S]*--dry-run[\s\S]*uninstall/);assert.match(HELP,/sin OpenCode|PATH/i);
});

test('CLI muestra una vista previa legible, sin JSON crudo ni escrituras',t=>{
  const home=temp(t),output=[];
  main(['--dry-run'],{out:text=>output.push(text),installFn:()=>({dryRun:true,target:home,opencodeVersion:'opencode v2.0.20',actions:[{action:'create'},{action:'unchanged'}],removals:['old']})});
  const text=output.join('\n');assert.match(text,/Comprobación/);assert.match(text,/Vista previa/);assert.match(text,/1 nuevos, 0 actualizados, 1 sin cambios/);assert.match(text,/1 archivo\(s\)/);assert.doesNotMatch(text,/Fase\s+\d+\/\d+|"dryRun"/);assert.deepEqual(fs.readdirSync(home),[]);
});

test('CLI éxito informa siguiente paso y resume conteos',()=>{
  const output=[];
  main([],{out:text=>output.push(text),installFn:()=>({created:2,updated:1,unchanged:3,removed:0,recovery:'/home/test/.sol/backups/test'})});
  assert.match(output.join('\n'),/Instalación completada/);assert.match(output.join('\n'),/2 nuevos, 1 actualizados, 3 sin cambios/);assert.match(output.join('\n'),/reinicia OpenCode/);assert.match(output.join('\n'),/sol-config/);assert.match(output.join('\n'),/\/models/);assert.match(output.join('\n'),/no se restaura automáticamente/);assert.match(output.join('\n'),/recovery\.json/);assert.doesNotMatch(output.join('\n'),/Fase\s+\d+\/\d+/);
});

test('CLI errores de argumentos orientan a --help sin ejecutar instalación',()=>{
  let called=false;assert.throws(()=>main(['--oops'],{installFn:()=>{called=true;}}),/--help/);assert.equal(called,false);
});

test('CLI acepta perfil equilibrado y asignaciones custom explícitas',()=>{
  const calls=[];const installFn=options=>{calls.push(options);return {created:0,updated:0,unchanged:0,removed:0};};
  main(['--profile','balanced'],{out:()=>{},installFn});
  main(['--profile','custom','--model','sol=openai/gpt-6.1-sol#medium'],{out:()=>{},installFn});
  assert.equal(calls[0].profile,'balanced');assert.equal(calls[1].overrides.sol,'openai/gpt-6.1-sol#medium');
  assert.throws(()=>main(['--model','sol=x/y'],{installFn}),/custom/);
  assert.throws(()=>main(['--profile','custom'],{installFn}),/opción --model/);
});

test('OpenCode v2 installation includes core, plugin, agent, commands and native skills',t=>{
  const home=temp(t),result=install(options(home));
  assert.deepEqual(result.runtimes,['opencode-v2']);assert.equal(result.opencodeVersion,v2());
  for(const file of ['.config/opencode/agents/sol.md','.config/opencode/plugins/sol/index.ts','.config/opencode/plugins/sol/package.json','.config/opencode/commands/sol-init.md','.config/opencode/commands/sol-new-project.md','.config/opencode/commands/sol-onboard.md','.config/opencode/commands/sol-discuss.md','.config/opencode/commands/sol-plan.md','.config/opencode/commands/sol-execute.md','.config/opencode/commands/sol-verify.md','.config/opencode/commands/sol-ship.md','.config/opencode/skills/sol-init/SKILL.md','.config/opencode/skills/sol-discovery/SKILL.md','.sol/lib/artifacts.mjs','.sol/lib/contracts.mjs','.sol/lib/jsonc.mjs','.sol/lib/model-config.mjs','.sol/lib/model-profiles.mjs','.sol/schemas/shipping-intent.schema.json'])assert.ok(fs.existsSync(path.join(home,file)),file);
  if(fs.existsSync(path.join(path.dirname(new URL(import.meta.url).pathname),'..','lib','artifact-tracking.mjs')))
    assert.ok(fs.existsSync(path.join(home,'.sol/lib/artifact-tracking.mjs')));
  for(const file of ['.sol/bin/sol.mjs','.sol/bin/prepare.mjs','.sol/lib/install.mjs','.sol/lib/composition.mjs','.agents/skills/sol-init/SKILL.md'])assert.equal(fs.existsSync(path.join(home,file)),false,file);
  assert.equal(fs.existsSync(path.join(home,'.sol/state.json')),false);
});

test('Nested skill references are installed recursively while unowned user notes survive upgrade and uninstall',t=>{
  const home=temp(t);install(options(home));
  const skillRoot=path.join(home,'.config/opencode/skills/sol-discovery');
  const installed=[];const walk=(dir,rel='')=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const next=rel?`${rel}/${entry.name}`:entry.name,p=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error(`unexpected symlink ${p}`);if(entry.isDirectory())walk(p,next);else installed.push(next);}};walk(skillRoot);
  const sourceRoot=path.join(path.dirname(new URL(import.meta.url).pathname),'..','skills/sol-discovery');
  const source=[];const collect=(dir,rel='')=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const next=rel?`${rel}/${entry.name}`:entry.name,p=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error(`unexpected source symlink ${p}`);if(entry.isDirectory())collect(p,next);else source.push(next);}};collect(sourceRoot);
  for(const rel of source)assert.ok(installed.includes(rel),rel);
  const note=path.join(skillRoot,'references/user-note.md');fs.mkdirSync(path.dirname(note),{recursive:true});fs.writeFileSync(note,'user-owned note');
  install(options(home));assert.equal(fs.readFileSync(note,'utf8'),'user-owned note');
  uninstall({homeDir:home,env:{}});assert.equal(fs.readFileSync(note,'utf8'),'user-owned note');
});

test('Rechaza OpenCode v1 y versión no detectable antes de escribir',t=>{
  const home=temp(t);assert.throws(()=>install({...options(home),probeVersion:()=> 'opencode 1.18.33'}),/requiere OpenCode v2/);assert.equal(fs.existsSync(home),true);assert.equal(fs.existsSync(path.join(home,'.sol')),false);
  assert.throws(()=>install({...options(home),probeVersion:()=> ''}),/No se pudo detectar OpenCode/);assert.equal(fs.existsSync(path.join(home,'.sol')),false);
});

test('Instalación idempotente y dry-run no modifica HOME',t=>{
  const home=temp(t);install(options(home));const manifest=fs.readFileSync(path.join(home,'.sol/installation.json'),'utf8');
  const backups=path.join(home,'.sol/backups'),before=fs.existsSync(backups)?fs.readdirSync(backups):[];
  const result=install(options(home));assert.equal(result.created,0);assert.equal(result.updated,0);assert.equal(result.recovery,null);assert.equal(fs.readFileSync(path.join(home,'.sol/installation.json'),'utf8'),manifest);
  assert.deepEqual(fs.existsSync(backups)?fs.readdirSync(backups):[],before);
  const preview=path.join(temp(t),'new-home');install({...options(preview),dryRun:true});assert.equal(fs.existsSync(preview),false);
});

test('No modifica configuración ajena ni pisa una integración no registrada',t=>{
  const home=temp(t),config=path.join(home,'.config/opencode/opencode.jsonc'),agent=path.join(home,'.config/opencode/agents/sol.md');
  fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'ORIGINAL');fs.mkdirSync(path.dirname(agent),{recursive:true});fs.writeFileSync(agent,'AJENO');
  assert.throws(()=>install(options(home)),/archivo ajeno|Integración anterior/);assert.equal(fs.readFileSync(config,'utf8'),'ORIGINAL');assert.equal(fs.readFileSync(agent,'utf8'),'AJENO');assert.equal(fs.existsSync(path.join(home,'.sol')),false);
});

test('Instalación predeterminada limpia modelos Sol heredados y conserva intacto lo demás',t=>{
  const home=temp(t),config=path.join(home,'.config/opencode/opencode.jsonc');fs.mkdirSync(path.dirname(config),{recursive:true});
  const original=`{// keep comment\n "model":{"providerID":"acme","model":"main"},"auth":{"token":"secret"},"permissions":{"*":"allow"},"providers":{"acme":{"options":{"apiKey":"private"}}},"mcp":{"keep":{"type":"remote","url":"https://example.test"}},"agents":{"sol":{"model":{"providerID":"old","model":"sol-model"},"permission":{"*":"deny"},"other":true},"unrelated":{"model":"stay/model","permission":{"x":"ask"}}}}`;
  fs.writeFileSync(config,original);const result=install(options(home));const output=fs.readFileSync(config,'utf8');
  assert.match(output,/keep comment/);assert.match(output,/secret/);assert.match(output,/private/);assert.match(output,/stay\/model/);assert.match(output,/"other":true/);assert.match(output,/"deny"/);assert.doesNotMatch(output,/old/);
  assert.equal(result.profile,'inherited');assert.ok(result.modelChanges.some(x=>x.agentId==='sol'));
  const manifest=JSON.parse(fs.readFileSync(path.join(home,'.sol/installation.json')));assert.deepEqual(manifest.modelConfig.agentIds,[]);assert.equal(manifest.files['.config/opencode/opencode.jsonc'],undefined);
});

test('Migra JSON a JSONC con respaldo y sin perder configuración si no hay modelos',t=>{
  const home=temp(t),dir=path.join(home,'.config/opencode');fs.mkdirSync(dir,{recursive:true});const json=path.join(dir,'opencode.json'),original='{"theme":"dark","providers":{"x":{"options":{"apiKey":"secret"}}}}';fs.writeFileSync(json,original);
  const result=install(options(home));assert.equal(fs.existsSync(json),false);assert.equal(fs.readFileSync(path.join(dir,'opencode.jsonc'),'utf8'),original);
  const index=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json')));const backup=index.files.find(x=>x.path==='.config/opencode/opencode.json');assert.equal(fs.readFileSync(path.join(home,backup.backup),'utf8'),original);
});

test('Bloquea opencode.json y opencode.jsonc simultáneos sin tocar ninguno',t=>{
  const home=temp(t),dir=path.join(home,'.config/opencode');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'opencode.json'),'{}');fs.writeFileSync(path.join(dir,'opencode.jsonc'),'{}');
  assert.throws(()=>install(options(home)),/precedencia es ambigua/);assert.equal(fs.existsSync(path.join(home,'.sol')),false);
});

test('Perfil equilibrado valida catálogo y asigna roles nativos en config global',t=>{
  const home=temp(t);const result=install({...options(home),profile:'balanced',catalog:modelCatalog});const cfg=JSON.parse(fs.readFileSync(path.join(home,'.config/opencode/opencode.jsonc')));
  assert.deepEqual(cfg.agents.sol.model,{providerID:'openai',model:'gpt-6.1-sol',variant:'medium'});assert.deepEqual(cfg.agents['sol-explorer'].model,{providerID:'openai',model:'gpt-6-luna',variant:'medium'});assert.equal(result.profile,'balanced');
});

test('Desinstalación retira preferencias de modelos Sol y conserva permisos y agentes ajenos',t=>{
  const home=temp(t);install({...options(home),profile:'balanced',catalog:modelCatalog});const config=path.join(home,'.config/opencode/opencode.jsonc');
  const before=JSON.parse(fs.readFileSync(config,'utf8'));before.agents.sol.permission={'*':'deny'};before.agents.unrelated={model:'keep/model'};fs.writeFileSync(config,JSON.stringify(before));
  // Refresh only the native config fixture; the install manifest intentionally does not own this file.
  const result=uninstall({homeDir:home,env:{}}),output=fs.readFileSync(config,'utf8');
  assert.doesNotMatch(output,/gpt-6\.1-sol|gpt-6-luna/);assert.match(output,/keep\/model/);assert.match(output,/deny/);assert.equal(result.uninstalled,true);
});

test('Balanced idempotente y luego inherited limpia Solo modelos Sol',t=>{
  const home=temp(t);install({...options(home),profile:'balanced',catalog:modelCatalog});const backupDir=path.join(home,'.sol/backups'),before=fs.existsSync(backupDir)?fs.readdirSync(backupDir):[];
  const same=install({...options(home),profile:'balanced',catalog:modelCatalog});assert.equal(same.modelChanges.length,0);assert.deepEqual(fs.existsSync(backupDir)?fs.readdirSync(backupDir):[],before);
  const config=path.join(home,'.config/opencode/opencode.jsonc'),result=install(options(home)),value=JSON.parse(fs.readFileSync(config,'utf8'));
  assert.equal(result.profile,'inherited');assert.ok(result.modelChanges.length);assert.equal(value.agents.sol.model,undefined);assert.equal(value.agents['sol-explorer'].model,undefined);
  assert.equal(fs.existsSync(path.join(home,'.config/opencode/agents/sol.md')),true);
});

test('Catálogo no disponible bloquea preflight y dry-run no produce escrituras',t=>{
  const home=temp(t),bad=install.bind(null,{...options(home),profile:'balanced',probeModels:()=>({unexpected:true})});
  assert.throws(bad,/catálogo nativo/);assert.equal(fs.existsSync(path.join(home,'.sol')),false);assert.equal(fs.existsSync(path.join(home,'.config/opencode')),false);
  const preview=install({...options(home),profile:'balanced',catalog:modelCatalog,dryRun:true});assert.equal(preview.dryRun,true);assert.equal(fs.existsSync(home),true);assert.deepEqual(fs.readdirSync(home),[]);
});

test('Limpia modelo de agente Sol futuro solo si estaba registrado y no toca sus permisos',t=>{
  const home=temp(t),oc=path.join(home,'.config/opencode'),config=path.join(oc,'opencode.jsonc');fs.mkdirSync(oc,{recursive:true});
  fs.writeFileSync(config,JSON.stringify({agents:{'sol-future':{model:{providerID:'old',model:'future'},permission:{'*':'deny'}},other:{model:{providerID:'x',model:'keep'}}}}));
  fs.mkdirSync(path.join(home,'.sol'),{recursive:true});fs.writeFileSync(path.join(home,'.sol/installation.json'),JSON.stringify({schemaVersion:1,version:'2.0.0',scope:'global',runtimes:['opencode-v2'],opencodeDir:'.config/opencode',files:{},borrowed:[],modelConfig:{path:'.config/opencode/opencode.jsonc',agentIds:['sol-future']}}));
  install(options(home));const result=JSON.parse(fs.readFileSync(config,'utf8'));
  assert.equal(result.agents['sol-future'].model,undefined);assert.deepEqual(result.agents['sol-future'].permission,{'*':'deny'});assert.deepEqual(result.agents.other.model,{providerID:'x',model:'keep'});
});

test('Uninstall conserva JSON-only sin preferencias Sol y no crea un JSONC paralelo',t=>{
  const home=temp(t);install(options(home));const dir=path.join(home,'.config/opencode'),json=path.join(dir,'opencode.json'),original='{"theme":"dark","providers":{"x":{"name":"Keep"}}}';
  fs.writeFileSync(json,original);const result=uninstall({homeDir:home,env:{}});
  assert.equal(result.uninstalled,true);assert.equal(fs.readFileSync(json,'utf8'),original);assert.equal(fs.existsSync(path.join(dir,'opencode.jsonc')),false);
  const recovery=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json'),'utf8'));assert.equal(recovery.files.some(f=>f.path==='.config/opencode/opencode.json'),false);
});

test('Uninstall migra JSON con preferencias Sol a JSONC, limpia modelos y evita bloquear la próxima instalación',t=>{
  const home=temp(t);install({...options(home),profile:'balanced',catalog:modelCatalog});const dir=path.join(home,'.config/opencode'),jsonc=path.join(dir,'opencode.jsonc'),json=path.join(dir,'opencode.json');
  let original=fs.readFileSync(jsonc,'utf8');original=original.replace('{','{//user comment\n').replace('"agents"','"model":"vendor/keep","auth":{"token":"secret"},"agents"');fs.writeFileSync(json,original);fs.unlinkSync(jsonc);
  const result=uninstall({homeDir:home,env:{}});assert.equal(result.uninstalled,true);assert.equal(fs.existsSync(json),false);
  const clean=fs.readFileSync(jsonc,'utf8');assert.match(clean,/user comment/);assert.doesNotMatch(clean,/gpt-6/);assert.match(clean,/vendor\/keep/);assert.match(clean,/secret/);
  const value=JSON.parse(clean.replace(/\/\/user comment\s*/,''));assert.equal(value.agents.sol.model,undefined);
  const recovery=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json'),'utf8'));assert.ok(recovery.files.some(f=>f.path==='.config/opencode/opencode.json'));
  const next=install(options(home));assert.equal(next.profile,'inherited');assert.equal(fs.existsSync(json),false);
});

test('Reinstalación reemplaza y respalda recursos administrados editados',t=>{
  const home=temp(t);install(options(home));const agent=path.join(home,'.config/opencode/agents/sol.md');fs.appendFileSync(agent,'\nEdición local');
  const result=install(options(home));assert.ok(result.recovery);assert.doesNotMatch(fs.readFileSync(agent,'utf8'),/Edición local/);
  const index=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json')));assert.ok(index.files.some(x=>x.path==='.config/opencode/agents/sol.md'));
});

test('Migra instalación V1 completa, conserva lo ajeno y respalda estado, referencias y manifiesto',t=>{
  const home=temp(t),oc='.config/opencode',pkg='/outside/old-sol',plugin=`file://${pkg}/dist/v2/plugin.js`;
  const put=(r,v)=>{const p=path.join(home,r);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);return p;};
  const loader='export default { id: "sol", async server(){ const plugin = await import(\''+plugin+'\'); return plugin.SolPlugin; } };';
  const agent=put(`${oc}/agents/sol.md`,'old agent edited'),pluginPath=put(`${oc}/plugins/sol.js`,loader);
  const state=put('.sol/store.db','old state must survive');
  const original=`{// keep exact comment\n "default_agent":"sol", "model":"vendor/model", "auth":{"token":"secret"}, "mcp":{"sol":{"type":"local","command":["node","${pkg}/dist/v2/mcp.js"]},"other":{"url":"keep"}}, "plugin":["${plugin}","vendor/plugin"] }`;
  put(`${oc}/opencode.jsonc`,original);
  const realHome=fs.realpathSync(home),manifest={version:2,packageRoot:pkg,configPath:path.join(realHome,oc,'opencode.jsonc'),pluginSpec:plugin,previousDefaultAgent:'assistant',files:[{path:path.join(realHome,oc,'agents/sol.md'),installedHash:'a'.repeat(64)},{path:path.join(realHome,oc,'plugins/sol.js'),installedHash:'b'.repeat(64)}]};
  const oldManifest=JSON.stringify(manifest);put(`${oc}/sol-install.json`,oldManifest);
  const result=install(options(home));
  assert.match(fs.readFileSync(agent,'utf8'),/global_installation/);assert.equal(fs.existsSync(pluginPath),false);assert.equal(fs.existsSync(path.join(home,`${oc}/sol-install.json`)),false);
  const config=fs.readFileSync(path.join(home,`${oc}/opencode.jsonc`),'utf8');assert.doesNotMatch(config,/dist\/v2\/plugin.js|"default_agent":"sol"/);assert.match(config,/vendor\/model/);assert.match(config,/"token":"secret"/);assert.match(config,/keep exact comment/);assert.match(config,/vendor\/plugin/);
  assert.equal(fs.readFileSync(state,'utf8'),'old state must survive');
  const installed=JSON.parse(fs.readFileSync(path.join(home,'.sol/installation.json')));assert.equal(Object.hasOwn(installed.files,`${oc}/opencode.jsonc`),false);
  const index=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json')));const restore=new Map(index.files.map(x=>[x.path,x]));
  for(const [relative,bytes] of [[`${oc}/opencode.jsonc`,original],[`${oc}/sol-install.json`,oldManifest],[`${oc}/agents/sol.md`,'old agent edited']]){const rec=restore.get(relative);assert.ok(rec,relative);assert.equal(fs.readFileSync(path.join(home,rec.backup),'utf8'),bytes);assert.equal(rec.sha256,sha256(bytes));}
  assert.equal(fs.statSync(result.recovery).mode&0o777,0o700);assert.equal(fs.statSync(path.join(result.recovery,'recovery.json')).mode&0o777,0o600);
  for(const item of index.files)assert.equal(fs.statSync(path.join(home,item.backup)).mode&0o777,0o600,item.backup);
  assert.equal(result.removed,2,'solo loader y manifest legacy; la config se edita, no se cuenta como retirada');
  assert.equal(install(options(home)).configChanges,0);
});

test('Migración dry-run no escribe ni crea directorios; conserva archivos .sol desconocidos',t=>{
  const home=temp(t),oc='.config/opencode',pkg='/outside/legacy',plugin=`file://${pkg}/dist/v2/plugin.js`;
  const put=(r,v)=>{const p=path.join(home,r);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);return p;};
  const loader=`module.exports = {\n  id: "sol",\n  async server(input, options) {\n    const plugin = await import(${JSON.stringify(plugin)});\n    options = { nodeExecutable: "node", ...options };\n    return plugin.SolPlugin(input, options);\n  },\n};\n`;
  put(`${oc}/plugins/sol.js`,loader);const config=`{"default_agent":"sol","model":"untouched/model"}`;put(`${oc}/opencode.json`,config);put('.sol/store.db','preserve');
  const snapshot=()=>{const out={};const walk=(dir,rel='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const r=rel?`${rel}/${e.name}`:e.name,p=path.join(dir,e.name);out[r]=e.isDirectory()?'dir':sha256(fs.readFileSync(p));if(e.isDirectory())walk(p,r);}};walk(home);return out;};
  const before=snapshot(),preview=install({...options(home),dryRun:true});assert.deepEqual(snapshot(),before);assert.deepEqual(preview.legacy,['loader-v1']);assert.deepEqual(preview.configPaths,[`${oc}/opencode.json`,`${oc}/opencode.jsonc`]);assert.deepEqual(preview.removals,[`${oc}/plugins/sol.js`]);
  install(options(home));assert.equal(fs.readFileSync(path.join(home,'.sol/store.db'),'utf8'),'preserve');
  assert.throws(()=>{put(`${oc}/plugins/sol/user.js`,'unregistered user file');install(options(home));},/Colisión con plugin no administrado/);
  assert.equal(fs.readFileSync(path.join(home,'.sol/store.db'),'utf8'),'preserve');assert.equal(fs.readFileSync(path.join(home,`${oc}/plugins/sol/user.js`),'utf8'),'unregistered user file');
});

test('Legacy file idéntico a recurso V2 sigue siendo administrado, no borrowed',t=>{
  const base=temp(t);install(options(base));const agentBytes=fs.readFileSync(path.join(base,'.config/opencode/agents/sol.md'));
  const home=temp(t),oc='.config/opencode',pkg='/outside/old-sol',plugin=`file://${pkg}/dist/v2/plugin.js`,agent=path.join(fs.realpathSync(home),oc,'agents/sol.md');
  const put=(r,v)=>{const p=path.join(home,r);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);return p;};
  put(`${oc}/agents/sol.md`,agentBytes);put(`${oc}/opencode.json`,'{"default_agent":"sol","plugin":["'+plugin+'"]}');
  const manifest={version:2,packageRoot:pkg,configPath:path.join(fs.realpathSync(home),oc,'opencode.json'),pluginSpec:plugin,files:[{path:agent,installedHash:sha256(agentBytes)}]};
  put(`${oc}/sol-install.json`,JSON.stringify(manifest));
  const result=install(options(home));const current=JSON.parse(fs.readFileSync(path.join(home,'.sol/installation.json')));
  assert.deepEqual(current.borrowed,[]);assert.ok(current.files[`${oc}/agents/sol.md`]);assert.equal(result.removed,1,'solo se retira el manifiesto; la config se edita y el agente sigue gestionado');
  const removed=uninstall({homeDir:home,env:{}});assert.equal(removed.uninstalled,true);assert.equal(fs.existsSync(path.join(home,`${oc}/agents/sol.md`)),false);
});

test('Uninstall respalda y elimina versión editada de un recurso Sol reconocido',t=>{
  const home=temp(t);install(options(home));const f=path.join(home,'.config/opencode/agents/sol.md');fs.appendFileSync(f,'\nmy edit');
  const result=uninstall({homeDir:home,env:{}});assert.equal(fs.existsSync(f),false);
  const index=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json'))),item=index.files.find(x=>x.path==='.config/opencode/agents/sol.md');
  assert.ok(item);assert.match(fs.readFileSync(path.join(home,item.backup),'utf8'),/my edit/);
});

test('Preparación core idempotente conserva contexto del proyecto',t=>{
  const project=temp(t);assert.equal(prepareWorkspace(project).existingWorkspace,false);fs.writeFileSync(path.join(project,'.sol/project.md'),'Contexto confirmado');
  assert.equal(prepareWorkspace(project).existingWorkspace,true);assert.equal(fs.readFileSync(path.join(project,'.sol/project.md'),'utf8'),'Contexto confirmado');
  for(const file of ['installation.json','lib','templates','schemas','bin'])assert.equal(fs.existsSync(path.join(project,'.sol',file)),false);
});

test('Actualización migra solo archivos propios registrados de instalaciones previas',t=>{
  const home=temp(t);install(options(home));const manifestPath=path.join(home,'.sol/installation.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
  const legacy={'.sol/bin/sol.mjs':'old-cli','.agents/skills/sol-init/SKILL.md':'old-skill'};
  for(const [file,content] of Object.entries(legacy)){const target=path.join(home,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);manifest.files[file]=sha256(content);}
  manifest.runtimes=['both'];manifest.version='3.0.3';fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  install(options(home));for(const file of Object.keys(legacy))assert.equal(fs.existsSync(path.join(home,file)),false,file);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath)).runtimes,['opencode-v2']);
});

test('Uninstall elimina solo integración global y conserva datos del workspace',t=>{
  const home=temp(t),project=temp(t);install(options(home));prepareWorkspace(project);const state=fs.readFileSync(path.join(project,'.sol/state.json'));
  const result=uninstall({homeDir:home,env:{}});assert.equal(result.uninstalled,true);assert.equal(fs.existsSync(path.join(home,'.config/opencode/plugins/sol/index.ts')),false);assert.equal(fs.existsSync(path.join(home,'.sol/installation.json')),false);
  assert.ok(result.recovery);const recovery=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json'),'utf8'));assert.ok(recovery.files.some(x=>x.path==='.config/opencode/plugins/sol/index.ts'));assert.equal(fs.readFileSync(path.join(home,recovery.files.find(x=>x.path==='.config/opencode/plugins/sol/index.ts').backup),'utf8').length>0,true);
  assert.deepEqual(fs.readFileSync(path.join(project,'.sol/state.json')),state);
});
