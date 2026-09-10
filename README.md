# SeekDeck

プロジェクト／リポジトリ名は `seekdeck-webdj`、アプリ名は **SeekDeck** です。

ローカル処理のブラウザDJアプリ。依存ライブラリ・APIキー・バックエンド・音源アップロードを必要としない静的ES Modulesアプリです。再生を含むWeb APIはHTTPSまたはlocalhostが必要です。

`dist/` を静的ホストから配信します。ファイルを `file://` で開く形式には対応しません。初回起動後はService Workerでアプリと4つのオリジナルデモをキャッシュします。音源を扱うリクエストは同じオリジンのデモ音源のみです。ユーザー音源はIndexedDBへ保存します。

## v0.1.0 — 初回リリース

4デッキのローカルDJ環境を試せる初期版です。商用DJソフトとの完全互換、全コントローラー対応、実測した低遅延を保証する段階ではありません。

[リリースと配布ZIP](https://github.com/Xenoah/seekdeck-webdj/releases/tag/v0.1.0) · [リリースノート](releases/v0.1.0.md)

## 起動方法

配布ZIPを展開するか、このリポジトリを取得します。Python 3がある環境では、プロジェクトのフォルダーで次を実行してください。追加パッケージは不要です。

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

ブラウザで `http://localhost:8000` を開き、デモ曲の再生ボタンを押します。Windowsで `python` が見つからない場合は `py -3` を使用してください。停止はターミナルで `Ctrl+C`。音声・機器APIの対応はブラウザと実機に依存します。

HTTPSの静的ホストへ配信する場合は、`dist/` の内容を配信ルートに置きます。開発時の検証にはNode.js 24で `npm test` と `npm run check` を実行します。`npm install` は不要です。

## 実装範囲

- 4デッキ、AudioWorklet PCM再生、可変速度、逆再生、ジョグ、スクラッチ、SLIP
- 8ホットキュー、一定BPMグリッドの量子化、マニュアル／自動ループ、ロール、ビートジャンプ
- BPM／キー推定Worker、グリッド編集、TAP、拍位置・テンポのSYNC（押した時に同期）
- TRIM、3バンドEQ、フィルター、Echo／Reverb／Flanger、フェーダー、クロスフェーダー割当と3曲線
- 独立したキー／テンポ操作（試験的な2-grain overlap-add DSP。商用DSP音質とは非同等）
- 8サンプル、最大16ボイス、最大30秒の範囲指定
- MASTER録音、CUEのステレオ分岐／4ch／別デバイス出力（API・機器依存）
- 24列グリッドで移動／リサイズ／表示切替、名前付き配置、3プリセット、30操作Undo／Redo
- 音源・曲情報・クレート・キュー・配置・ミキサー・MIDI/HID割当をIndexedDBに保存
- 再生位置を5秒ごと＋pagehide時に保存。復元時には自動再生しない
- セッションと曲情報のJSON入出力（音声は別）、元音源のダウンロード
- MIDI Learn（Note／CC／Pitch Bend）、14-bit CC、相対3形式、Note LEDフィードバック
- HID入力レポートの機種別バイトマッピングJSON。ハンドシェイク／専用出力は非対応
- rekordbox XMLの曲情報・BPM・初期グリッド・ホットキュー0–7・プレイリスト入出力。ファイル名が一意に一致する音源のみ
- WebMCPの状態読取、配置プリセット、停止デッキへの一括ロード（対応ブラウザのみ）

## 未実装・制限

**Rekordbox / Serato DJの完全な代替ではありません。全DJコントローラー対応を保証しません。**

AIステム分離、DVSタイムコード、動画／照明、配信サービス、可変BPMグリッド、各社独自データベース、CDJ USB書出、メーカー独自の機器初期化・液晶・モーターは未実装です。HIDは既知のレポート形式と対応ブラウザが必要です。すべてのハードウェアの実機テストは未実施です。

EQはWeb Audio BiquadFilter、リミッターはDynamicsCompressorです。放送用true-peakリミッターではありません。Granularキー固定は音源によって位相・トランジェントのアーティファクトを生じます。サーバーへの音源送信やクラウドAI処理で代用していません。

解析は冒頭最大180秒、推定BPM 65〜180、手動入力20〜400。SYNCは一定BPMで位相を合わせるワンショット同期。元ファイルのメタデータタグは解析せずファイル名の `Artist - Title` を分割します。コーデック対応は `decodeAudioData` に依存します。

上限：元音源300 MiB／曲、1時間／曲、デコードPCM合計512 MiB、4デッキ＋8サンプルの音源を保持。読み込み時には一時的なPCMコピーが発生するため実際のプロセスメモリは上限を超えます。大容量音源・モバイルではメモリ制限に注意。録音は停止までメモリ保持します。

保存は端末・ブラウザ・オリジン単位。JSONに音声データは含みません。ブラウザデータ削除やストレージ退避時に消えるため、元音源とJSONを保管してください。保持リクエストはブラウザが拒否する場合があります。

名称変更後も旧 ORBIT DJ の保存データを引き継ぐため、IndexedDBとlocalStorageの識別子、およびセッションJSONの形式名は維持しています。

## 検証

`npm test` はPCM処理をNodeで実行し、4出力・時間進行・ループ・逆再生・SLIP／ロール復帰・サンプル出力・音程処理を検証します。BPM解析を既知クリック信号で検証し、保存データ正規化／MIDIデコード／クロスフェード／拍位置同期も検証します。`npm run check` は構文・ローカル参照・Service Workerキャッシュ一覧を確認します。

実ブラウザの操作テスト・機器接続テスト・実測レイテンシー・長時間連続演奏・音質評価は未実施です。WebMCPは対応ブラウザでの検証環境がないため未検証です。

## 構成

- `dist/audio/processor.js`: AudioWorklet用PCMトランスポート。描画とは独立。サンプル計算ループではメモリ確保せず、25 Hzで状態メッセージを送信
- `dist/audio/engine.js`: Web Audioルーティング、EQ、FX、出力、録音、PCMキャッシュ
- `dist/audio/analysis.js`: 自己相関BPM・Goertzelクロマのキー推定Worker
- `dist/app.js`: 状態・演奏操作・保存制御
- `dist/events.js`, `ui.js`, `visuals.js`, `dialogs.js`: UIとイベント
- `dist/storage.js`: IndexedDBトランザクション
- `dist/controllers.js`: MIDIとHIDの入力プロファイル
- `tools/generate-demos.py`: 4つのオリジナル合成デモの再生成（NumPy使用）

## 一次資料

- Web MIDI: https://www.w3.org/TR/webmidi/
- WebHID: https://developer.chrome.com/docs/capabilities/hid
- AudioContext.setSinkId: https://developer.chrome.com/blog/audiocontext-setsinkid
- Web Audio: https://www.w3.org/TR/webaudio/

外部商標は互換対象の説明のみです。デモ音源はこのプロジェクト内で合成し、外部サンプルを使用していません。
