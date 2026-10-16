import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {observeShippingGit} from '../lib/shipping-snapshot.mjs';

const request={remote:'origin',base:'main',expectedPaths:[]},work={id:'DIAGNOSTIC'};
function directory(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sol snapshot spaces ')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
function observe(root){return observeShippingGit({sessionRoot:root,request,work});}
function diagnostic(run){
  let error;try{run();}catch(caught){error=caught;}
  assert.ok(error instanceof Error,'observation must fail closed');
  assert.match(error.message,/^Snapshot Git readonly incompleto \([a-z-]+\)\. /);
  assert.ok(error.message.length<2000);
  return JSON.parse(error.message.slice(error.message.indexOf('{')));
}
function mockGit(t,root,failAt,failure){
  const calls=[];
  t.mock.method(childProcess,'spawnSync',(command,argv,options)=>{
    assert.equal(command,'/usr/bin/env');assert.equal(options.encoding,null);
    const args=argv.slice(argv.indexOf('--no-optional-locks')+1);calls.push({args,cwd:options.cwd});
    if(calls.length===failAt)return failure;
    let stdout='';
    if(args[0]==='rev-parse')stdout=args[1]==='--show-toplevel'?root:'a'.repeat(40);
    if(args[0]==='branch')stdout='main';
    if(args[0]==='remote')stdout='https://github.com/owner/repo.git';
    return {status:0,signal:null,stdout:Buffer.from(stdout),stderr:Buffer.alloc(0)};
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  return calls;
}

for(const [operation,call] of [['root',1],['HEAD',3],['base',6],['remote.fetch-url',4],['remote.push-url',5],['status',7],['diff.commit-paths',9]]){
  test(`Git failure identifies ${operation} and its actual cwd`,t=>{
    const root=directory(t);
    const calls=mockGit(t,root,call,{status:128,signal:null,stderr:Buffer.from('fatal: Needed a single revision\n')});
    const detail=diagnostic(()=>observe(root));
    assert.equal(detail.operation,operation);assert.equal(detail.cwd,calls.at(-1).cwd);
    assert.equal(detail.cwd,root);assert.equal(detail.status,128);assert.equal(detail.signal,null);
    assert.match(detail.stderr,/Needed a single revision/);assert.equal('code' in detail,false);
  });
}

for(const result of [
  {status:null,signal:null,error:{code:'ENOENT',message:'do not expose error message'}},
  {status:null,signal:'SIGTERM',error:{code:'ETIMEDOUT'}},
  {status:null,signal:'SIGKILL'},
  {error:{code:'ENOBUFS'}},
  {status:0,error:{code:'EACCES'}},
  {exitCode:0}
]){
  test(`process failure stays closed with ${JSON.stringify(result)}`,t=>{
    const root=directory(t);mockGit(t,root,1,result);
    const detail=diagnostic(()=>observe(root));
    for(const field of ['status','signal'])assert.equal(Object.hasOwn(detail,field),Object.hasOwn(result,field));
    if('status' in result)assert.equal(detail.status,result.status);
    if('signal' in result)assert.equal(detail.signal,result.signal);
    assert.equal(detail.code,result.error?.code);assert.equal('stderr' in detail,false);
    assert.equal(JSON.stringify(detail).includes('do not expose'),false);
  });
}

test('stderr is bounded, strips arbitrary secrets, URLs and terminal controls',t=>{
  const root=directory(t);
  const sensitive='https://user:password@example.invalid/private?token=opaque ghp_1234567890 API_KEY=opaque bearer-token \x1b[31m\x00\u202e';
  mockGit(t,root,1,{status:128,signal:null,stderr:Buffer.from(`fatal: ambiguous argument '${sensitive}': unknown revision or path not in the working tree\n${sensitive.repeat(10000)}`)});
  const detail=diagnostic(()=>observe(root));
  assert.match(detail.stderr,/ambiguous argument/);assert.match(detail.stderr,/raw stderr omitted/);
  assert.ok(detail.stderr.length<512);
  assert.doesNotMatch(JSON.stringify(detail),/password|example|opaque|ghp_|API_KEY|bearer|\\u001b|\\u0000|\u202e/);
});

test('unknown/localized stderr is withheld rather than echoed',t=>{
  const root=directory(t);mockGit(t,root,1,{status:1,stderr:'fallo: credencial sin formato reconocible'});
  assert.equal(diagnostic(()=>observe(root)).stderr,'unrecognized stderr [raw stderr omitted]');
});

test('sensitive cwd components are redacted, normal spaces preserved',t=>{
  const root=directory(t),nested=path.join(root,'token=private-value','normal space');fs.mkdirSync(nested,{recursive:true});
  mockGit(t,root,1,{status:128,stderr:Buffer.alloc(0)});
  const detail=diagnostic(()=>observe(nested));
  assert.equal(detail.cwd,path.join(root,'[redacted]','normal space'));
});

test('real Git distinguishes non-repository and unborn HEAD in a directory with spaces',t=>{
  const root=directory(t);
  const before=diagnostic(()=>observe(root));assert.equal(before.operation,'root');assert.equal(before.cwd,root);
  const init=childProcess.spawnSync('/usr/bin/env',['git','init','--quiet',root],{encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  const after=diagnostic(()=>observe(root));assert.equal(after.operation,'HEAD');assert.equal(after.cwd,root);
  assert.equal(after.status,128);
});

test('diagnostic bounds a simulated long cwd and removes control characters',t=>{
  const root=directory(t),nested=path.join(root,'\x1b[31mcolored\u202e',...Array(35).fill('ordinary-directory-with-spaces here'));
  // macOS PATH_MAX prevents creating this fixture; only the length case uses
  // a simulated resolved path. The spaces/repository test above uses real Git.
  t.mock.method(fs,'realpathSync',()=>nested);
  const calls=mockGit(t,root,1,{status:128,signal:'PRIVATE_TOKEN',error:{code:'SECRET_VALUE'}});
  const detail=diagnostic(()=>observe(nested));
  assert.equal(calls[0].cwd,nested);
  assert.equal(detail.cwd.length,1000);assert.match(detail.cwd,/colored\?/);
  assert.doesNotMatch(detail.cwd,/[\x00-\x1f\x7f-\x9f\u202e]/);
  assert.equal(detail.signal,'[omitted]');assert.equal(detail.code,'[omitted]');
});

test('unknown publication observation remains unknown, not a successful publication',t=>{
  const root=directory(t);mockGit(t,root,13,{status:null,signal:'SIGTERM',error:{code:'ETIMEDOUT'}});
  const snapshot=observe(root);
  assert.equal(snapshot.publishedHeadSha,null);assert.equal(snapshot.unpublishedCommitShas,null);
  assert.equal(snapshot.publicationObservation,'local_remote_tracking_ref_only');
});

function synchronousDiagnostic(run,operation,cwd){
  let caught;
  const detail=diagnostic(()=>{try{run();}catch(error){caught=error;throw error;}});
  assert.deepEqual(detail,{operation,cwd,code:'ERR_INVALID_ARG_VALUE'});
  assert.equal(caught.cause,undefined);
  assert.doesNotMatch(caught.message+'\n'+caught.stack,/user:password|example\.invalid|private-token|original-stack|argv|\\u0000/);
}

test('synchronous spawn exception uses safe diagnostic without original error or process facts',t=>{
  const root=directory(t);
  t.mock.method(childProcess,'spawnSync',()=>{
    const error=new TypeError('argv https://user:password@example.invalid/private-token\0');
    error.code='ERR_INVALID_ARG_VALUE';error.stack='original-stack '+error.message;
    // These are not observed process fields and must not be copied from a throw.
    error.status=128;error.signal='SIGTERM';error.stderr=Buffer.from(error.message);
    throw error;
  });
  syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  synchronousDiagnostic(()=>observe(root),'root',root);
});

test('real spawnSync rejects NUL base without exposing its credential URL',t=>{
  const root=directory(t);
  const git=args=>{
    const result=childProcess.spawnSync('/usr/bin/env',['git',...args],{cwd:root,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});
    assert.equal(result.status,0,result.stderr);
  };
  // All writes are confined to the disposable repository; no network involved.
  git(['init','--quiet','-b','main']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','--allow-empty','-m','fixture']);
  git(['remote','add','origin','https://github.com/owner/repo.git']);
  synchronousDiagnostic(()=>observeShippingGit({sessionRoot:root,request:{...request,base:'https://user:password@example.invalid/private-token\0'},work}),'base',root);
});
