#!/usr/bin/env node
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {SAMPLE_LIMITS,SAMPLE_EXTENSION,validateSamplePath,validateSampleCatalog} from '../dist/sample-library.js';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function ordinaryDirectory(directory){const info=await fs.lstat(directory);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('サンプルフォルダーにシンボリックリンクは使用できません: '+directory);}
async function hashFile(filename){const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');}

export async function indexSamples({root=projectRoot,write=true}={}){
 root=path.resolve(root);const samples=path.join(root,'dist','samples'),audio=path.join(samples,'audio');
 await ordinaryDirectory(root);await ordinaryDirectory(path.join(root,'dist'));await ordinaryDirectory(samples);await ordinaryDirectory(audio);
 const files=[],tracks=[];let total=0;
 async function visit(directory,parts=[],depth=0){
  if(depth>20)throw new Error('サンプルのフォルダー階層が深すぎます。');
  const entries=await fs.readdir(directory,{withFileTypes:true});entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  for(const entry of entries){
   const absolute=path.join(directory,entry.name),info=await fs.lstat(absolute);
   if(info.isSymbolicLink())throw new Error('サンプルフォルダーにシンボリックリンクは使用できません: '+[...parts,entry.name].join('/'));
   if(entry.name.startsWith('.'))continue;
   if(info.isDirectory()){await visit(absolute,[...parts,entry.name],depth+1);continue;}
   if(!info.isFile())throw new Error('通常ファイル以外は使用できません: '+entry.name);
   if(!SAMPLE_EXTENSION.test(entry.name))continue;
   const file=validateSamplePath('audio/'+[...parts,entry.name].join('/'));
   if(info.size<=0||info.size>SAMPLE_LIMITS.fileBytes)throw new Error('音源は0バイトより大きく50 MiB以下にしてください: '+file);
   total+=info.size;if(total>SAMPLE_LIMITS.totalBytes)throw new Error('公開サンプルの合計が512 MiBを超えています。');
   files.push({absolute,file,bytes:info.size});if(files.length>SAMPLE_LIMITS.files)throw new Error('サンプルは1000ファイル以下にしてください。');
  }
 }
 await visit(audio);
 for(const file of files){
  const sha256=await hashFile(file.absolute),id='sample-'+createHash('sha256').update(file.file+'\0'+sha256).digest('hex'),basename=path.basename(file.file).replace(SAMPLE_EXTENSION,''),parts=basename.split(' - ');
  tracks.push({id,file:file.file,bytes:file.bytes,sha256,name:parts.length>1?parts.slice(1).join(' - '):basename,artist:parts.length>1?parts[0]:''});
 }
 const catalog=validateSampleCatalog({format:'seekdeck-samples',version:1,tracks}),json=JSON.stringify(catalog,null,2)+'\n';
 if(Buffer.byteLength(json)>SAMPLE_LIMITS.catalogBytes)throw new Error('サンプル一覧が1 MiBを超えています。');
 if(write){const target=path.join(samples,'catalog.json');try{const info=await fs.lstat(target);if(info.isSymbolicLink()||!info.isFile())throw new Error('catalog.jsonは通常ファイルである必要があります。');}catch(error){if(error.code!=='ENOENT')throw error;}await fs.writeFile(target,json);}
 return {catalog,json,totalBytes:total};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const check=process.argv.includes('--check');
 if(process.argv.slice(2).some(arg=>arg!=='--check'))throw new Error('Usage: node tools/index-samples.mjs [--check]');
 try{const result=await indexSamples({write:!check});if(check){const current=await fs.readFile(path.join(projectRoot,'dist/samples/catalog.json'),'utf8');if(current!==result.json)throw new Error('サンプル一覧が古い状態です。npm run samples:index を実行してください。');}console.log(`${check?'Checked':'Indexed'} ${result.catalog.tracks.length} public samples (${result.totalBytes} bytes).`);}catch(error){console.error(error.message);process.exitCode=1;}
}
