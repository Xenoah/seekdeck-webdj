# Interoperability fixtures

These are small, independently authored metadata fixtures for the project's own demos. No external audio or third-party music metadata is included.

The explicit values exercise format differences: rekordbox loop type 4 and seconds, Traktor loop type 5 and milliseconds, hotcue slot 0, memory slot -1, Windows `/:` directory separators, UTF-8 names, nested playlists, and repeated track references.

Primary implementations consulted:

- [DJ Data Converter: rekordbox markers](https://github.com/digital-dj-tools/dj-data-converter/blob/a0edb2e5eb3bf7e63784717bffb4020b8eda7873/src/converter/rekordbox/position_mark.clj)
- [DJ Data Converter: Traktor cue units and types](https://github.com/digital-dj-tools/dj-data-converter/blob/a0edb2e5eb3bf7e63784717bffb4020b8eda7873/src/converter/traktor/cue.clj)
- [Mixxx: Traktor locations and playlists](https://github.com/mixxxdj/mixxx/blob/main/src/library/traktor/traktorfeature.cpp)
- [Mixxx: Serato record lengths and UTF-16BE paths](https://github.com/mixxxdj/mixxx/blob/main/src/library/serato/seratofeature.cpp)
- [seratopy: crate-relative track paths](https://github.com/sharst/seratopy/blob/c94d6dc5b57beed7176f14b139f2dc07781676f0/seratopy.py)

The Node crate test constructs its fixture independently with Buffer UTF-16LE byte swapping and big-endian record headers. Browser tests compare explicit expected times before exercising import/export roundtrips.

Passing these tests verifies structural compatibility with these documented implementations; it is not a substitute for testing every release of the commercial applications.
