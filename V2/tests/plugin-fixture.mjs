import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Real version helper with an isolated HOME; no global installation or live host.
export function preparePluginVersionFixture(home,overrides={}){
  const lib=path.join(home,'.sol/lib');fs.mkdirSync(lib,{recursive:true});
  for(const file of ['version.mjs','fs.mjs'])fs.copyFileSync(path.join(root,'lib',file),path.join(lib,file));
  const identity={...JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8')),buildHash:'a'.repeat(64),...overrides};
  fs.writeFileSync(path.join(home,'.sol/release.json'),JSON.stringify(identity));
  return identity;
}
