export const MAX_WAVE_BINS=40000;

// Two low-pass crossover states produce low, mid, and high-band energy.
// Both stereo channels contribute energy independently, including opposite-phase audio.
export class WaveformAccumulator{
  constructor(frames,sampleRate,channels=1){
    if(!Number.isInteger(frames)||frames<1||!Number.isFinite(sampleRate)||sampleRate<1000)throw new Error('Invalid waveform source');
    this.frames=frames;this.sampleRate=sampleRate;this.channels=Math.max(1,Math.min(2,channels));
    this.bins=Math.max(1,Math.min(MAX_WAVE_BINS,frames,Math.ceil(frames/sampleRate*120)));
    this.peaks=new Float32Array(this.bins);this.energy=new Float64Array(this.bins*3);this.count=new Uint32Array(this.bins);
    this.low=new Float64Array(this.channels);this.upper=new Float64Array(this.channels);this.position=0;
    this.aLow=1-Math.exp(-2*Math.PI*200/sampleRate);this.aUpper=1-Math.exp(-2*Math.PI*2500/sampleRate);
  }
  push(channels){
    const length=channels[0]?.length||0;
    if(channels.length!==this.channels||channels.some(c=>c.length!==length)||this.position+length>this.frames)throw new Error('Invalid waveform chunk');
    for(let i=0;i<length;i++){
      const bin=Math.min(this.bins-1,Math.floor((this.position+i)*this.bins/this.frames)),offset=bin*3;
      for(let c=0;c<this.channels;c++){
        const value=Number.isFinite(channels[c][i])?channels[c][i]:0;
        this.low[c]+=(value-this.low[c])*this.aLow;this.upper[c]+=(value-this.upper[c])*this.aUpper;
        const low=this.low[c],mid=this.upper[c]-low,high=value-this.upper[c];
        this.energy[offset]+=low*low;this.energy[offset+1]+=mid*mid;this.energy[offset+2]+=high*high;
        this.peaks[bin]=Math.max(this.peaks[bin],Math.abs(value));this.count[bin]++;
      }
    }
    this.position+=length;
  }
  finish(){
    if(this.position!==this.frames)throw new Error('Incomplete waveform');
    const byte=x=>Math.round(Math.min(1,Math.max(0,x))*255);
    const low=[],mid=[],high=[];
    for(let i=0;i<this.bins;i++)for(const [band,target]of [[0,low],[1,mid],[2,high]])target.push(byte(Math.sqrt(this.energy[i*3+band]/Math.max(1,this.count[i]))*1.7));
    return {peaks:Array.from(this.peaks,byte),waveform:{version:1,low,mid,high}};
  }
}

export function normalizeWaveform(value,length){
  if(value?.version!==1||length<1||length>MAX_WAVE_BINS)return null;
  if(['low','mid','high'].some(k=>!Array.isArray(value[k])||value[k].length!==length))return null;
  const out={version:1};
  for(const key of ['low','mid','high'])out[key]=value[key].map(n=>Math.round(Math.max(0,Math.min(255,Number(n)||0))));
  return out;
}

export function frequencyColor(low,mid,high,alpha=1){
  const maximum=Math.max(low,mid,high);
  if(maximum<1)return 'rgba(92,112,130,'+alpha+')';
  const channel=x=>Math.round(24+231*Math.pow(Math.max(0,x)/maximum,.8));
  return 'rgba('+[low,mid,high].map(channel).join(',')+','+alpha+')';
}
