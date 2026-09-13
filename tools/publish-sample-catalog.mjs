#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SAMPLE_LIMITS,validateSampleCatalog} from '../dist/sample-library.js';

const run=promisify(execFile),catalogPath='dist/samples/catalog.json';
const rerun='main was updated while indexing. Run the Sample catalog workflow again; it checks out the latest main. No force push was attempted.';
const validSHA=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);
const checkedSHA=value=>{if(!validSHA(value))throw new Error('GitHub returned an invalid Git object ID.');return value;};

// Dependency injection keeps branch-race and deployment routing tests independent of credentials.
// request(method, relativeRepoPath, JSONBody) is always scoped to one repository.
export async function publishSampleCatalog({head,previous,json,request}){
 checkedSHA(head);
 if(typeof json!=='string'||Buffer.byteLength(json)>SAMPLE_LIMITS.catalogBytes)throw new Error('The generated sample catalog is missing or exceeds its size limit.');
 const catalog=validateSampleCatalog(JSON.parse(json));
 const current=async()=>checkedSHA((await request('GET','/git/ref/heads/main')).object?.sha);
 if(await current()!==head)throw new Error(rerun);
 const pages=await request('GET','/pages');
 if(!['legacy','workflow'].includes(pages.build_type))throw new Error('GitHub Pages publishing is not configured. The sample catalog workflow has not changed Pages settings.');
 if(pages.build_type==='legacy'&&(pages.source?.branch!=='main'||pages.source?.path!=='/'))throw new Error('Branch Pages is not using main / (root), so dist/samples would not be published. Review the existing Pages source; this workflow does not change it.');
 let publishedHead=head,changed=json!==previous;
 if(changed){
  const parent=await request('GET',`/git/commits/${head}`);
  const tree=await request('POST','/git/trees',{base_tree:checkedSHA(parent.tree?.sha),tree:[{path:catalogPath,mode:'100644',type:'blob',content:json}]});
  const commit=await request('POST','/git/commits',{message:`Update public sample catalog (${catalog.tracks.length} tracks)`,tree:checkedSHA(tree.sha),parents:[head],author:{name:'github-actions[bot]',email:'41898282+github-actions[bot]@users.noreply.github.com'}});
  publishedHead=checkedSHA(commit.sha);
  if(await current()!==head)throw new Error(rerun);
  try{await request('PATCH','/git/refs/heads/main',{sha:publishedHead,force:false});}
  catch(error){if([409,422].includes(error.status))throw new Error(rerun+' If main did not change, check branch protection or required status checks.');throw error;}
 }
 // GITHUB_TOKEN commits do not start ordinary push-triggered workflows. Explicitly request
 // the existing deployment path, including when an empty/unchanged catalog needs a retry.
 if(await current()!==publishedHead)throw new Error(rerun);
 let deployment;
 if(pages.build_type==='legacy'){
  const result=await request('POST','/pages/builds');deployment=result.status||'queued';
 }else{
  await request('POST','/actions/workflows/pages.yml/dispatches',{ref:'main'});deployment='workflow dispatched';
 }
 return {changed,sha:publishedHead,tracks:catalog.tracks.length,mode:pages.build_type,deployment};
}

export function createGitHubRequest({repository,token,fetchImpl=globalThis.fetch}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||''))throw new Error('GITHUB_REPOSITORY must be an owner/repository name.');
 if(!token)throw new Error('GH_TOKEN is required. Run this tool from the Sample catalog workflow.');
 return async(method,suffix,body)=>{
  if(!suffix.startsWith('/')||suffix.startsWith('//')||suffix.includes('..'))throw new Error('Invalid repository API path.');
  let response;
  try{response=await fetchImpl(`https://api.github.com/repos/${repository}${suffix}`,{method,redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});}
  catch{throw new Error(`GitHub ${method} ${suffix} could not complete. Run the Sample catalog workflow again after checking connectivity.`);}
  if(!response.ok){const error=new Error(`GitHub ${method} ${suffix} returned HTTP ${response.status}. Check this workflow's contents:write, pages:write and actions:write permissions, then run it again. Pages settings were not modified.`);error.status=response.status;throw error;}
  if(response.status===204)return null;
  return response.json();
 };
}

async function main(){
 if(process.argv.length>2)throw new Error('Usage: node tools/publish-sample-catalog.mjs');
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main')throw new Error('Publishing is restricted to the main-branch GitHub Actions workflow.');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const head=(await run('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
 const info=await fs.lstat(path.join(root,catalogPath));if(!info.isFile()||info.isSymbolicLink())throw new Error('The generated catalog must be a regular file.');
 const json=await fs.readFile(path.join(root,catalogPath),'utf8');
 let previous=null;
 try{previous=(await run('git',['show',`HEAD:${catalogPath}`],{cwd:root,maxBuffer:SAMPLE_LIMITS.catalogBytes+1024})).stdout;}
 catch(error){if(error.code!==128)throw new Error('Could not read the catalog from the checked-out commit.');}
 const result=await publishSampleCatalog({head,previous,json,request:createGitHubRequest({repository:process.env.GITHUB_REPOSITORY,token:process.env.GH_TOKEN})});
 const message=`Sample catalog: ${result.tracks} tracks; ${result.changed?'committed':'unchanged'} at ${result.sha}; Pages ${result.mode}: ${result.deployment}.`;
 console.log(message);
 if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`${message}\n\nOnly \`${catalogPath}\` is committed by this workflow. Existing Pages settings are retained.\n`);
 if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`catalog_sha=${result.sha}\ncatalog_changed=${result.changed}\npages_mode=${result.mode}\n`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
