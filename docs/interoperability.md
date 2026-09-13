# Local interoperability

All parsing and writing happens on the device. An exchange playlist never causes a network request. Import audio first, then preview an XML/NML/CSV/crate match before committing. Source files are never overwritten.

| Format | Supported metadata | Boundaries |
| --- | --- | --- |
| rekordbox XML | Track metadata, tempo-map anchors, meter/beat, eight hotcues, loop names/colors, memory cues, playlist folder hierarchy/order | Existing source paths are required for another application's audio lookup; this is not a CDJ USB database |
| Traktor NML | Metadata, fixed BPM, multiple grid markers, eight hotcues/loops, memory cues, hierarchy/order | Variable-tempo export is rejected with a request to use XML; colors and proprietary analysis are unavailable |
| CSV | Metadata, eight cues, loop details, memory cues, tempo map and grid-marker arrays | Playlist folder hierarchy is available through XML/NML |
| Serato crate | Track paths and order | Cue information lives in the audio tags, not the crate |
| MP3 ID3v2.3/v2.4 | Title, artist, album, genre, key, BPM, unnamed comments; Serato Markers2, legacy Markers_, BeatGrid | Only MP3 containers; unsupported compressed/encrypted tags are reported; source audio remains playable if metadata fails |

## MP3 workflow

1. Add an MP3 through the audio picker or audio-folder picker. Its standard ID3 metadata and supported Serato cues/grids are imported locally.
2. Re-adding an existing audio file retains your local edits. To replace them with the source MP3's tags, select the track and use **選択曲のMP3タグを再読み込み**, review the content, then apply. Canceling the preview leaves edits intact.
3. Make edits in SeekDeck. Saved Serato loops are kept in the memory-cue collection, separate from the eight hotcue slots. Loop slot identifiers and lock flags are retained.
4. Select the track in the library and open **他ソフトとのファイル交換 → 選択曲のタグ付きMP3コピー**. The download is named `original-SeekDeck.mp3`.
5. Import the downloaded copy into the other application and verify its cue positions before performing.

Writing keeps the compressed MPEG payload and unrelated ID3 frames (including artwork) byte-identical. It replaces supported text fields, writes both Serato marker generations consistently, and preserves unknown Markers2 entries such as FLIP. The original local file and SeekDeck's stored audio are unchanged. Empty supported text values clear the corresponding tag. BPM's ID3 integer field is rounded; the Serato beatgrid carries its floating-point BPM.

The writer deliberately refuses special tag/frame flags, malformed metadata, non-MP3 payloads, more than nine distinct saved loops, legacy-marker positions above 16,777.215 seconds, and tempo-change anchors that cannot be represented as an integer beat count. Serato cue names are limited to 48 UTF-8 bytes; longer names are shortened in the downloaded copy. Do not treat a tagged MP3 copy as a complete Serato database backup.

Decoder delay/padding handling can differ across applications and MP3 encoders. Positions use the documented Serato milliseconds directly; no unverified encoder-offset compensation is applied. Commercial-application import, hardware players, FLAC/M4A/AIFF tag containers, Serato database V2 and CDJ USB database generation still require separate work and real application/device verification.

## Sources and verification

The binary codec is independently implemented from the format research by Jan Holthuis, without copying its example audio or implementation:

- [Serato Markers2 format](https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_markers2.md)
- [Legacy Serato Markers_ format and precedence](https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_markers_.md)
- [Serato BeatGrid format](https://github.com/Holzhaus/serato-tags/blob/main/docs/serato_beatgrid.md)
- [Serato container mappings](https://github.com/Holzhaus/serato-tags/blob/main/docs/fileformats.md)
- [ID3v2.3 specification](https://id3.org/id3v2.3.0) ([specification mirror](https://mutagen-specs.readthedocs.io/en/latest/id3/id3v2.3.0.html))
- Existing XML/NML/crate sources are in [the fixture notes](../tests/fixtures/README.md).

Node tests create independent binary fixtures with explicit positions, RGB bytes and integer sizes; test legacy precedence, malformed-length refusal, Unicode, retained opaque records, and untouched audio/artwork. Browser tests exercise XML/NML hierarchy and metadata import/export. These are structural and browser checks, not a claim of validation in every commercial application release.
