import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {constants} from 'node:os';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const SECRET=/(?:^|\/)(?:\.env(?:\.|$)|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)$/i;
const bookkeeping=id=>new Set([`.sol/work/${id}/work.json`,'.sol/state.json','.sol/history.jsonl']);
const clean=p=>typeof p==='string'&&p.length>0&&p.length<=1000&&!p.startsWith('/')&&!p.includes('\\')&&!/[\x00-\x1f]/.test(p)&&!p.split('/').some(s=>!s||s==='.'||s==='..');
const inside=(base,file)=>{const r=path.relative(base,file);return r===''||(!r.startsWith(`..${path.sep}`)&&r!=='..'&&!path.isAbsolute(r));};

// Diagnostics are deliberately lossy: arbitrary Git stderr can contain URLs,
// config values or credentials. Only fixed, recognized reasons leave this boundary.
function diagnosticStderr(value){
  if(!Buffer.isBuffer(value)&&typeof value!=='string')return undefined;
  const raw=value.toString('utf8');
  if(!raw)return undefined;
  const reasons=[
    [/fatal: not a git repository\b/i,'not a git repository'],
    [/fatal: Needed a single revision\b/i,'Needed a single revision'],
    [/fatal: ambiguous argument\b/i,'ambiguous argument (argument omitted)'],
    [/fatal: bad revision\b/i,'bad revision (revision omitted)'],
    [/dubious ownership in repository\b/i,'dubious ownership in repository (path omitted)'],
    [/Permission denied/i,'Permission denied'],
    [/No such file or directory/i,'No such file or directory'],
    [/not a valid object name/i,'not a valid object name (object omitted)'],
    [/No such remote/i,'No such remote (remote omitted)'],
    [/unknown revision or path not in the working tree/i,'unknown revision or path not in the working tree']
  ].filter(([pattern])=>pattern.test(raw)).map(([,reason])=>reason);
  return (reasons.length?reasons.join('; '):'unrecognized stderr')+' [raw stderr omitted]';
}
function diagnosticCwd(cwd){
  // Keep ordinary local paths useful, but suppress credential-like components,
  // URLs, terminal controls and unbounded paths. This is not a secret detector.
  return cwd.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,'?')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi,'[redacted-url]')
    .split(path.sep).map(part=>/(?:token|password|passwd|secret|credential|authorization|api[_-]?key|gh[pousr]_|github_pat_|sk-|AKIA)|[@=]|[A-Za-z0-9_-]{40,}/i.test(part)?'[redacted]':part)
    .join(path.sep).slice(0,1000);
}
function git(cwd,args,{allow1=false,operation=args[0]}={}){
  let result;
  try{
    result=spawnSync('/usr/bin/env',['git','-c','core.fsmonitor=false','-c','diff.external=','-c','core.pager=cat','--no-optional-locks',...args],{cwd,encoding:null,timeout:8000,maxBuffer:16*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',GIT_EXTERNAL_DIFF:''}});
  }catch(error){
    // Argument validation can throw before a process exists. Never forward the
    // original message/stack (which may contain argv), nor invent process facts.
    result={error};
  }
  if(result.error||result.status!==0&&!(allow1&&result.status===1)){
    const detail={operation,cwd:diagnosticCwd(cwd)};
    if(result.status===null||Number.isInteger(result.status))detail.status=result.status;
    if(result.signal===null||typeof result.signal==='string')detail.signal=result.signal===null?null:(Object.hasOwn(constants.signals,result.signal)?result.signal:'[omitted]');
    if(typeof result.error?.code==='string')detail.code=Object.hasOwn(constants.errno,result.error.code)||['ERR_CHILD_PROCESS_STDIO_MAXBUFFER','ERR_INVALID_ARG_VALUE','ERR_INVALID_ARG_TYPE','ERR_OUT_OF_RANGE'].includes(result.error.code)?result.error.code:'[omitted]';
    const stderr=diagnosticStderr(result.stderr);if(stderr)detail.stderr=stderr;
    throw new Error(`Snapshot Git readonly incompleto (${args[0]}). ${JSON.stringify(detail)}`);
  }
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
  const gitRoot=fs.realpathSync(text(workspace,['rev-parse','--show-toplevel'],{operation:'root'}));
  if(!inside(gitRoot,workspace))throw new Error('La sesión no está dentro de la raíz Git observada.');
  const branch=text(workspace,['branch','--show-current']);
  const headSha=text(workspace,['rev-parse','--verify','HEAD'],{operation:'HEAD'});
  if(!branch||! /^[a-f0-9]{40,64}$/.test(headSha))throw new Error('HEAD detached o inválido.');
  const remote=request.remote;
  if(typeof remote!=='string'||!/^[A-Za-z0-9_.-]{1,200}$/.test(remote))throw new Error('Remote solicitado inválido.');
  const fetchUrl=text(workspace,['remote','get-url',remote],{operation:'remote.fetch-url'});
  const pushUrl=text(workspace,['remote','get-url','--push',remote],{operation:'remote.push-url'});
  const repository=remoteRepository(fetchUrl),headRepository=remoteRepository(pushUrl);
  if(!repository||!headRepository||repository!==headRepository)throw new Error('Remote GitHub ambiguo o fork detectado; destino requiere revisión manual.');
  const base=request.base;
  if(typeof base!=='string'||!base||base.startsWith('-'))throw new Error('Base inválida.');
  const baseRef=`refs/remotes/${remote}/${base}`;
  const baseSha=text(workspace,['rev-parse','--verify',`${baseRef}^{commit}`],{operation:'base'});
  if(!/^[a-f0-9]{40,64}$/.test(baseSha))throw new Error('Base remota local no resuelta; no se ejecuta fetch.');
  const workspacePrefix=path.relative(gitRoot,workspace).split(path.sep).filter(Boolean).join('/');
  // Porcelain v1 and diff path records are rooted at the Git top-level, even with a nested cwd.
  const workspacePath=name=>{
    if(workspacePrefix&&!name.startsWith(`${workspacePrefix}/`))throw new Error('Hay paths Git fuera del workspace de sesión.');
    return workspacePrefix?name.slice(workspacePrefix.length+1):name;
  };
  const status=decodeZ(git(workspace,['status','--porcelain=v1','-z','--untracked-files=all','--ignored=matching']));
  const paths=new Map(),ignoredDirectories=[];
  for(let i=0;i<status.length;i++){
    const record=status[i];
    if(record.length<4)throw new Error('Salida status Git truncada/malformada.');
    const code=record.slice(0,2),rawName=record.slice(3);
    if(code==='!!'&&workspacePrefix&&!rawName.startsWith(`${workspacePrefix}/`))continue;
    const name=workspacePath(rawName);
    // Ignored directory summaries are not changed files. Never enumerate/read their contents.
    if(code==='!!'&&name.endsWith('/')){
      const directory=name.slice(0,-1);if(!clean(directory))throw new Error('Directorio ignorado inseguro.');
      ignoredDirectories.push(directory);continue;
    }
    if(code==='!!'&&!(request.expectedPaths||[]).includes(name))continue;
    if(code.includes('R')||code.includes('C')){if(!status[i+1])throw new Error('Renombre Git incompleto; snapshot bloqueado.');i++;}
    const previous=paths.get(name)||{path:name};
    previous.staged ||= code[0]!==' '&&code[0]!=='?'&&code[0]!=='!';
    previous.unstaged ||= code[1]!==' '&&code!=='??'&&code!=='!!';
    previous.untracked ||= code==='??';previous.ignored ||= code==='!!';paths.set(name,previous);
  }
  const changed=decodeZ(git(workspace,['diff','--name-only','-z','HEAD'],{operation:'diff.worktree-paths'})).map(workspacePath);
  const commitPaths=decodeZ(git(gitRoot,['diff','--name-only','-z',`${baseSha}...HEAD`],{operation:'diff.commit-paths'})).map(workspacePath);
  const deletedPaths=new Set([
    ...decodeZ(git(gitRoot,['diff','--name-only','--diff-filter=D','--no-renames','-z','HEAD'],{operation:'diff.worktree-deletions'})),
    ...decodeZ(git(gitRoot,['diff','--name-only','--diff-filter=D','--no-renames','-z',`${baseSha}...HEAD`],{operation:'diff.commit-deletions'}))
  ].map(workspacePath));
  const observeFile=name=>{
    try{return {sha256:sha(fs.readFileSync(canonicalFile(workspace,name))),deleted:false};}
    catch(error){
      // Only a deletion actually observed in Git may have no file. Unknown/missing inputs fail closed.
      if(error.code!=='ENOENT'||!deletedPaths.has(name))throw error;
      return {sha256:sha(Buffer.from(`sol:git-deletion\0${name}`)),deleted:true};
    }
  };
  for(const name of [...paths.keys(),...changed,...commitPaths]){
    if(!clean(name)||SECRET.test(name))throw new Error('Path inseguro o potencialmente sensible observado; snapshot bloqueado.');
    observeFile(name);
  }
  const files=[];
  for(const name of request.expectedPaths||[])if(!paths.has(name))paths.set(name,{path:name,staged:false,unstaged:false,untracked:false,ignored:ignoredDirectories.some(dir=>name.startsWith(`${dir}/`))});
  for(const [name,flags] of paths)files.push({...flags,...observeFile(name)});
  const evidenceFiles=[];
  for(const evidence of work.evidence||[])for(const file of evidence.files||[]){
    if(!clean(file.path)||SECRET.test(file.path)){evidenceFiles.push({path:file.path,sha256:null});continue;}
    try{evidenceFiles.push({path:file.path,sha256:sha(fs.readFileSync(canonicalFile(workspace,file.path)))});}catch{evidenceFiles.push({path:file.path,sha256:null});}
  }
  const localRaw=text(workspace,['rev-list','--reverse',`${baseSha}..HEAD`],{operation:'commits.local'});
  const localCommits=localRaw?localRaw.split('\n').filter(Boolean):[];
  // This is a local remote-tracking observation, not a network check or proof of current remote state.
  const publicationRef=`refs/remotes/${remote}/${branch}`;
  let publishedHeadSha=null,unpublishedCommitShas=null;
  try{
    publishedHeadSha=text(workspace,['rev-parse','--verify',`${publicationRef}^{commit}`],{operation:'publication.HEAD'});
    if(!/^[a-f0-9]{40,64}$/.test(publishedHeadSha))throw new Error('Ref inválida');
    const pending=text(workspace,['rev-list','--reverse',`${publishedHeadSha}..HEAD`],{operation:'publication.pending'});
    unpublishedCommitShas=pending?pending.split('\n').filter(Boolean):[];
  }catch{publishedHeadSha=null;unpublishedCommitShas=null;}

  const localBookkeeping=bookkeeping(work.id);
  // Metadata persistence must not stale its own approval in versioned tracking mode.
  // Keep every other path, including another Work's artifacts, in the content boundary.
  const contentPaths=['--','.',...[...localBookkeeping].map(p=>`:(exclude,literal)${p}`)];
  const diff=git(workspace,['diff','--binary','--no-ext-diff','--no-textconv',`${baseSha}...HEAD`,...contentPaths],{operation:'diff.commit-content'});
  const workDiff=git(workspace,['diff','--binary','--no-ext-diff','--no-textconv','HEAD',...contentPaths],{operation:'diff.worktree-content'});
  const untrackedDigest=files.filter(f=>f.untracked&&!localBookkeeping.has(f.path)).map(f=>[f.path,f.sha256]).sort();
  const diffSha256=sha(Buffer.concat([diff,Buffer.from([0]),workDiff,Buffer.from(JSON.stringify(untrackedDigest))]));
  return {complete:true,filesComplete:true,rootVerified:true,pathSafetyVerified:true,targetResolved:true,observedAt:new Date().toISOString(),repository,headRepository,remote,branch,base,baseSha,headSha,detached:false,diffSha256,files,localCommits,publicationRef,publishedHeadSha,unpublishedCommitShas,publicationObservation:'local_remote_tracking_ref_only',evidenceFiles,evidenceFilesComplete:true,manualEvidenceVerified:[]};
}
