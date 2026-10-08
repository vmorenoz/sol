import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const SECRET=/(?:^|\/)(?:\.env(?:\.|$)|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)$/i;
const bookkeeping=id=>new Set([`.sol/work/${id}/work.json`,'.sol/state.json','.sol/history.jsonl']);
const clean=p=>typeof p==='string'&&p.length>0&&p.length<=1000&&!p.startsWith('/')&&!p.includes('\\')&&!/[\x00-\x1f]/.test(p)&&!p.split('/').some(s=>!s||s==='.'||s==='..');
const inside=(base,file)=>{const r=path.relative(base,file);return r===''||(!r.startsWith(`..${path.sep}`)&&r!=='..'&&!path.isAbsolute(r));};

function git(cwd,args,{allow1=false}={}){
  const result=spawnSync('/usr/bin/env',['git','-c','core.fsmonitor=false','-c','diff.external=','-c','core.pager=cat','--no-optional-locks',...args],{cwd,encoding:null,timeout:8000,maxBuffer:16*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',GIT_EXTERNAL_DIFF:''}});
  if(result.error||result.status!==0&&!(allow1&&result.status===1))throw new Error(`Snapshot Git readonly incompleto (${args[0]}).`);
  return result.stdout;
}
const text=(cwd,args,options)=>git(cwd,args,options).toString('utf8').replace(/[\r\n]+$/,'');
function decodeZ(buffer){return buffer.toString('utf8').split('\0').filter(Boolean);}
function remoteRepository(raw){
  const value=raw.trim().replace(/\/$/,'');
  const match=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  return match?`${match[1]}/${match[2]}`:null;
}
function canonicalFile(root,relative){
  if(!clean(relative)||SECRET.test(relative))throw new Error('Path inseguro o sensible en snapshot; no se leyó su contenido.');
  const requested=path.resolve(root,...relative.split('/'));
  if(!inside(root,requested))throw new Error('Path fuera del workspace.');
  let cursor=root;
  for(const part of relative.split('/')){
    cursor=path.join(cursor,part);
    const stat=fs.lstatSync(cursor);
    if(stat.isSymbolicLink())throw new Error('Symlink en path observado; requiere resolución manual.');
  }
  const real=fs.realpathSync(requested);
  if(!inside(root,real)||!fs.statSync(real).isFile())throw new Error('Path no es un archivo regular dentro del workspace.');
  return real;
}

/** Observe a Git workspace without mutating it or accepting caller-supplied Git facts. */
export function observeShippingGit({sessionRoot,request,work}={}){
  if(typeof sessionRoot!=='string'||!request||!work)throw new TypeError('sessionRoot, request y work son requeridos.');
  const workspace=fs.realpathSync(sessionRoot);
  const gitRoot=fs.realpathSync(text(workspace,['rev-parse','--show-toplevel']));
  if(!inside(gitRoot,workspace))throw new Error('La sesión no está dentro de la raíz Git observada.');
  const branch=text(workspace,['branch','--show-current']);
  const headSha=text(workspace,['rev-parse','--verify','HEAD']);
  if(!branch||! /^[a-f0-9]{40,64}$/.test(headSha))throw new Error('HEAD detached o inválido.');
  const remote=request.remote;
  if(typeof remote!=='string'||!/^[A-Za-z0-9_.-]{1,200}$/.test(remote))throw new Error('Remote solicitado inválido.');
  const fetchUrl=text(workspace,['remote','get-url',remote]);
  const pushUrl=text(workspace,['remote','get-url','--push',remote]);
  const repository=remoteRepository(fetchUrl),headRepository=remoteRepository(pushUrl);
  if(!repository||!headRepository||repository!==headRepository)throw new Error('Remote GitHub ambiguo o fork detectado; destino requiere revisión manual.');
  const base=request.base;
  if(typeof base!=='string'||!base||base.startsWith('-'))throw new Error('Base inválida.');
  const baseRef=`refs/remotes/${remote}/${base}`;
  const baseSha=text(workspace,['rev-parse','--verify',`${baseRef}^{commit}`]);
  if(!/^[a-f0-9]{40,64}$/.test(baseSha))throw new Error('Base remota local no resuelta; no se ejecuta fetch.');
  const status=decodeZ(git(workspace,['status','--porcelain=v1','-z','--untracked-files=all','--ignored=matching']));
  const paths=new Map();
  for(let i=0;i<status.length;i++){
    const record=status[i];
    if(record.length<4)throw new Error('Salida status Git truncada/malformada.');
    const code=record.slice(0,2),name=record.slice(3);
    if(code.includes('R')||code.includes('C')){if(!status[i+1])throw new Error('Renombre Git incompleto; snapshot bloqueado.');i++;}
    const previous=paths.get(name)||{path:name};
    previous.staged ||= code[0]!==' '&&code[0]!=='?'&&code[0]!=='!';
    previous.unstaged ||= code[1]!==' '&&code!=='??'&&code!=='!!';
    previous.untracked ||= code==='??';previous.ignored ||= code==='!!';paths.set(name,previous);
  }
  const changed=decodeZ(git(workspace,['diff','--name-only','-z','HEAD']));
  const workspacePrefix=path.relative(gitRoot,workspace).split(path.sep).filter(Boolean).join('/');
  const committedPaths=decodeZ(git(gitRoot,['diff','--name-only','-z',`${baseSha}...HEAD`]));
  const commitPaths=committedPaths.map(name=>{
    if(workspacePrefix&&name!==workspacePrefix&&!name.startsWith(`${workspacePrefix}/`))throw new Error('Hay commits locales que incluyen paths fuera del workspace de sesión.');
    return workspacePrefix?name.slice(workspacePrefix.length).replace(/^\//,''):name;
  });
  for(const name of [...paths.keys(),...changed,...commitPaths]){
    if(!clean(name)||SECRET.test(name))throw new Error('Path inseguro o potencialmente sensible observado; snapshot bloqueado.');
    canonicalFile(workspace,name);
  }
  const files=[];
  for(const name of request.expectedPaths||[])if(!paths.has(name))paths.set(name,{path:name,staged:false,unstaged:false,untracked:false,ignored:false});
  for(const [name,flags] of paths){const full=canonicalFile(workspace,name);files.push({...flags,sha256:sha(fs.readFileSync(full))});}
  const evidenceFiles=[];
  for(const evidence of work.evidence||[])for(const file of evidence.files||[]){
    if(!clean(file.path)||SECRET.test(file.path)){evidenceFiles.push({path:file.path,sha256:null});continue;}
    try{evidenceFiles.push({path:file.path,sha256:sha(fs.readFileSync(canonicalFile(workspace,file.path)))});}catch{evidenceFiles.push({path:file.path,sha256:null});}
  }
  const localRaw=text(workspace,['rev-list','--reverse',`${baseSha}..HEAD`]);
  const localCommits=localRaw?localRaw.split('\n').filter(Boolean):[];
  const diff=git(workspace,['diff','--binary','--no-ext-diff','--no-textconv',`${baseSha}...HEAD`]);
  const workDiff=git(workspace,['diff','--binary','--no-ext-diff','--no-textconv','HEAD']);
  const localBookkeeping=bookkeeping(work.id);
  const untrackedDigest=files.filter(f=>f.untracked&&!localBookkeeping.has(f.path)).map(f=>[f.path,f.sha256]).sort();
  const diffSha256=sha(Buffer.concat([diff,Buffer.from([0]),workDiff,Buffer.from(JSON.stringify(untrackedDigest))]));
  return {complete:true,filesComplete:true,rootVerified:true,pathSafetyVerified:true,targetResolved:true,observedAt:new Date().toISOString(),repository,headRepository,remote,branch,base,baseSha,headSha,detached:false,diffSha256,files,localCommits,evidenceFiles,evidenceFilesComplete:true,manualEvidenceVerified:[]};
}
