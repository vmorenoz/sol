import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createInitSessionResolver} from '../plugins/opencode-v2/init-session.mjs';

test('reuses an existing session ID; production dispatcher remains responsible for its Sol-agent guard',async()=>{
  const resolve=createInitSessionResolver({client:{},router:{current:()=>({type:'session',sessionID:'ses-existing'})},location:{directory:fs.realpathSync(os.tmpdir())}});
  assert.equal(await resolve({type:'session',sessionID:'ses-existing'}),'ses-existing');
});

test('home creates once with explicit Sol agent, verifies host session, then navigates and returns ID',async()=>{
  const calls=[];
  const directory=fs.realpathSync(os.tmpdir());
  const session={id:'ses-home',agent:'sol',location:{directory}};
  let route={type:'home'};
  const client={session:{
    create:async input=>{calls.push(['create',input]);await new Promise(r=>setTimeout(r,5));return session;},
    get:async input=>{calls.push(['get',input]);return session;},
  }};
  const router={current:()=>route,navigate:next=>{calls.push(['navigate',next]);route=next;}};
  const resolve=createInitSessionResolver({client,router,location:{directory}});
  const ids=await Promise.all([resolve({type:'home'}),resolve({type:'home'})]);
  assert.deepEqual(ids,['ses-home','ses-home']);
  assert.equal(calls.filter(x=>x[0]==='create').length,1);
  assert.deepEqual(calls[0],['create',{agent:'sol',location:{directory}}]);
  assert.deepEqual(calls.at(-1),['navigate',{type:'session',sessionID:'ses-home'}]);
});

test('rejects unknown routes and does not create a session',async()=>{
  let creates=0;
  const resolve=createInitSessionResolver({client:{session:{create:async()=>{creates++;}}},router:{navigate(){}},location:{directory:'/fixture'}});
  await assert.rejects(resolve({type:'plugin',name:'anything'}),/Inicio/);
  assert.equal(creates,0);
});

test('rejects a created session whose actual agent or root differs from the requested identity',async()=>{
  const directory=fs.realpathSync(os.tmpdir());
  for(const session of [
    {id:'ses-x',agent:'build',location:{directory}},
    {id:'ses-x',agent:'sol',location:{directory:fs.realpathSync(os.homedir())}},
  ]) {
    let navigations=0;
    const resolve=createInitSessionResolver({client:{session:{create:async()=>({id:'ses-x'}),get:async()=>session}},router:{current:()=>({type:'home'}),navigate(){navigations++;}},location:{directory}});
    await assert.rejects(resolve({type:'home'}),/no coincide/);
    assert.equal(navigations,0);
  }
});

test('gets current default location at invocation when ctx.location is undefined',async()=>{
  const directory=fs.realpathSync(os.tmpdir());let route={type:'home'},defaults=0;
  const resolve=createInitSessionResolver({client:{session:{create:async input=>({id:'ses-default'}),get:async()=>({id:'ses-default',agent:'sol',location:{directory}})}},router:{current:()=>route,navigate:r=>{route=r;}},location:()=>{defaults++;return {directory};}});
  assert.equal(await resolve({type:'home'}),'ses-default');assert.equal(defaults,1);
});

test('does not navigate or dispatch into a route the user left during create',async()=>{
  const directory=fs.realpathSync(os.tmpdir());let route={type:'home'},release;
  const created=new Promise(r=>release=r);let navigations=0;
  const resolve=createInitSessionResolver({client:{session:{create:async()=>{await created;return {id:'ses-race'};},get:async()=>({id:'ses-race',agent:'sol',location:{directory}})}},router:{current:()=>route,navigate(){navigations++;}},location:{directory}});
  const pending=resolve({type:'home'});route={type:'plugin',name:'other'};release();
  await assert.rejects(pending,/navegación cambió/);assert.equal(navigations,0);
});

test('retains a created ID after get failure and retries verification without creating a duplicate',async()=>{
  const directory=fs.realpathSync(os.tmpdir());let route={type:'home'},creates=0,gets=0,navigations=0;
  const resolve=createInitSessionResolver({client:{session:{create:async()=>{creates++;return {id:'ses-retry'};},get:async()=>{if(++gets===1)throw new Error('temporary');return {id:'ses-retry',agent:'sol',location:{directory}};}}},router:{current:()=>route,navigate:r=>{navigations++;route=r;}},location:{directory}});
  await assert.rejects(resolve({type:'home'}),/temporary/);
  assert.equal(await resolve({type:'home'}),'ses-retry');assert.equal(creates,1);assert.equal(navigations,1);
});

test('after successful navigation and returning home, a new explicit init creates a fresh session',async()=>{
  const directory=fs.realpathSync(os.tmpdir());let route={type:'home'},creates=0;
  const router={current:()=>route,navigate:r=>{route=r;}};
  const client={session:{
    create:async()=>({id:`ses-${++creates}`}),
    get:async({sessionID})=>({id:sessionID,agent:'sol',location:{directory}}),
  }};
  const resolve=createInitSessionResolver({client,router,location:{directory}});
  assert.equal(await resolve({type:'home'}),'ses-1');
  route={type:'home'};
  assert.equal(await resolve({type:'home'}),'ses-2');
  assert.equal(creates,2);
});
