import {WaveformAccumulator} from './waveform.js';
let analysis;
self.onmessage=({data})=>{
  try{
    if(data.type==='start')analysis=new WaveformAccumulator(data.frames,data.sampleRate,data.channels);
    else if(data.type==='chunk')analysis.push(data.channels);
    else if(data.type==='finish'){
      const result=analysis.finish();analysis=null;self.postMessage({id:data.id,result});return;
    }else throw new Error('Unknown waveform request');
    self.postMessage({id:data.id,ok:true});
  }catch(error){analysis=null;self.postMessage({id:data.id,error:error.message});}
};
