import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const gitEnv = {...process.env,GIT_OPTIONAL_LOCKS:'0'};
function git(root,args,{allow1=false}={}) {
  const r=spawnSync('git',args,{cwd:root,env:gitEnv,encoding:null,timeout:8000,maxBuffer:4*1024*1024});
  if(r.error) throw new Error(`Git no disponible o falló: ${r.error.message}`);
  if(r.status!==0 && !(allow1&&r.status===1)) throw new Error(`Git ${args[0]} falló (exit ${r.status}): ${r.stderr.toString().trim()}`);
  return {status:r.status,stdout:r.stdout,stderr:r.stderr};
}
const text = b => b.toString('utf8').replace(/[\r\n]+$/,'');
function canonical(p){return fs.realpathSync(p);}
function inside(base,p){const r=path.relative(base,p);return r===''||(!r.startsWith(`..${path.sep}`)&&r!=='..'&&!path.isAbsolute(r));}
function noLinkParents(base,target){
  const realBase=canonical(base); if(!inside(realBase,path.resolve(target))) throw new Error('Git metadata path escapa del directorio confiable.');
  let cur=realBase; for(const part of path.relative(realBase,path.resolve(target)).split(path.sep).filter(Boolean)){cur=path.join(cur,part);try{if(fs.lstatSync(cur).isSymbolicLink())throw new Error(`Enlace simbólico rechazado en metadata Git: ${cur}`);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function info(root){
  const workspace=canonical(root), repoRoot=canonical(text(git(workspace,['rev-parse','--show-toplevel']).stdout));
  const common=canonical(text(git(workspace,['rev-parse','--path-format=absolute','--git-common-dir']).stdout));
  const excludePath=path.resolve(text(git(workspace,['rev-parse','--path-format=absolute','--git-path','info/exclude']).stdout));
  noLinkParents(common,excludePath);if(fs.existsSync(excludePath)&&!fs.lstatSync(excludePath).isFile())throw new Error('La ruta info/exclude no es un archivo regular.'); const sharedMetadata=common!==canonical(text(git(workspace,['rev-parse','--path-format=absolute','--git-dir']).stdout));
  if(!inside(repoRoot,workspace)) throw new Error('Workspace fuera del root Git.');
  return {workspace,repoRoot,common,excludePath,sharedMetadata,rel:path.relative(repoRoot,workspace).split(path.sep).join('/')};
}
function tracked(i){const prefix=i.rel?`${i.rel}/.sol/`:'.sol/';const b=git(i.repoRoot,['ls-files','-z','--',prefix]).stdout;return b.toString().split('\0').filter(Boolean);}
function probe(i){const p=path.posix.join(i.rel,'.sol','artifact-tracking-probe');const q=git(i.repoRoot,['check-ignore','--no-index','-q','--',p],{allow1:true});const v=q.status===0?git(i.repoRoot,['check-ignore','--no-index','-v','--',p],{allow1:true}):null;return {ignored:q.status===0,detail:v?text(v.stdout):''};}
function ownKey(rel){return sha(Buffer.from(rel||'.')).slice(0,24);}
const begin=k=>`# BEGIN SOL ARTIFACTS ${k}`;
const end=k=>`# END SOL ARTIFACTS ${k}`;
function parseBlock(buf,key,rel){
  const s=buf.toString('utf8'), lines=s.split(/(?<=\n)/), starts=[];
  for(let n=0;n<lines.length;n++)if(lines[n].replace(/\r?\n$/,'')===begin(key))starts.push(n);
  const ends=lines.filter(line=>line.replace(/\r?\n$/,'')===end(key)).length;
  if(starts.length>1)throw new Error('Marcadores Sol duplicados; no se modificó info/exclude.');
  if(!starts.length){if(ends)throw new Error('Marcador final Sol sin bloque inicial; no se sobrescribió.');return {mode:'unconfigured',start:-1,end:-1};}
  if(ends!==1)throw new Error('Marcadores Sol incompletos o duplicados; no se sobrescribió info/exclude.');
  const a=starts[0], expected=`# workspace: ${rel||'.'}`;let b=-1;
  for(let n=a+1;n<lines.length;n++)if(lines[n].replace(/\r?\n$/,'')===end(key)){b=n;break;}
  if(b<0||lines[a+1]?.replace(/\r?\n$/,'')!==expected)throw new Error('Bloque Sol incompleto o alterado; no se sobrescribió.');
  const content=lines.slice(a,b+1).map(x=>x.replace(/\r?\n$/,'')),modeLine=content[2]??'';
  if(!modeLine.startsWith('# mode: '))throw new Error('Bloque Sol alterado; restaure su forma gestionada antes de continuar.');
  const mode=modeLine.slice('# mode: '.length);
  const expectedLines=[begin(key),expected,`# mode: ${mode}`,...(mode==='local'?[`/${escapePattern(rel?`${rel}/.sol`:'.sol')}/`]:[]),end(key)];
  if(!['local','versioned'].includes(mode)||content.length!==expectedLines.length||content.some((line,n)=>line!==expectedLines[n]))throw new Error('El bloque Sol contiene líneas alteradas o ajenas; mueva las reglas externas fuera del bloque gestionado.');
  return {mode,start:a,end:b,lines};
}
function escapePattern(s){return s.split('/').map(part=>part.replace(/[\\*?[\]# !]/g,c=>'\\'+c)).join('/');}
function hashRevision(i,b,files){return sha(Buffer.concat([Buffer.from(JSON.stringify([i.workspace,i.repoRoot,i.common,i.excludePath,files])),Buffer.from([0]),b??Buffer.from('<absent>')]));}
function snapshot(i){const b=fs.existsSync(i.excludePath)?fs.readFileSync(i.excludePath):null;const files=tracked(i),ignoreProbe=probe(i);return {b,files,probe:ignoreProbe,revision:sha(Buffer.concat([Buffer.from(hashRevision(i,b,files)),Buffer.from(JSON.stringify(ignoreProbe))]))};}
function safeRead(root){
  try{const i=info(root),s=snapshot(i),block=parseBlock(s.b??Buffer.alloc(0),ownKey(i.rel),i.rel);return {available:true,mode:block.mode,revision:s.revision,workspace:i.workspace,repoRoot:i.repoRoot,excludePath:i.excludePath,trackedCount:s.files.length,ignored:s.probe.ignored,blockers:[],sharedMetadata:i.sharedMetadata};}
  catch(e){return {available:false,mode:'unconfigured',revision:sha('unavailable'),workspace:path.resolve(root),repoRoot:'',excludePath:'',trackedCount:0,ignored:false,blockers:[e.message],sharedMetadata:false};}
}
export function readArtifactTracking(root){return safeRead(root);}
export function planArtifactTracking(root,{mode,expectedRevision}={}){
  if(!['local','versioned'].includes(mode))throw new Error('mode debe ser local o versioned.');
  const i=info(root),s=snapshot(i),block=parseBlock(s.b??Buffer.alloc(0),ownKey(i.rel),i.rel);
  if(expectedRevision!==s.revision)throw new Error(`Revisión obsoleta de tracking; actual=${s.revision}.`);
  if(mode==='local'&&s.files.length)throw new Error(`No se puede excluir localmente: hay ${s.files.length} artefacto(s) .sol ya versionados. Resolver manualmente; no se modificó el índice.`);
  const matched=s.probe.detail.match(/^(.*?):(\d+):([^\t]*)\t/);
  const ownLine=matched&&((matched[1]===i.excludePath||matched[1]==='.git/info/exclude')&&matched[3]===`/${escapePattern(i.rel?`${i.rel}/.sol`:'.sol')}/`&&block.mode==='local'&&Number(matched[2])===block.start+4);
  const ownRule=Boolean(ownLine);
  if(mode==='versioned'&&s.probe.ignored&&!ownRule)throw new Error(`.sol está ignorado por una regla externa (${s.probe.detail}); resuélvalo manualmente antes de versionar.`);
  const old=s.b?.toString('utf8')??'', lines=old?old.match(/[^\n]*\n|[^\n]+$/g):[];
  const preserved=lines.slice(); if(block.start>=0)preserved.splice(block.start,block.end-block.start+1);
  const ending=old.endsWith('\n')||!old?'\n':'';
  const marker=[begin(ownKey(i.rel)),`# workspace: ${i.rel||'.'}`,`# mode: ${mode}`,...(mode==='local'?[`/${escapePattern(i.rel?`${i.rel}/.sol` : '.sol')}/`]:[]),end(ownKey(i.rel)),''].join('\n');
  let after=preserved.join('');if(after&&!after.endsWith('\n'))after+='\n';after+=marker;
  const changed=after!==(s.b?.toString('utf8')??'');
  if(!changed&&s.probe.ignored!==(mode==='local'))throw new Error(`La elección ${mode} no coincide con la regla ignore efectiva actual; resuelva las reglas externas antes de continuar.`);
  return {workspace:i.workspace,repoRoot:i.repoRoot,excludePath:i.excludePath,revision:s.revision,mode,previousMode:block.mode,changes:changed?[`${mode==='local'?'Excluir':'dejar versionable'} .sol en ${i.workspace}`]:[],changed,before:s.b,after,expectedHash:s.b?sha(s.b):null,trackedCount:s.files.length,sharedMetadata:i.sharedMetadata,_identity:{common:i.common,gitDir:text(git(i.workspace,['rev-parse','--path-format=absolute','--git-dir']).stdout)}};
}
function assertPrivate(p,dir){const s=fs.lstatSync(p);if((dir&&!s.isDirectory())||(!dir&&!s.isFile())||s.isSymbolicLink()||(s.mode&0o777)!==(dir?0o700:0o600))throw new Error(`No se pudo garantizar metadata privada segura: ${p}`);}
function mkdirPrivate(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);assertPrivate(dir,true);}
function atomicFile(file,data){
  const dir=path.dirname(file);noLinkParents(dir,file);const tmp=path.join(dir,`.sol-tracking-${crypto.randomUUID()}.tmp`);let fd;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
  finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
}
function backup(plan){const common=plan._identity.common,base=path.join(common,'sol-artifacts-backups',crypto.randomUUID());noLinkParents(common,base);mkdirPrivate(base);const oldPath=path.join(base,'info-exclude.before');if(plan.before){fs.writeFileSync(oldPath,plan.before,{mode:0o600,flag:'wx'});fs.chmodSync(oldPath,0o600);assertPrivate(oldPath,false);}const recoveryPath=path.join(base,'recovery.json');fs.writeFileSync(recoveryPath,JSON.stringify({workspace:plan.workspace,excludePath:plan.excludePath,beforeHash:plan.expectedHash,afterHash:sha(Buffer.from(plan.after)),beforePresent:plan.before!==null},null,2)+'\n',{mode:0o600,flag:'wx'});fs.chmodSync(recoveryPath,0o600);assertPrivate(recoveryPath,false);return base;}
function applyExact(plan,expected,desired){
  const p=plan.excludePath;if(fs.existsSync(p)){const b=fs.readFileSync(p);if(sha(b)!==expected)throw new Error('info/exclude cambió concurrentemente; no se sobrescribió.');}
  else if(expected!==null)throw new Error('info/exclude desapareció concurrentemente.');
  if(desired===null){fs.unlinkSync(p);return;}
  atomicFile(p,desired);
}
export function applyArtifactTracking(plan){
  const i=info(plan.workspace);if(i.repoRoot!==plan.repoRoot||i.common!==plan._identity.common||i.excludePath!==plan.excludePath)throw new Error('Identidad Git cambió desde el plan.');
  const s=snapshot(i);if(s.revision!==plan.revision||s.files.length!==plan.trackedCount)throw new Error('Plan obsoleto: Git metadata o artefactos cambiaron.');
  if(!plan.changed)return {saved:true,changed:false,mode:plan.mode,workspace:plan.workspace,excludePath:plan.excludePath,recovery:null,revision:s.revision,postHash:plan.expectedHash};
  const recovery=backup(plan), beforeHash=plan.expectedHash;
  try{
    applyExact(plan,beforeHash,Buffer.from(plan.after));
    const p=probe(i),want=plan.mode==='local';
    if(p.ignored!==want){applyExact(plan,sha(Buffer.from(plan.after)),plan.before);throw new Error(`Verificación ${plan.mode} falló por reglas ignore externas; se restauró el archivo original. Recuperación: ${recovery}`);}
    return {saved:true,changed:true,mode:plan.mode,workspace:plan.workspace,excludePath:plan.excludePath,recovery,revision:snapshot(i).revision,postHash:sha(Buffer.from(plan.after))};
  }catch(e){
    let restored=false,partial=false;
    try{const current=fs.existsSync(plan.excludePath)?fs.readFileSync(plan.excludePath):null;
      if((current?sha(current):null)===sha(Buffer.from(plan.after))){applyExact(plan,sha(Buffer.from(plan.after)),plan.before);const afterRestore=fs.existsSync(plan.excludePath)?fs.readFileSync(plan.excludePath):null;restored=(afterRestore?sha(afterRestore):null)===plan.expectedHash;}
      else {const beforeStill=(current?sha(current):null)===plan.expectedHash;restored=beforeStill;partial=!beforeStill;}
    }catch(rollbackError){try{const b=fs.existsSync(plan.excludePath)?fs.readFileSync(plan.excludePath):null;restored=(b?sha(b):null)===plan.expectedHash;}catch{}partial=!restored;e=new Error(`${e.message}; restauración comprobada=${restored}; detalle=${rollbackError.message}`);}
    const status=partial?'restored=false; info/exclude puede haber cambiado parcialmente y no se sobrescribió un contenido concurrente':`restored=${restored}`;
    throw new Error(`${e.message} [${status}; copia privada: ${recovery}]`);
  }
}
export function restoreArtifactTracking(plan,result){
  if(!result?.changed)return {restored:true,changed:false,blockers:[]};
  try{const i=info(plan.workspace);const gitDir=text(git(i.workspace,['rev-parse','--path-format=absolute','--git-dir']).stdout);if(i.excludePath!==plan.excludePath||i.repoRoot!==plan.repoRoot||i.common!==plan._identity.common||gitDir!==plan._identity.gitDir)throw new Error('Identidad Git cambió.');
    const b=fs.existsSync(plan.excludePath)?fs.readFileSync(plan.excludePath):null;if((b?sha(b):null)!==result.postHash)throw new Error('info/exclude cambió desde la aplicación; no se sobrescribió.');
    if(plan.before===null){fs.unlinkSync(plan.excludePath);}else atomicFile(plan.excludePath,plan.before);
    return {restored:true,changed:true,blockers:[],recovery:result.recovery};
  }catch(e){return {restored:false,changed:false,blockers:[`${e.message} Copia de recuperación: ${result.recovery??'no disponible'}`],recovery:result.recovery??null};}
}
