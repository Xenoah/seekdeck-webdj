# コントローラーの設定と対応範囲

SeekDeckはWeb MIDI / WebHIDに公開される入力を扱います。MIDIの接続、音声出力の選択、ヘッドホンCUE出力はそれぞれ別の設定です。機種を接続しただけで、専用液晶・モーター・独自初期化が利用できるわけではありません。

## DDJ-FLX4（既定プリセット）

新規セッションではDDJ-FLX4のMIDI割当が設定されています。「MIDIを接続」から機器へのアクセスを許可してください。既存セッションのカスタム割当は保持します。以前の手動マッピングを変更する場合は、MIDI設定の「機種別プリセット」で **Pioneer DJ DDJ-FLX4** を選び、「既存MIDI割当を置き換えて適用」を押してください。MIDI割当だけを置き換え、HID割当、ミキサー、レイアウト、読み込んだ曲、再生状態は保持します。

初期設定は入力名 `DDJ-FLX4` に一致するMIDIポートだけに反応します。同型2台を使う場合やOSによってポート名が異なる場合は「割り当て先のMIDI入力」で接続した入力を選んで適用してください。JSONは [`dist/controller-profiles/ddj-flx4.json`](../dist/controller-profiles/ddj-flx4.json) です。MIDI設定からダウンロードして、汎用の「読み込む」でも利用できます。

| DDJ-FLX4の操作 | SeekDeck |
|---|---|
| PLAY / CUE / BEAT SYNC | デッキA・Bの再生、キュー、SYNC |
| ジョグ上面タッチと回転 | 回転量に比例したスクラッチ。手を止めると音声位置を保持し、離すと元の再生状態に戻る |
| ジョグ側面 / Vinyl OFF時の回転 | 再生中は一時的な速度微調整。回転を止めると元のテンポに戻る |
| SHIFT＋ジョグ | 曲内の移動 |
| TEMPO | 14-bitの再生速度。SeekDeckの±50%範囲 |
| CH FADER / TRIM / EQ / FILTER | 14-bitの音量、ゲイン、3バンドEQ、フィルター。TRIM・EQの中央は0 dB |
| CROSSFADER / MASTER / HEADPHONES / CH CUE | クロスフェーダー、MASTER音量、CUE/MIX、ヘッドホン音量、各デッキのCUE |
| BROWSE / LOAD | ライブラリでの選曲、各デッキへのロード |
| IN / OUT / 4 BEAT・EXIT / SHIFT＋4 BEAT / ループ長変更 | ループ開始・終了位置、4拍ループ・解除、前回の範囲での再ループ、ループ長の半分・2倍 |
| HOT CUEのPAD 1〜8 / SHIFT＋PAD | ホットキューの設定・呼び出し / 削除 |
| BEAT LOOP / BEAT JUMP / SAMPLERのPAD | 拍単位のループ、前後移動、SeekDeckのサンプラースロット |
| FX SELECT / BEAT / LEVEL・DEPTH / ON・OFF / CH SELECT | SeekDeckのエフェクト種類、拍倍率、ミックス量、有効・無効、対象デッキ |

メッセージ番号・チャンネル・14-bit CCの組は[AlphaThetaのDDJ-FLX4公式MIDIメッセージ表 v1.0](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-FLX4/DDJ-FLX4_MIDI_message_List_E1.pdf)に基づきます。FXはSeekDeckのecho / reverb / flangerを操作します。rekordbox固有のSmart CFX、Smart Fader、PAD FX、Keyboard、Key Shiftは未対応です。実機による接続・操作感・LED・音声出力の確認は未実施です。

BEAT LOOPのPAD 1〜8は0.25 / 0.5 / 1 / 2 / 4 / 8 / 16 / 32拍、BEAT JUMPは−1 / ＋1 / −2 / ＋2 / −4 / ＋4 / −8 / ＋8拍です。各PADは本体で該当モードを選んで使用してください。SAMPLERは両デッキともSeekDeckのスロット1〜8を操作します。

### 上面スクラッチと側面微調整

DDJ-FLX4のジョグは中央が64の相対値です。時計回りの1目盛りは65、反時計回りの1目盛りは63なので、`relative-offset` で **入力値−64** として解釈します。例えば65を `relative-twos` として解釈すると−63となり、方向と移動量を誤ります。

デッキA / BにはMIDIチャンネル0 / 1を使います。上面タッチはNote 54（SHIFT時は103）、上面回転はCC 34、側面はCC 33、Vinyl OFF時の回転はCC 35、SHIFT回転はCC 41です。上面の回転量と側面の微調整を別々に処理します。スクラッチは受信した移動量を音声エンジンに渡すため、イベントの到着間隔が多少変わっても同じ回転量を保ちます。

スクラッチの初期感度は[MixxxのDDJ-FLX4実装](https://github.com/mixxxdj/mixxx/blob/07e2488298bcf87e2d3c6b288d8eac8b5f19190e/res/controllers/Pioneer-DDJ-FLX4-script.js)の720目盛り/回転、33⅓ rpmを参考に、1目盛り＝0.0025秒（1回転＝1.8秒）としています。この感度はメーカー公称仕様ではありません。側面は再生中に1目盛りあたり0.6%、最大±8%の速度補正を行い、最後の回転入力から90 ms後に元の速度へ戻します。通常の補正でTEMPOの保存値は変えません。SYNC中に側面を回した場合はSYNCを解除し、その時点の再生速度を基準に微調整します。

## DDJ-400基本プロファイル

MIDI設定の「機種別プリセット」で **Pioneer DJ DDJ-400 · Basic** を選択できます。MIDIを接続してDDJ-400の入力を選び、基本プロファイルを読み込みます。同型の機器が複数ある場合も、選んだ入力だけに割り当てます。JSONファイルは [`dist/controller-profiles/ddj-400-basic.json`](../dist/controller-profiles/ddj-400-basic.json) です。汎用の「読み込む」でも利用できます。OSによってポート名が違う場合は、接続入力を指定して読み込んでください。

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
| `jogMode` | 相対値のジョグのみ。`touch`＝上面、`bend`＝側面、`vinyl-off`＝スクラッチを解除して速度微調整、`seek`＝曲内移動 |
| `sensitivity` | 相対値のジョグのみ。0より大きく10以下の倍率。省略時は1倍 |
| `feedback` | 任意。Note / CCの出力番号とON/OFF値。`false`でその割当の出力を禁止 |

`cc14`はCC 0〜31をMSB、そこから+32をLSBとして結合します。最初に両方の入力を受け取るまで値を更新せず、切断後は両方を再取得します。DDJ-FLX4は操作ごとに新しいMSB/LSBの組を待ち、前回の片方を混ぜた一瞬の値飛びを防ぎます。汎用機器では変更された片方だけを送る実装にも対応するため、受信済みの他方を保持します。Note入力や別ポートのCCは混ぜません。

`center`を指定すると、そのノブの中央から上下それぞれの端点まで線形に変換します。DDJ-FLX4・DDJ-400のEQは中央が0 dBになるよう `5/7`、TRIMは `2/3` を使用します。これはSeekDeckのパラメーター範囲に合わせた割り当てです。

DDJ-FLX4のMIDI Learnでは機種の既知のメッセージを識別し、14-bitのMSB/LSBの組とジョグの相対値方式を使用します。ジョグを学習する際は上面・側面・SHIFT回転とタッチをまとめて設定し、側面の割当が抜けることを防ぎます。感度を調整する場合は書き出したJSONのジョグ割当へ `sensitivity` を追加して読み込んでください。

LED出力はユーザーが選んだMIDI出力先に限り、フィードバックを有効にした場合だけ送ります。明示的な `feedback` がないNote割当には従来どおり0 / 127を返します。CC割当には、明示的な `feedback` がある場合だけ返します。送信値の重複を抑え、出力機器の再接続時には状態を再送します。すべての機器が同じLED命令を使うとは限りません。

## 切断・再接続

入力ポートごとに押下状態と14-bit CCを保持します。機器切断時はその入力のスクラッチ保持を解除します。音量・テンポの値は切断だけでは変更しません。同じデッキを複数の入力からタッチしている間は、最後の入力が離れるまでスクラッチ状態を維持します。

HIDはユーザーが選択した機器に入力リスナーを1つだけ付けます。その機器の切断で保持を解除し、ブラウザが同じ認可済み機器の再接続を通知した場合に再接続します。HIDのプロファイルには製品ID、Report ID、バイト位置、エンコーディング、範囲の指定が必要です。ベンダー独自の出力レポートや初期化は扱いません。

## 根拠と検証

- メッセージ番号・値・チャンネル: [DDJ-FLX4 MIDIメッセージ表](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-FLX4/DDJ-FLX4_MIDI_message_List_E1.pdf)
- DDJ-FLX4スクラッチ初期感度の参考: [MixxxのDDJ-FLX4スクリプト](https://github.com/mixxxdj/mixxx/blob/07e2488298bcf87e2d3c6b288d8eac8b5f19190e/res/controllers/Pioneer-DDJ-FLX4-script.js)
- メッセージ番号・値・チャンネル: [DDJ-400 MIDIメッセージ表](https://downloads.support.alphatheta.com/software_info/dj-controllers/DDJ-400/DDJ-400_MIDI_Message_List_E1.pdf)
- ポート状態、切断通知、MIDI送受信: [W3C Web MIDI API](https://www.w3.org/TR/webmidi/)
- HID権限・接続イベント: [Chrome WebHID公式資料](https://developer.chrome.com/docs/capabilities/hid)
- 自動テスト: `node --test tests/controllers.test.mjs tests/core.test.mjs`
- ブラウザー統合テスト: `tests/browser/controllers.mjs`（`node tests/browser/smoke.mjs`から実行）

自動テストは仕様値の解釈、異常なJSON、切断・再接続、複数機器、LED送信を検証します。ブラウザー統合テストでは疑似Web MIDIポートから公式仕様のバイト列を送り、既定プリセットとカスタム割当の保持、再生操作・14-bitミキサー・スクラッチ位置・タッチ解除・側面の一時的な速度補正を検証します。選曲からLOAD・音声再生までの流れ、ループ範囲の再呼び出し、SHIFTで削除したキューの保存、FXの実際の音声バスへの反映も検証対象です。USB転送の遅延、実機ファームウェア差、OSのドライバー、実際のLED色、すべてのコントローラーとの互換性を保証するものではありません。
