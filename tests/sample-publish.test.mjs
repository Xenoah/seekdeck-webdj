import test from 'node:test';
import assert from 'node:assert/strict';
import {publishSampleCatalog,createGitHubRequest} from '../tools/publish-sample-catalog.mjs';

const head='a'.repeat(40),tree='b'.repeat(40),commit='c'.repeat(40),other='d'.repeat(40);
const json=JSON.stringify({format:'seekdeck-samples',version:1,tracks:[]},null,2)+'\n';
function fixture({mode='legacy',raceAt=0,failPatch=0,source={branch:'main',path:'/'}}={}){
 let current=head,reads=0;const calls=[];
 const request=async(method,path,body)=>{
  calls.push({method,path,body});
  if(method==='GET'&&path==='/git/ref/heads/main'){reads++;if(reads===raceAt)current=other;return {object:{sha:current}};}
  if(path==='/pages')return {build_type:mode,source};
  if(path===`/git/commits/${head}`)return {tree:{sha:tree}};
  if(path==='/git/trees')return {sha:tree};
  if(path==='/git/commits')return {sha:commit};
  if(path==='/git/refs/heads/main'){if(failPatch){const error=new Error('rejected');error.status=failPatch;throw error;}current=body.sha;return {object:{sha:current}};}
  if(path==='/pages/builds')return {status:'queued'};
  if(path==='/actions/workflows/pages.yml/dispatches')return null;
  throw new Error('Unexpected request '+path);
 };
 return {request,calls};
}

for(const mode of ['legacy','workflow'])for(const changed of [false,true]){
 test(`sample catalog ${changed?'commits':'preserves'} exact content and requests ${mode} deployment`,async()=>{
  const f=fixture({mode}),result=await publishSampleCatalog({head,previous:changed?'old':json,json,request:f.request});
  assert.equal(result.changed,changed);assert.equal(result.sha,changed?commit:head);
  assert.equal(f.calls.filter(x=>x.path==='/git/refs/heads/main').length,changed?1:0);
  if(changed){
   const t=f.calls.find(x=>x.path==='/git/trees');
   assert.deepEqual(t.body.tree,[{path:'dist/samples/catalog.json',mode:'100644',type:'blob',content:json}]);
   assert.equal(t.body.base_tree,tree);
   assert.deepEqual(f.calls.find(x=>x.path==='/git/commits').body.parents,[head]);
   assert.equal(f.calls.find(x=>x.path==='/git/refs/heads/main').body.force,false);
  }else assert.equal(f.calls.some(x=>['/git/trees','/git/commits'].includes(x.path)),false);
  const build=f.calls.at(-1);
  assert.equal(build.path,mode==='legacy'?'/pages/builds':'/actions/workflows/pages.yml/dispatches');
  assert.equal(build.method,'POST');if(mode==='workflow')assert.deepEqual(build.body,{ref:'main'});
  assert.equal(f.calls.some(x=>x.path==='/pages'&&x.method!=='GET'),false);
 });
}
for(const raceAt of [1,2,3]){
 test(`sample publication stops on main race at checkpoint ${raceAt}`,async()=>{
  const f=fixture({raceAt});
  await assert.rejects(()=>publishSampleCatalog({head,previous:'old',json,request:f.request}),/Run the Sample catalog workflow again/);
  assert.equal(f.calls.some(x=>x.path==='/pages/builds'),false);
  if(raceAt<=2)assert.equal(f.calls.some(x=>x.path==='/git/refs/heads/main'),false);
 });
}
for(const failPatch of [409,422]){
 test(`sample publication reports ref conflict ${failPatch} without retrying a force update`,async()=>{
  const f=fixture({failPatch});
  await assert.rejects(()=>publishSampleCatalog({head,previous:'old',json,request:f.request}),/No force push/);
  const updates=f.calls.filter(x=>x.path==='/git/refs/heads/main');
  assert.equal(updates.length,1);assert.equal(updates[0].body.force,false);
  assert.equal(f.calls.some(x=>x.path==='/pages/builds'),false);
 });
}
test('invalid generated sample catalog is rejected before any API access',async()=>{
 const f=fixture();
 await assert.rejects(()=>publishSampleCatalog({head,previous:'old',json:'{"tracks":[{"file":"../../private"}]}',request:f.request}));
 assert.equal(f.calls.length,0);
});
test('sample publisher fails without changing an incompatible Pages source',async()=>{
 const f=fixture({source:{branch:'main',path:'/docs'}});
 await assert.rejects(()=>publishSampleCatalog({head,previous:'old',json,request:f.request}),/main \/ \(root\)/);
 assert.equal(f.calls.some(x=>x.method!=='GET'),false);
});
test('GitHub request errors keep credentials out of logs and disable redirects',async()=>{
 const request=createGitHubRequest({repository:'Xenoah/seekdeck-webdj',token:'test-only-never-log',fetchImpl:async(url,options)=>{
  assert.match(url,/^https:\/\/api.github.com\/repos\/Xenoah\/seekdeck-webdj\//);
  assert.equal(options.redirect,'error');
  return {ok:false,status:403};
 }});
 await assert.rejects(()=>request('POST','/pages/builds'),error=>error.status===403&&!error.message.includes('test-only-never-log'));
});
