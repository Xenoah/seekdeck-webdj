// Local file exchange. All times in this module are seconds; paths never trigger requests.
export const MAX_EXCHANGE_BYTES=25*1024*1024,MAX_EXCHANGE_TRACKS=20000;
const clean=s=>String(s??'').replace(/\0/g,'').slice(0,4096);
export function normalizePath(value){
 let path=clean(value).trim().replace(/\\/g,'/');
 if(/^file:\/\//i.test(path)){path=path.replace(/^file:\/\/(localhost)?/i,'');try{path=decodeURIComponent(path);}catch{}}
 path=path.replace(/^\/([a-z]:\/)/i,'$1').replace(/\/:/g,'/').replace(/\/{2,}/g,'/');
 const parts=[];for(const part of path.split('/')){if(part==='.')continue;if(part==='..'&&parts.length&&parts.at(-1)!=='..'&&parts.at(-1)!=='')parts.pop();else parts.push(part);}
 return parts.join('/').normalize('NFC');
}
export function localPath(path){return !!path&&!/^(?![a-z]:\/)[a-z][a-z\d+.-]*:/i.test(normalizePath(path))&&!/[\r\n\0]/.test(path);}
export function filename(path){return normalizePath(path).split('/').pop();}
export function fileURL(path){const p=normalizePath(path);return 'file://localhost/'+p.replace(/^\//,'').split('/').map((v,i)=>i===0&&/^[a-z]:$/i.test(v)?v:encodeURIComponent(v)).join('/');}
export function exportPath(t,options={}){
 const original=normalizePath(t.originalLocation||'');
 if(options.preserve!==false&&original&&localPath(original))return original;
 const relative=normalizePath(t.relativePath||t.filename||'');if(!relative||relative.startsWith('../')||!localPath(relative))throw new Error(`音源パスがありません：${t.name}`);
 const base=normalizePath(options.base||'');if(base&&!localPath(base))throw new Error('音源フォルダーにはローカルパスを指定してください。');
 return base?base.replace(/\/$/,'')+'/'+relative.replace(/^\//,''):relative;
}
export function createMatcher(tracks){
 const exact=new Map(),suffixes=new Map(),names=new Map();const add=(m,k,t)=>{if(!k)return;const list=m.get(k)||[];if(!list.some(x=>x.id===t.id))list.push(t);m.set(k,list);};
 for(const t of tracks){for(const p of [t.originalLocation,t.relativePath])if(p){const n=normalizePath(p);add(exact,n,t);if(/^[a-z]:\//i.test(n))add(exact,n.toLocaleLowerCase(),t);const parts=n.split('/').filter(Boolean);for(let i=Math.max(0,parts.length-32);i<parts.length-1;i++)add(suffixes,parts.slice(i).join('/'),t);}add(names,filename(t.filename||t.relativePath||t.originalLocation||''),t);}
 return path=>{const n=normalizePath(path);if(!localPath(path))return {status:'unsupported'};const precise=exact.get(n)||(/^[a-z]:\//i.test(n)?exact.get(n.toLocaleLowerCase()):null);if(precise)return precise.length===1?{status:'matched',track:precise[0]}:{status:'ambiguous'};const parts=n.split('/').filter(Boolean);for(let i=0;i<parts.length-1;i++){const choices=suffixes.get(parts.slice(i).join('/'));if(choices)return choices.length===1?{status:'matched',track:choices[0]}:{status:'ambiguous'};}const choices=names.get(filename(n))||[];return choices.length===1?{status:'matched',track:choices[0]}:{status:choices.length?'ambiguous':'missing'};};
}
function collection(entries,name,metadata=false){if(entries.length>MAX_EXCHANGE_TRACKS)throw new Error('1回の読み込みは20,000曲以下にしてください。');const tracks=entries.map((t,i)=>({...t,id:String(i)}));return {tracks,playlists:[{name:name||'Imported playlist',tracks:tracks.map(t=>t.id)}],metadata,warnings:[]};}
export function parseM3U(text,name){let info=null;const entries=[];for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){const line=raw.trim();if(!line)continue;if(line.startsWith('#EXTINF:')){const comma=line.indexOf(',');info={name:comma>=0?line.slice(comma+1):'',duration:Number(line.slice(8,comma))};continue;}if(line.startsWith('#'))continue;entries.push({path:line,...info});info=null;}return collection(entries,name);}
export function parsePLS(text,name){if(!/^\s*\[playlist\]/im.test(text))throw new Error('PLSの[playlist]ヘッダーがありません。');const rows=new Map();for(const line of text.split(/\r?\n/)){const m=/^(File|Title|Length)(\d+)=(.*)$/i.exec(line.trim());if(!m)continue;const n=Number(m[2]);if(n<1||n>MAX_EXCHANGE_TRACKS)throw new Error('PLSの曲番号が上限を超えています。');const row=rows.get(n)||{};row[{file:'path',title:'name',length:'duration'}[m[1].toLowerCase()]]=m[1].toLowerCase()==='length'?Number(m[3]):m[3];rows.set(n,row);}return collection([...rows.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]).filter(x=>x.path),name);}
export function parseCSVRows(text){
 text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0],delimiter=['\t',';',','].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0];
 const rows=[];let row=[],value='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else value+=c;continue;}
 if(c==='"'&&!value&&!closed){quoted=true;continue;}if(c===delimiter||c==='\n'||c==='\r'){row.push(value);value='';closed=false;if(c!==delimiter){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(Boolean))rows.push(row);row=[];if(rows.length>MAX_EXCHANGE_TRACKS+1)throw new Error('CSVは20,000曲以下にしてください。');}continue;}if(closed&&c.trim())throw new Error('CSVの引用符の後に不正な文字があります。');if(!closed)value+=c;
 }if(quoted)throw new Error('CSVの引用符が閉じていません。');row.push(value);if(row.some(Boolean))rows.push(row);return rows;
}
const csvKey=s=>s.trim().toLowerCase().replace(/[\s_-]/g,'');
export function parseCSV(text,name){
 const [header,...rows]=parseCSVRows(text);if(!header)throw new Error('CSVが空です。');const keys=header.map(csvKey),pick=(r,...names)=>{for(const n of names){const i=keys.indexOf(csvKey(n));if(i>=0)return r[i]??'';}return undefined;};
 if(!keys.some(k=>['path','location','filename','filepath'].includes(k)))throw new Error('CSVにpath / location / filename列が必要です。');
 const entries=rows.map(r=>{const own=pick(r,'seekdeck_csv')==='1',str=v=>own&&v?.startsWith("'")?v.slice(1):v,t={path:str(pick(r,'path','location','filepath','filename'))};
 for(const [key,aliases]of Object.entries({name:['title','name','track title'],artist:['artist'],album:['album'],genre:['genre'],key:['key','tonality'],comment:['comment','comments']})){const v=pick(r,...aliases);if(v!==undefined)t[key]=str(v);}
 for(const [key,aliases]of Object.entries({bpm:['bpm','averagebpm'],duration:['duration','totaltime'],gridOffset:['grid_offset'],rating:['rating']})){const v=pick(r,...aliases);if(v?.trim()&&Number.isFinite(Number(v)))t[key]=Number(v);}
 if(keys.some(k=>/^cue[1-8]$/.test(k)))t.cues=Array.from({length:8},(_,i)=>{const v=pick(r,'cue'+(i+1));return v?.trim()&&Number.isFinite(Number(v))?Number(v):null;});
 for(const key of ['cueDetails','memoryCues']){const raw=pick(r,key);if(raw){let value;try{value=JSON.parse(str(raw));}catch{throw new Error(`CSVの${key}が不正なJSONです。`);}if(!Array.isArray(value))throw new Error(`CSVの${key}は配列にしてください。`);t[key]=value;}}
 return t;}).filter(t=>t.path);return collection(entries,name,true);
}
const safeCell=v=>{let s=String(v??'');if(/^[\s]*[=+\-@]|^['\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function writeMatchReport(rows){return '\uFEFF'+[['path','title','status'],...rows.map(r=>[r.source.path,r.source.name||'',r.status])].map(row=>row.map(safeCell).join(',')).join('\r\n')+'\r\n';}
export function writeCSV(tracks,options){const header=['seekdeck_csv','path','title','artist','album','genre','bpm','key','comment','duration','grid_offset','rating',...Array.from({length:8},(_,i)=>'cue'+(i+1)),'cueDetails','memoryCues'];return '\uFEFF'+[header.join(','),...tracks.map(t=>[1,exportPath(t,options),t.name,t.artist,t.album,t.genre,t.bpm,t.key,t.comment,t.duration,t.gridOffset,t.rating,...Array.from({length:8},(_,i)=>t.cues?.[i]??''),JSON.stringify(t.cueDetails||[]),JSON.stringify(t.memoryCues||[])].map(safeCell).join(','))].join('\r\n')+'\r\n';}
const singleLine=v=>String(v??'').replace(/[\r\n\0]/g,' ');
export function writeM3U(tracks,options){return '#EXTM3U\n'+tracks.map(t=>`#EXTINF:${Math.round(t.duration||0)},${singleLine(t.artist?t.artist+' - '+t.name:t.name)}\n${exportPath(t,options)}`).join('\n')+'\n';}
export function writePLS(tracks,options){return '[playlist]\r\n'+tracks.map((t,i)=>`File${i+1}=${exportPath(t,options)}\r\nTitle${i+1}=${singleLine(t.name)}\r\nLength${i+1}=${Math.round(t.duration||0)}`).join('\r\n')+`\r\nNumberOfEntries=${tracks.length}\r\nVersion=2\r\n`;}
function records(data){const view=new DataView(data.buffer,data.byteOffset,data.byteLength),result=[];let offset=0;while(offset<data.length){if(offset+8>data.length)throw new Error('crateのレコードヘッダーが途中で切れています。');const tag=String.fromCharCode(...data.subarray(offset,offset+4)),size=view.getUint32(offset+4);offset+=8;if(size>data.length-offset)throw new Error('crateのレコード長が不正です。');result.push([tag,data.subarray(offset,offset+size)]);offset+=size;if(result.length>MAX_EXCHANGE_TRACKS+100)throw new Error('crateのレコード数が上限を超えています。');}return result;}
function readUTF16(data){if(data.length%2)throw new Error('crateのUTF-16文字列が不正です。');return new TextDecoder('utf-16be',{fatal:true}).decode(data).replace(/\0+$/,'');}
function utf16(s){const out=new Uint8Array(s.length*2),v=new DataView(out.buffer);for(let i=0;i<s.length;i++)v.setUint16(i*2,s.charCodeAt(i));return out;}
function join(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
function record(tag,body){const out=new Uint8Array(8+body.length);out.set([...tag].map(c=>c.charCodeAt(0)));new DataView(out.buffer).setUint32(4,body.length);out.set(body,8);return out;}
export function parseCrate(data,name){const rows=records(data),version=rows.find(x=>x[0]==='vrsn');if(!version||!readUTF16(version[1]).includes('Serato ScratchLive Crate'))throw new Error('Serato .crate形式ではありません。');const entries=[];for(const [tag,body]of rows)if(tag==='otrk'){const p=records(body).find(x=>x[0]==='ptrk');if(p)entries.push({path:readUTF16(p[1])});}return collection(entries,name);}
export function cratePath(path,base){const p=normalizePath(path);if(!/^(\/|[a-z]:\/)/i.test(p))return p;const root=normalizePath(base||'');if(!root||!localPath(root)||!/^(\/|[a-z]:\/)/i.test(root))throw new Error('Serato crateの基準フォルダー（_Serato_の親）を絶対パスで指定してください。');const parts=p.split('/'),from=root.replace(/\/$/,'').split('/');if(/^[a-z]:$/i.test(parts[0])&&parts[0].toLowerCase()!==from[0]?.toLowerCase())throw new Error('Serato crateは同じドライブの音源ごとに書き出してください。');let common=0;while(common<from.length&&from[common]===parts[common])common++;return [...Array(from.length-common).fill('..'),...parts.slice(common)].join('/');}
export function writeCrate(tracks,options={}){const out=[record('vrsn',utf16('1.0/Serato ScratchLive Crate')),record('osrt',join([record('tvcn',utf16('song')),record('brev',new Uint8Array([0]))]))];for(const column of ['song','artist','bpm','key','length'])out.push(record('ovct',join([record('tvcn',utf16(column)),record('tvcw',utf16('0'))])));for(const t of tracks)out.push(record('otrk',record('ptrk',utf16(cratePath(exportPath(t,options),options.crateBase)))));return join(out);}
