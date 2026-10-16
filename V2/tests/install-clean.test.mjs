import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install,VERSION} from '../lib/install.mjs';
import {sha256} from '../lib/fs.mjs';
import {parseJSONC} from '../lib/jsonc.mjs';
import {temp} from './helpers.mjs';

const options=homeDir=>({homeDir,env:{},probeVersion:()=> 'opencode v2.0.20'});
const oc='.config/opencode';
function put(home,relative,data){const dest=path.join(home,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);return dest;}
function recovery(home,result){return JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json'),'utf8')).files.map(entry=>({...entry,bytes:fs.readFileSync(path.join(home,entry.backup))}));}

test('clean upgrade removes only owned stale payload, merges complementary config and reports loaded versus installed identity',async t=>{
  const home=temp(t);const initial=install(options(home));
  const manifestPath=path.join(home,'.sol/installation.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
  const stale='.sol/lib/retired-sol.mjs',edited=`${oc}/agents/sol.md`;
  put(home,stale,'retired code');manifest.files[stale]=sha256('retired code');manifest.version='2.0.0';
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));fs.appendFileSync(path.join(home,edited),'\nlocal prior edit');
  put(home,'.sol/work/keep/work.json','keep global work');put(home,'projects/example/.sol/state.json','keep project state');put(home,'.sol/user-note.md','unowned note');
  const json='{"model":"vendor/main","provider":{"a":{"options":{"apiKey":"fixture-only-secret"}}},"agents":{"outside":{"model":"vendor/custom"},"sol":{"model":"vendor/my-sol"}}}';
  const jsonc='{// keep JSONC comment\n"mcp":{"outside":{"url":"https://example.test"}},"provider":{"b":{"name":"Other"}}}';
  put(home,`${oc}/opencode.json`,json);put(home,`${oc}/opencode.jsonc`,jsonc);
  const preview=install({...options(home),dryRun:true});assert.ok(preview.removals.includes(stale));assert.equal(fs.readFileSync(path.join(home,`${oc}/opencode.json`),'utf8'),json);
  const result=install(options(home));assert.equal(result.version,VERSION);assert.equal(result.buildInfo.buildHash,initial.buildInfo.buildHash);
  assert.equal(fs.existsSync(path.join(home,stale)),false);assert.doesNotMatch(fs.readFileSync(path.join(home,edited),'utf8'),/local prior edit/);
  assert.equal(fs.existsSync(path.join(home,`${oc}/opencode.json`)),false);
  const output=fs.readFileSync(path.join(home,`${oc}/opencode.jsonc`),'utf8'),config=parseJSONC(output);
  assert.match(output,/keep JSONC comment/);assert.equal(config.provider.a.options.apiKey,'fixture-only-secret');assert.equal(config.model,'vendor/main');assert.equal(config.agents.outside.model,'vendor/custom');assert.equal(config.agents.sol.model,'vendor/my-sol');assert.equal(result.preservedModels,true);assert.deepEqual(result.modelChanges,[]);assert.equal(config.mcp.outside.url,'https://example.test');
  for(const [relative,expected] of [['.sol/work/keep/work.json','keep global work'],['projects/example/.sol/state.json','keep project state'],['.sol/user-note.md','unowned note']])assert.equal(fs.readFileSync(path.join(home,relative),'utf8'),expected);
  const backups=recovery(home,result);for(const relative of [stale,edited,`${oc}/opencode.json`,`${oc}/opencode.jsonc`])assert.ok(backups.some(x=>x.path===relative),relative);
  assert.equal(backups.find(x=>x.path===`${oc}/opencode.json`).bytes.toString(),json);
  const version=await import(pathToFileURL(path.join(home,'.sol/lib/version.mjs')).href);
  const loaded=version.getSolVersionInfo();assert.equal(loaded.buildHash,result.buildInfo.buildHash);assert.equal(loaded.sourceCommit,null);
  assert.deepEqual(version.getInstalledSolVersionInfo({homeDir:home}),loaded);
  const current=JSON.parse(fs.readFileSync(manifestPath));current.version='99.0.0';current.buildHash='f'.repeat(64);fs.writeFileSync(manifestPath,JSON.stringify(current));
  assert.equal(version.getSolVersionInfo().version,VERSION);assert.equal(version.getInstalledSolVersionInfo({homeDir:home}).version,'99.0.0');
  assert.equal(install(options(temp(t))).buildInfo.buildHash,loaded.buildHash,'build identity does not depend on HOME');
});

test('recognized legacy migration rolls back payload and both configs if final manifest commit fails',t=>{
  const home=temp(t),pkg='/outside/old-sol',spec=`file://${pkg}/dist/v2/plugin.js`;
  const loader=`export default {id:'sol',async server(){const plugin=await import('${spec}');return plugin.SolPlugin();}};`;
  const json=JSON.stringify({plugin:[spec],mcp:{sol:{type:'local',command:['node',`${pkg}/dist/v2/mcp.js`]}},auth:{token:'fixture-only-secret'}});
  const jsonc='{// keep\n"model":"vendor/keep","mcp":{"outside":{"url":"stay"}}}';
  const originals=new Map([[`${oc}/plugins/sol.js`,loader],[`${oc}/opencode.json`,json],[`${oc}/opencode.jsonc`,jsonc]]);
  for(const [file,bytes] of originals)put(home,file,bytes);
  const rename=fs.renameSync,manifestPath=path.join(fs.realpathSync(home),'.sol/installation.json');let failed=false;
  fs.renameSync=function(from,to,...args){if(!failed&&path.resolve(String(to))===manifestPath){failed=true;throw Object.assign(new Error('fixture final write failure'),{code:'EIO'});}return rename.call(this,from,to,...args);};
  try{assert.throws(()=>install(options(home)),/archivos gestionados restaurados/);}finally{fs.renameSync=rename;}
  assert.equal(failed,true,'fault injection must hit the final manifest rename through the real installer path');for(const [file,bytes] of originals)assert.equal(fs.readFileSync(path.join(home,file),'utf8'),bytes);
  for(const relative of ['.sol/release.json','.sol/installation.json',`${oc}/plugins/sol/index.ts`])assert.equal(fs.existsSync(path.join(home,relative)),false,relative);
  const result=install(options(home));assert.deepEqual(result.legacy,['loader-v1']);assert.equal(fs.existsSync(path.join(home,`${oc}/plugins/sol.js`)),false);
  const config=parseJSONC(fs.readFileSync(path.join(home,`${oc}/opencode.jsonc`),'utf8'));assert.equal(config.auth.token,'fixture-only-secret');assert.equal(config.mcp.sol,undefined);assert.equal(config.mcp.outside.url,'stay');assert.deepEqual(config.plugin,[]);
});

test('conflicting config values and unrecognized Sol loaders fail without exposing values or writing',t=>{
  const home=temp(t);put(home,`${oc}/opencode.json`,'{"auth":{"token":"fixture-secret-one"}}');put(home,`${oc}/opencode.jsonc`,'{"auth":{"token":"fixture-secret-two"}}');
  assert.throws(()=>install(options(home)),error=>{assert.match(error.message,/Conflicto.*opencode.json/);assert.doesNotMatch(error.message,/fixture-secret/);return true;});assert.equal(fs.existsSync(path.join(home,'.sol')),false);
  const other=temp(t);put(other,`${oc}/plugins/sol.js`,'user-owned plugin');assert.throws(()=>install(options(other)),/Integración anterior no registrada/);assert.equal(fs.readFileSync(path.join(other,`${oc}/plugins/sol.js`),'utf8'),'user-owned plugin');assert.equal(fs.existsSync(path.join(other,'.sol')),false);
});
