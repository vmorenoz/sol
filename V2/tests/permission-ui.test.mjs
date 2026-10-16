import test from 'node:test';
import assert from 'node:assert/strict';
import {createPermissionPresenter} from '../plugins/opencode-v2/permission-ui.mjs';
import {permissionBridgeDefinition} from '../plugins/opencode-v2/permission-bridge.mjs';

function fixture(){
 const input={sessionID:'ses_parent',requestID:'per_exact',nonce:'nonce_exact'},location={directory:'/project'};
 const descriptor={sessionID:input.sessionID,id:input.requestID,agent:'sol',action:'sol_workspace_prepare',resources:['/project'],save:[],source:{type:'tool',messageID:'msg_exact',id:'call_exact'},metadata:{solPermission:{nonce:input.nonce,inputSha256:'exact_hash',callID:'call_exact'},input:{scope:'exact input'}}};
 const calls={describe:[],cancel:[],create:[]},listeners=new Map();let requested;
 const rpc={async describe(...args){calls.describe.push(args);return descriptor;},async cancel(...args){calls.cancel.push(args);return true;},events:{on(name,fn){assert.equal(name,'requested');requested=fn;return()=>{requested=null;};}}};
 const ctx={client:{rpc(definition){assert.equal(definition,permissionBridgeDefinition);return rpc;},permission:{async create(value){calls.create.push(value);return {id:value.id,effect:'ask'};}}},data:{on(name,fn){listeners.set(name,fn);return()=>listeners.delete(name);}}};
 const presenter=createPermissionPresenter(ctx);
 return {ctx,rpc,descriptor,input,location,calls,listeners,presenter,emit:()=>requested?.({data:input,location})};
}

test('permission UI forwards the unchanged server descriptor through native permission create',async()=>{const f=fixture();await f.emit();assert.equal(f.calls.create[0],f.descriptor);assert.deepEqual(f.calls.describe,[[f.input,{location:f.location}]]);assert.equal(f.calls.cancel.length,0);f.listeners.get('permission.replied')({data:{sessionID:f.input.sessionID,requestID:f.input.requestID,reply:'once'}});f.presenter.dispose();assert.equal(f.calls.cancel.length,0);});
test('duplicate RPC events create only one native request',async()=>{const f=fixture();await Promise.all([f.emit(),f.emit()]);assert.equal(f.calls.describe.length,1);assert.equal(f.calls.create.length,1);f.presenter.dispose();});
test('a request claimed by another interface is left alone',async()=>{const f=fixture();f.rpc.describe=async()=>null;await f.emit();f.presenter.dispose();assert.equal(f.calls.create.length,0);assert.equal(f.calls.cancel.length,0);});
test('a mismatched descriptor is denied without being presented',async()=>{const f=fixture();f.descriptor.id='per_wrong';await f.emit();assert.equal(f.calls.create.length,0);assert.equal(f.calls.cancel.length,1);assert.equal(f.calls.cancel[0][0].requestID,'per_exact');f.presenter.dispose();});
for(const effect of ['allow','deny'])test(`unexpected native ${effect} cannot approve through RPC`,async()=>{const f=fixture();f.ctx.client.permission.create=async()=>({effect,id:f.descriptor.id});await f.emit();assert.equal(f.calls.cancel.length,1);assert.equal(Object.hasOwn(f.calls.cancel[0][0],'approved'),false);f.presenter.dispose();});
test('native create errors cancel once without retries',async()=>{const f=fixture();let count=0;f.ctx.client.permission.create=async()=>{count++;throw new Error('disconnected');};await f.emit();assert.equal(count,1);assert.equal(f.calls.cancel.length,1);f.presenter.dispose();});
test('dispose cancels waiting approval and unsubscribes; unrelated replies never settle it',async()=>{const f=fixture();await f.emit();f.listeners.get('permission.replied')({data:{sessionID:f.input.sessionID,requestID:'per_other',reply:'once'}});f.presenter.dispose();f.presenter.dispose();assert.equal(f.calls.cancel.length,1);assert.equal(f.listeners.size,0);});
test('dispose during describe cannot create a permission after closing',async()=>{const f=fixture();let release;f.rpc.describe=()=>new Promise(r=>release=r);const pending=f.emit();f.presenter.dispose();release(f.descriptor);await pending;assert.equal(f.calls.create.length,0);assert.equal(f.calls.cancel.length,1);});
test('location shutdown fails pending requests closed',async()=>{const f=fixture();await f.emit();f.listeners.get('location.shutdown')({data:{}});assert.equal(f.calls.cancel.length,1);f.presenter.dispose();assert.equal(f.calls.cancel.length,1);});
test('read-only CLI remains loadable without permission bridge capabilities',()=>{createPermissionPresenter({}).dispose();});

test('TUI registers only init and version slashes; cancellation stays in the palette',async()=>{
 const {default:fs}=await import('node:fs');const {default:os}=await import('node:os');const {default:path}=await import('node:path');const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');const {preparePluginVersionFixture}=await import('./plugin-fixture.mjs');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=fs.mkdtempSync(path.join(os.tmpdir(),'sol-tui-permission-'));
 try{
  preparePluginVersionFixture(home);
  const source=`import tui from ${JSON.stringify(path.join(root,'plugins/opencode-v2/tui.ts'))};let commands;const alerts=[];const dispose=await tui.setup({app:{version:'2.0.24'},keymap:{layer(factory){commands=factory().commands;}},ui:{router:{current:()=>({type:'home'})},dialog:{alert:async input=>alerts.push(input)}}});if(commands.filter(c=>c.slash).map(c=>c.slash.name).sort().join(',')!=='sol-init,sol-version')throw Error('unexpected slash');const cancel=commands.find(c=>c.id==='sol.init.cancel');if(!cancel?.palette||cancel.slash)throw Error('cancel is not palette only');await commands.find(c=>c.id==='sol.version').run();if(!alerts[0].message.includes('Sol cargado'))throw Error('version not available');await cancel.run();dispose();`;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('TUI accepts the documented OpenCode v2 session route and keeps the legacy structural form compatible',async()=>{
 const {default:fs}=await import('node:fs');const {default:os}=await import('node:os');const {default:path}=await import('node:path');const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=fs.mkdtempSync(path.join(os.tmpdir(),'sol-tui-route-'));
 try{
  const source=`import {sessionIDFromRoute} from ${JSON.stringify(path.join(root,'plugins/opencode-v2/tui.ts'))};const result=[sessionIDFromRoute({name:'session',params:{sessionID:'new-session'}}),sessionIDFromRoute({type:'session',sessionID:'existing-session'}),sessionIDFromRoute({name:'home'}),sessionIDFromRoute({name:'session',params:{}})];console.log(JSON.stringify(result));`;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.deepEqual(JSON.parse(result.stdout),['new-session','existing-session',null,null]);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('dispose rejects its exact pending native request without sending approval',async()=>{const f=fixture();const replies=[];f.ctx.client.permission.reply=async input=>replies.push(input);await f.emit();f.presenter.dispose();await new Promise(r=>setImmediate(r));assert.deepEqual(replies,[{sessionID:f.input.sessionID,requestID:f.input.requestID,decision:'reject'}]);});
test('dispose while create is in flight rejects the late native prompt',async()=>{const f=fixture();let release;const replies=[];f.ctx.client.permission.create=()=>new Promise(r=>release=r);f.ctx.client.permission.reply=async input=>replies.push(input);const pending=f.emit();await new Promise(r=>setImmediate(r));f.presenter.dispose();release({effect:'ask',id:f.input.requestID});await pending;assert.equal(replies.length,1);assert.equal(replies[0].decision,'reject');assert.equal(f.calls.cancel.length,1);});
