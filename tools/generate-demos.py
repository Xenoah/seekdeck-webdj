"""Generate original, redistributable demo loops; no external audio samples."""
from pathlib import Path
import json, math, wave
import numpy as np

ROOT=Path(__file__).resolve().parents[1]/'dist'
(ROOT/'demos').mkdir(exist_ok=True)
specs=[('Midnight Circuit',124,45,'Am'),('Neon Current',128,41,'Fm'),('Afterimage',120,40,'Em'),('Low Orbit',130,38,'Dm')]
records=[]
for ix,(name,bpm,midi,key) in enumerate(specs):
    sr=22050; beat=60/bpm; duration=32*beat; n=round(duration*sr)
    left=np.zeros(n); right=np.zeros(n); rng=np.random.default_rng(7300+ix)
    def add(signal,start,pan=0):
        i=round(start*sr); lo=max(0,i); hi=min(n,i+len(signal))
        if hi<=lo:return
        a=signal[lo-i:hi-i];left[lo:hi]+=a*(1-pan*.3);right[lo:hi]+=a*(1+pan*.3)
    for b in range(32):
        t=np.arange(round(.34*sr))/sr
        kick=np.sin(2*np.pi*(48*t+5.5*(1-np.exp(-30*t))))*np.exp(-15*t)*.55
        add(kick,b*beat)
        if b%2==1:
            t=np.arange(round(.16*sr))/sr;noise=rng.normal(0,1,len(t));clap=noise*np.exp(-32*t)*.10;add(clap,b*beat,.1)
        for sub in [0,.5]:
            t=np.arange(round(.07*sr))/sr;noise=rng.normal(0,1,len(t));noise=np.diff(np.r_[0,noise]);add(noise*np.exp(-65*t)*(.025 if sub==0 else .04),(b+sub)*beat,(-1 if b%2 else 1)*.6)
        note=midi+([0,0,3,7][(b//4)%4]);freq=440*2**((note-69)/12)
        t=np.arange(round(beat*.8*sr))/sr;env=(1-np.exp(-150*t))*np.exp(-5*t)
        add((np.sin(2*np.pi*freq*t)+.16*np.sin(4*np.pi*freq*t))*.21*env,(b+.5)*beat,-.1)
        if b%2==0:
            t=np.arange(round(beat*1.4*sr))/sr;chord=np.zeros_like(t)
            for interval in [12,15,19,22]:
                f=440*2**((midi+interval-69)/12);chord+=(np.sin(2*np.pi*f*t)+np.sin(2*np.pi*f*1.003*t))*.018
            add(chord*(1-np.exp(-80*t))*np.exp(-5*t),(b+.75)*beat,.35)
        if ix%2:
            t=np.arange(round(.13*sr))/sr;f=440*2**((midi+24+[0,7,3,10][b%4]-69)/12);add(np.sin(2*np.pi*f*t)*np.exp(-28*t)*.08,(b+.25)*beat,-.5)
    audio=np.column_stack([left,right]);audio=np.tanh(audio*1.12)*.77
    ramp=np.minimum(1,np.arange(n)/128)*np.minimum(1,(n-1-np.arange(n))/128);audio*=ramp[:,None]
    pcm=(audio*32767).astype('<i2')
    file=f'demo-{ix}.wav'
    with wave.open(str(ROOT/'demos'/file),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes(pcm.tobytes())
    bins=2000;edges=np.linspace(0,n,bins+1,dtype=int);peaks=[round(float(np.max(np.abs(audio[edges[j]:edges[j+1],0])))*255) for j in range(bins)]
    records.append(dict(id=f'demo-{ix}',name=name,artist='SeekDeck · DEMO',filename=file,source=f'./demos/{file}',demo=True,duration=n/sr,size=n*4,bpm=bpm,bpmConfidence=100,key=key,keyConfidence=100,gridOffset=0,cues=[0,beat*8,beat*16,beat*24,None,None,None,None],rating=0,comment='SeekDeckオリジナルの合成デモ音源。',peaks=peaks,addedAt=0))
(ROOT/'demo-data.js').write_text('export const DEMOS = '+json.dumps(records,ensure_ascii=False,separators=(',',':'))+';\n')
print(f'Generated {len(records)} original loops ({sum((ROOT/"demos"/f"demo-{i}.wav").stat().st_size for i in range(4))/1048576:.1f} MiB)')

import subprocess
subprocess.run(['node',str(ROOT.parent/'tools/analyse-demo-waveforms.mjs')],check=True)
