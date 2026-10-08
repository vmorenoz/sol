import {preparePluginVersionFixture} from './plugin-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('plugin de configuración usa datos de sesión, filtra catálogo y separa preview de guardado',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sol-config-plugin-'));
  try{
    preparePluginVersionFixture(home);
    const lib=path.join(home,'.sol/lib'),schemas=path.join(home,'.sol/schemas');fs.mkdirSync(lib,{recursive:true});fs.mkdirSync(schemas,{recursive:true});
    // Plugin bootstrap consumes both installed schemas to expose canonical tool enums.
    fs.copyFileSync(path.join(root,'schemas/work-update.schema.json'),path.join(schemas,'work-update.schema.json'));
    fs.copyFileSync(path.join(root,'schemas/work.schema.json'),path.join(schemas,'work.schema.json'));
    fs.writeFileSync(path.join(lib,'model-config.mjs'),`export const readModelConfig=()=>({configPath:'/private/opencode.jsonc',revision:'${'a'.repeat(64)}',profile:'inherited',assignments:{sol:{providerID:'openai',id:'gpt-6.1-sol',variant:'high'}}});
export const planModelConfig=(input)=>{globalThis.plan=input;return {configPath:'/private/opencode.jsonc',revision:input.expectedRevision,profile:input.profile,changes:[{agentId:'sol',before:null,after:'openai/model#high'}],migration:false}};
 export const applyModelConfig=(plan)=>{globalThis.applied=plan;return {saved:true,configPath:plan.configPath,profile:plan.profile,changed:true,changes:plan.changes,migration:false,recovery:'/private/backup.jsonc'}};`);
    fs.writeFileSync(path.join(lib,'artifact-tracking.mjs'),`export const readArtifactTracking=()=>({available:true,mode:'unconfigured',revision:'${'b'.repeat(64)}',workspace:'/session/workspace',repoRoot:'/session',trackedCount:0,ignored:false,blockers:[]});
export const planArtifactTracking=(root,input)=>{globalThis.trackingPlan=input;return {workspace:root,repoRoot:'/session',mode:input.mode,previousMode:'unconfigured',revision:input.expectedRevision,changed:true,changes:['selected tracking'],trackedCount:0}};
export const applyArtifactTracking=plan=>({saved:true,changed:true,mode:plan.mode,workspace:plan.workspace,recovery:'/private/tracking-backup',postHash:'post'});
export const restoreArtifactTracking=()=>({restored:true,changed:true,blockers:[]});`);
    const source=String.raw`
      import plugin from ${JSON.stringify(path.join(root,'plugins/opencode-v2/index.ts'))};
      const registered={};let locations=[];const selected={providerID:'openai',id:'gpt-6.1-sol',variant:'high'};
      const ctx={tool:{transform:async fn=>fn({add:x=>registered[x.name]=x})},session:{get:async()=>({location:{directory:'/session/workspace'},model:selected})},model:{list:async options=>{locations.push(options);return {location:options.location,data:[{providerID:'openai',id:'model-a',name:'Model A',enabled:true,status:'active',variants:[{id:'high'}]},{providerID:'secret-provider',id:'hidden',name:'SECRET BODY',enabled:true,status:'active',apiKey:'never-return'},{providerID:'openai',id:'disabled',enabled:false,status:'active'}]}}}};
      await plugin.setup(ctx);
      const call=async(name,args)=>registered[name].execute(args,{sessionID:'ses-test'});
      const get=await call('sol_config_get',{offset:0,limit:20});
      if(!String(get.content).includes('openai/model-a')||String(get.content).includes('never-return')||String(get.content).includes('apiKey'))throw Error('catálogo no saneado');
       if(!String(get.content).includes('Modelo seleccionado en esta sesión'))throw Error('falta separación de sesión');
       if(!String(get.content).includes('unconfigured')||!String(get.content).includes('sugerencia predeterminada: Local')||!String(get.content).includes('no implica exclusión actual'))throw Error('no separa estado unconfigured de sugerencia Local');
      const revision='${'a'.repeat(64)}',artifactRevision='${'b'.repeat(64)}';const args={profile:'custom',overrides:[{agentId:'sol',model:'openai/model-a#high'}],expectedRevision:revision,artifactTracking:'versioned',artifactExpectedRevision:artifactRevision};const preview=await call('sol_config_apply',args);
      if(globalThis.applied||!String(preview.content).includes('Vista previa combinada (no guardada)'))throw Error('preview guardó');
      await call('sol_config_apply',{...args,dryRun:false});
      if(!globalThis.applied||globalThis.plan.catalog.length!==3||globalThis.plan.overrides.sol!=='openai/model-a#high'||globalThis.trackingPlan.mode!=='versioned')throw Error('apply/catalog/overrides incorrectos');
      if(locations.some(item=>item.location.directory!=='/session/workspace'))throw Error('no usa directorio de sesión');
      if('switchModel' in ctx.session)throw Error('API de cambio de sesión inesperada');
      console.log('PASS isolated plugin contract');
    `;
    const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);assert.match(result.stdout,/PASS isolated plugin contract/);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
