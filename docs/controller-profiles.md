# コントローラーの設定と対応範囲

SeekDeckはWeb MIDI / WebHIDに公開される入力を扱います。MIDIの接続、音声出力の選択、ヘッドホンCUE出力はそれぞれ別の設定です。機種を接続しただけで、専用液晶・モーター・独自初期化が利用できるわけではありません。

## DDJ-400基本プロファイル

MIDIを接続してDDJ-400の入力を選び、基本プロファイルを読み込みます。同型の機器が複数ある場合も、選んだ入力だけに割り当てます。JSONファイルは [`dist/controller-profiles/ddj-400-basic.json`](../dist/controller-profiles/ddj-400-basic.json) です。汎用の「読み込む」でも利用できます。OSによってポート名が違う場合は、接続入力を指定して読み込んでください。

| DDJ-400の操作 | SeekDeck |
|---|---|
| PLAY / CUE / BEAT SYNC | デッキA・Bの再生、キュー、SYNC |
| RELOOP / EXIT | 現在のループを切り替え |
| ジョグ上面／側面、タッチ | スクラッチ／ナッジ |
| TEMPO | 再生速度。SeekDeckの±50%範囲 |
| CH FADER / TRIM / EQ | 音量、ゲイン、3バンドEQ。TRIM・EQの中央は0 dB |
| FILTER | 各デッキのフィルター |
| HOT CUEモードのPAD 1〜8 | 各デッキのホットキュー1〜8 |
| CROSSFADER / MASTER / HEADPHONES | クロスフェーダー、MASTER音量、CUE/MIX、ヘッドホン音量 |

52件の入力を[AlphaThetaの公式MIDIメッセージ表 v1.00](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-400/DDJ-400_MIDI_Message_List_E1.pdf)に照合しています。資料に記載された入力値で自動テストしていますが、実機による接続・操作・LED・音声出力の確認は未実施です。HOT CUEモードを選んで使ってください。ブラウザー選曲、LOAD、SHIFT、専用FX、PADの他モード、チャンネルメーター、初期化コマンドはこの基本プロファイルに含みません。

## プロファイルJSON

```json
{
  "format": "seekdeck-controller",
  "version": 1,
  "name": "My controller",
  "midiMappings": [
    {
      "target": "deck.0.play",
      "kind": "note",
      "channel": 0,
      "number": 11,
      "mode": "absolute",
      "invert": false,
      "feedback": {"kind": "note", "channel": 0, "number": 11, "on": 127, "off": 0}
    }
  ]
}
```

チャンネルは0〜15（画面表示のCH1〜16）、Note / CC番号は0〜127です。既存の `version: 1, midiMappings: [...]`、`mappings: [...]`、`hidMappings: [...]` も読み込めます。各配列は最大1000件。不正な行を含む場合は全体を拒否し、元の割り当てを保持します。スクリプトやSysExを実行する機能はありません。

| フィールド | 指定内容 |
|---|---|
| `target` | `deck.0.play` など、画面のMIDI Learnに対応する操作 |
| `kind` | `note` / `cc` / `pitchbend`。Pitch Bendの `number` は0 |
| `mode` | `absolute` / `cc14` / `relative-twos` / `relative-offset` / `relative-sign` |
| `device` | 任意。`メーカー::入力名` の完全一致 |
| `deviceName` | 任意。入力名の完全一致（大文字・小文字を無視） |
| `inputId` | 任意。ブラウザが提示する入力ID。同型2台の識別用 |
| `center` | 任意。ノブ中央に対応する正規化済み出力値0〜1。絶対値CC / Pitch Bendのみ |
| `feedback` | 任意。Note / CCの出力番号とON/OFF値。`false`でその割当の出力を禁止 |

`cc14`はCC 0〜31をMSB、そこから+32をLSBとして結合します。2つの入力を受け取るまで値を更新せず、切断後は両方を再取得します。Note入力や別ポートのCCは混ぜません。

`center`を指定すると、そのノブの中央から上下それぞれの端点まで線形に変換します。DDJ-400のEQは中央が0 dBになるよう `5/7`、TRIMは `2/3` を使用します。これはSeekDeckのパラメーター範囲に合わせた割り当てです。

LED出力はユーザーが選んだMIDI出力先に限り、フィードバックを有効にした場合だけ送ります。明示的な `feedback` がないNote割当には従来どおり0 / 127を返します。CC割当には、明示的な `feedback` がある場合だけ返します。送信値の重複を抑え、出力機器の再接続時には状態を再送します。すべての機器が同じLED命令を使うとは限りません。

## 切断・再接続

入力ポートごとに押下状態と14-bit CCを保持します。機器切断時はその入力のスクラッチ保持を解除します。音量・テンポの値は切断だけでは変更しません。同じデッキを複数の入力からタッチしている間は、最後の入力が離れるまでスクラッチ状態を維持します。

HIDはユーザーが選択した機器に入力リスナーを1つだけ付けます。その機器の切断で保持を解除し、ブラウザが同じ認可済み機器の再接続を通知した場合に再接続します。HIDのプロファイルには製品ID、Report ID、バイト位置、エンコーディング、範囲の指定が必要です。ベンダー独自の出力レポートや初期化は扱いません。

## 根拠と検証

- メッセージ番号・値・チャンネル: [DDJ-400 MIDIメッセージ表](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-400/DDJ-400_MIDI_Message_List_E1.pdf)
- ポート状態、切断通知、MIDI送受信: [W3C Web MIDI API](https://www.w3.org/TR/webmidi/)
- HID権限・接続イベント: [Chrome WebHID公式資料](https://developer.chrome.com/docs/capabilities/hid)
- 自動テスト: `node --test tests/controllers.test.mjs tests/core.test.mjs`

自動テストは仕様値の解釈、異常なJSON、切断・再接続、複数機器、LED送信を検証します。USB転送の遅延、実機ファームウェア差、OSのドライバー、実際のLED色、すべてのコントローラーとの互換性を保証するものではありません。
