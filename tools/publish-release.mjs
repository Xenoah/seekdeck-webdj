import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const {version}=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw new Error('Invalid release version');
const tag='v'+version,repo=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA;
if(repo!=='Xenoah/seekdeck-webdj'||!/^[a-f0-9]{40}$/.test(sha||''))throw new Error('Expected repository and exact commit required');
const notes='releases/'+tag+'.md',archive='release-artifacts/seekdeck-webdj-'+tag+'.zip',checksums='release-artifacts/SHA256SUMS.txt';
for(const file of [notes,archive,checksums])if(!fs.existsSync(file))throw new Error('Missing '+file);
function gh(args,json=false){const r=spawnSync('gh',[...args,'--repo',repo],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||'GitHub release command failed');return json?JSON.parse(r.stdout):r.stdout.trim();}
const existing=gh(['release','list','--limit','100','--json','tagName,isDraft'],true).find(r=>r.tagName===tag);
if(existing&&!existing.isDraft){console.log(tag+' is already published; keeping it unchanged.');process.exit(0);}
if(existing){
 const draft=gh(['release','view',tag,'--json','targetCommitish'],true);
 if(draft.targetCommitish!==sha)throw new Error('Existing draft belongs to a different commit');
 gh(['release','upload',tag,archive,checksums,'--clobber']);
}else gh(['release','create',tag,archive,checksums,'--target',sha,'--draft','--title','SeekDeck '+tag,'--notes-file',notes,...(version.includes('-')?['--prerelease']:[])]);
gh(['release','edit',tag,'--draft=false',...(version.includes('-')?[]:['--latest'])]);
console.log(gh(['release','view',tag,'--json','url,isDraft,tagName']));
