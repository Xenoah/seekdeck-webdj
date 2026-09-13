# ユーザーが追加する公開サンプル

追加先は **`dist/samples/audio/`** です。初期状態に音声ファイルはありません。

## GitHubから追加

1. リポジトリで `dist/samples/audio/` を開く。
2. **Add file → Upload files** で自分の音源を選択し、mainへコミットする。
3. サンプル一覧生成のActionsとPagesの更新完了を待つ。
4. SeekDeckを再読み込みし、ライブラリから音源をデッキへロードする。

このフォルダーに入れた音源は公開リポジトリとGitHub Pagesから取得できます。公開しない音源は、アプリの「音源を追加」で端末内に保存してください。

## ローカルで追加

`dist/samples/audio/` にコピーし、リポジトリ直下で次を実行します。下位フォルダーにも対応しています。

```sh
npm run samples:index
```

生成された `dist/samples/catalog.json` を音源と一緒にcommit / pushしてください。確認だけ行う場合は `node tools/index-samples.mjs --check` を使います。GitHub Actionsの一覧生成を使わない場合もこの方法で更新できます。

## 制約と読み込み

| 項目 | 内容 |
| --- | --- |
| ファイル | 1件50 MiB以下、空ファイル不可 |
| 合計 | 圧縮音源の合計512 MiB以下、最大1000件 |
| 拡張子 | WAV、MP3、FLAC、AIF / AIFF、M4A、OGG、OPUS、AAC、WEBM、MP4 |
| パス | `audio/` 配下だけ。外部URL、相対参照、シンボリックリンクは不可 |
| 名称 | 日本語・途中のスペース可。先頭`.`、`% : # ?`、バックスラッシュ、制御文字、前後の空白は不可 |
| 曲情報 | `Artist - Title.wav` なら名称を分割。BPMと曲長は初回ロードで解析 |
| 実行 | HTTPサーバーまたはGitHub Pagesを使用。`file://` 直開きでは動作しない |

圧縮音源のサイズとデコード後のメモリ量は異なります。アプリでは1時間・デコード512 MBの制限も適用します。大量の曲を同時ロードせず、必要なデッキやパッドだけにロードしてください。コーデック対応は実行ブラウザに依存します。

サンプル一覧の取得だけでは音声をダウンロードしません。音源を選んだときに同じサイトから取得し、この端末で解析・再生します。初回ロード前は曲長0秒、BPM120を仮値として持ち、BPMの確信度を0にします。アプリはこの段階を未解析として表示します。

## 開発・保守

`node tools/index-samples.mjs` は音源をソートし、サイズとSHA-256を確認して決定的なcatalogを生成します。生成日時を含めないため、音源の変更がない実行は差分を作りません。曲IDは相対パスと内容ハッシュから生成し、差し替えた曲に古いキューや波形を誤適用しません。

`discoverSampleTracks()` はcatalogの形式・件数・合計サイズ・各パス・重複を検査します。catalogは1 MiB上限でストリーム受信を制限します。音声URLは各階層をエンコードし、`resolveSampleSource()` で同じサイトの `samples/audio/` 配下だけに制限します。リダイレクトを許可しません。

追加・削除・差し替え後はcatalogを再生成してください。既にブラウザへ読み込んだ音声は、そのブラウザの保存データとして残る場合があります。

## 一覧の自動更新

Sample catalogワークフローはmainの最新内容から一覧を生成し、変更されたcatalogだけをコミットします。GitHub Pagesがブランチ公開なら再ビルドを要求し、Actions公開なら既存のPagesワークフローを実行します。Pagesの設定は変更しません。処理中にmainが更新された場合は、変更を上書きせず再実行の案内で止まります。

GitHubの画面で扱えるアップロードサイズにも制限があります。画面から追加できないファイルはGitでpushするか、端末内の「音源を追加」を使ってください。

参照：[GitHub Pages再ビルドAPI](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)、[ワークフローの起動とGITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。
