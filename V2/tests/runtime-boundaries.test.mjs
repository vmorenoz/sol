import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {composeNativeFiles} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Exercise the actual adapter/registration code in memory. Only installation paths,
// version identity and the side-effect backend are replaced; this is not a live host.
async function fixture({agent='sol',abortAt}={}) {
  const controller=new AbortController(), registered=new Map(), hooks=new Map();
  let effects=0, sessionReads=0;
  const key=`audit_${crypto.randomUUID().replaceAll('-','')}`;
  globalThis[key]=async()=>{if(abortAt==='import')controller.abort();return {prepareWorkspace(){effects++;return {existingWorkspace:false};}};};
  let source=fs.readFileSync(path.join(root,'plugins/opencode-v2/index.ts'),'utf8');
  source=source.replace('import { createVersionReader } from "./version-view.mjs"','const createVersionReader = async () => () => "fixture"');
  source=source.replace('"./permission-bridge.mjs"',JSON.stringify(new URL('../plugins/opencode-v2/permission-bridge.mjs',import.meta.url).href));
  source=source.replace('"./work-views.mjs"',JSON.stringify(new URL('../plugins/opencode-v2/work-views.mjs',import.meta.url).href));
  source=source.replace('const core = async (name: string) => import(pathToFileURL(path.join(solRoot, name)).href)',`const core = globalThis.${key}`);
  source=source.replaceAll('path.join(os.homedir(), ".sol", "schemas",',`path.join(${JSON.stringify(root)}, "schemas",`);
  const plugin=(await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'))).default;
  const session={id:'ses_test',agent,location:{directory:'/fixture'}};
  await plugin.setup({permission:{hook:async(name,callback)=>hooks.set(name,callback)},tool:{transform:async edit=>edit({add:tool=>registered.set(tool.name,tool)})},session:{get:async()=>{sessionReads++;if(abortAt==='session')controller.abort();return session;}}});
  delete globalThis[key];
  return {session,hooks,registered,stats:()=>({effects,sessionReads}),call:(name,args={})=>registered.get(name).execute(args,{sessionID:'ses_test',agent,id:'call_test',messageID:'msg_test',signal:controller.signal})};
}

test('workspace tools reject non-Sol execution before reading session or touching backend',async()=>{
  const f=await fixture({agent:'build'}),result=await f.call('sol_workspace_prepare');
  assert.match(result.content,/requiere el agente Sol/);
  assert.deepEqual(f.stats(),{effects:0,sessionReads:0});
  assert.equal((await f.call('sol_version')).content,'fixture');
});
test('cancellation during session lookup or module import prevents mutations',async()=>{
  for(const abortAt of ['session','import']){
    const f=await fixture({abortAt}),result=await f.call('sol_workspace_prepare');
    assert.match(result.content,/cancelada/);assert.equal(f.stats().effects,0);
  }
  const f=await fixture();assert.match((await f.call('sol_workspace_prepare')).content,/preparó/);assert.equal(f.stats().effects,1);
});
test('host ask-dependent writes fail closed until a verified approval bridge exists',async()=>{
  const f=await fixture();
  for(const [name,args] of [['sol_ship_authorize',{}],['sol_config_apply',{dryRun:false}],['sol_artifacts_set',{dryRun:false}]])assert.match((await f.call(name,args)).content,/host sin RPC\/eventos de permisos compatibles/);
  assert.deepEqual(f.stats(),{effects:0,sessionReads:3});
});
test('initial-map permission hook only narrows and restricts edits to exact assigned output',async()=>{
  const f=await fixture();f.session.metadata={solInit:{output:'.sol/work/INIT/exploration/project.md'}};
  const hook=f.hooks.get('evaluate');
  const allowed={sessionID:'ses_test',action:'edit',resources:['.sol/work/INIT/exploration/project.md'],effect:'ask'};
  await hook(allowed);assert.equal(allowed.effect,'ask');
  for(const resource of ['.sol/project.md','src/product.ts','.sol/work/INIT/exploration/project.md/../other.md']){
    const event={...allowed,resources:[resource]};await hook(event);assert.equal(event.effect,'deny');
  }
  const delegate={...allowed,action:'subagent'};await hook(delegate);assert.equal(delegate.effect,'deny');
});
test('primary permissions cover root metadata and restrict delegation to known specialists',()=>{
  const files=composeNativeFiles({root}),text=files.get('.opencode/agents/sol.md');
  const permissions=JSON.parse(/^permissions: (.+)$/m.exec(text)[1]);
  assert.ok(permissions.some(r=>r.action==='edit'&&r.resource==='.sol/**'&&r.effect==='deny'));
  const rules=permissions.filter(r=>r.action==='subagent');
  assert.deepEqual(rules[0],{action:'subagent',resource:'*',effect:'deny'});
  assert.ok(rules.slice(1).every(r=>r.resource.startsWith('sol-')&&r.effect==='allow'));
  assert.equal(files.has('.opencode/commands/sol-init.md'),false);
});
