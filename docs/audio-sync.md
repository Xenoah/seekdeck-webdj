# Audio sync and tempo grids

SYNC is a persistent follower setting. Pressing it once matches the nearest beat phase, then the AudioWorklet follows the selected master's local BPM and playback speed. Pressing it again releases the follower at its current speed. Manual tempo changes release sync.

The processor snapshots all four transports at the start of each rendering quantum. This prevents a deck rendered earlier in the output array from using a different time reference than its master. The main thread is not responsible for keeping the transports synchronized. Phase recovery changes speed by at most 2.5% of the target rate, within the deck's overall 0.5–1.5 rate range; it does not repeatedly seek through the audio.

Scratching, reverse playback, and roll on either deck suspend synchronization. Releasing those controls allows gradual phase recovery. A stopped master provides tempo only; the follower continues playing. A requested ratio beyond the rate limits is reported as `range`, rather than advertised as a lock. `aligning` means phase recovery is in progress; `locked` means the phase difference is under 0.01 beats. Cyclic follower relationships are rejected.

## Variable tempo

Tracks may carry `tempoMap: [{ time, bpm, beat, meter }]`. Times are source seconds; BPM is constant until the next anchor. `beat`, `meter`, and optional `denominator` (default 4) retain the imported musical bar metadata. The processor derives a separate `cumulativeBeat` coordinate starting at `gridOffset` for continuous phase and inverse time calculations. Anchor inputs are bounded to 4,096 entries; unknown BPM changes still require manual grid editing or import. Audio analysis does not infer a variable tempo map automatically. BPM and the transport beat coordinate use quarter notes; meter and denominator are retained as exchange metadata, not used to reinterpret BPM.

Beat jumps, quantized cue positions, and beat-counted loops can use `quantizeTrack` and `advanceBeats`, which integrate across tempo changes. A five-beat loop spanning two beats at 120 BPM and three at 90 BPM lasts three seconds, rather than assuming the initial BPM for its entire length.

## Key-lock correction

The optional two-grain overlap-add mode now compares both stereo channels with a normalized correlation score and refines the common source offset to one sample. The earlier left-only matching lost the useful waveform reference for right-only material, producing unstable grain joins. A shared offset retains stereo timing, and silent references skip the search. Reference and transport working arrays are preallocated.

This remains an experimental time/pitch processor. The correction addresses a reproducible stereo failure; it does not establish equal sound quality to commercial DJ software, nor solve every transient, aliasing, or extreme-shift artifact.

## Verification

Run `node --test tests/audio.test.mjs tests/audio-sync.test.mjs tests/beatgrid.test.mjs`.

The tests render the actual processor with a simulated audio clock. They cover later master-rate changes, a master appearing after its follower in the render order, variable BPM boundaries, bounded recovery after scratching, paused-master behavior, and rejected cycles. Rendered stereo tests check a sustained 440 Hz tone, channel-swap symmetry, absence of cross-channel bleed, and grain-join amplitude stability. These checks are repeatable software tests; they are not measurements of physical device latency or listening tests on a music corpus.

Design references: [W3C Web Audio API 1.1](https://www.w3.org/TR/webaudio-1.1/) describes AudioWorklet rendering; [Roelands and Verhelst, WSOLA structures and evaluation (1993)](https://www.isca-archive.org/eurospeech_1993/roelands93_eurospeech.html) describes waveform similarity for overlap-add time-scale modification. SeekDeck's implementation is original code using that general approach.
