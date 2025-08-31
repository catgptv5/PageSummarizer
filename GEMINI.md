# GEMINI.md

## プロジェクト概要

開いているウェブページの本文を要約し、要約結果をポップアップに表示するとともに、テキスト読み上げ（TTS）とSlack送信を行う Chrome 拡張機能です。

### 主な機能
- **ページ要約**: `Readability.js` で本文抽出 → LLM（LM Studio 優先、失敗時は OpenAI へフォールバック）で要約生成
- **選択範囲の要約**: 範囲選択して右クリック → 「選択範囲を要約」 → ポップアップで結果表示（アイコン押下と同一UI）
- **テキスト読み上げ（TTS）**: Offscreen Document 上で AIVIS API の音声ストリームを再生
- **Slack連携**: 要約結果とページURLを自動送信

## 仕組み / アーキテクチャ
- `background.js`
  - ページ要約・選択要約の実行（`summarizePage`, `summarizeSelectedText`）
  - LLM 呼び出し（LM Studio → OpenAI フォールバック）
  - Offscreen Document のライフサイクル管理
  - Slack 送信処理
  - コンテキストメニュー作成（`選択範囲を要約`）
  - 要約結果は `chrome.storage.session` に `summary-<tabId>` として保存し、直近は `summary-latest` にも保存

- `popup.html` / `popup.js`
  - 要約の表示、読み上げの再生/停止
  - 初期表示時に保存済みの要約を取得（選択要約トリガー時は自動要約せず結果待機）
  - `displaySummary` メッセージで即時反映

- `offscreen.html` / `offscreen.js`
  - AIVIS の TTS API を呼び出し、音声ストリーミングを再生
  - バックグラウンドとメッセージでやりとり（開始/停止、ハートビート）

- `manifest.json`
  - 権限: `activeTab`, `scripting`, `storage`, `offscreen`, `contextMenus`
  - ホスト許可: LM Studio (`http://localhost:1234/`), OpenAI, Slack, 任意URL
  - `web_accessible_resources`: `Readability.js`

## セットアップ（APIキー・設定）
オプションページ（`options.html`）から設定します。コードへ直書きは不要です。

- **OpenAI**
  - APIキー: `openai_api_key`
  - モデル: `openai_model`（未設定時は `gpt-5-mini-2025-08-07`）

- **AIVIS（TTS）**
  - APIキー: `aivis_api_key`
  - 読み上げモデルUUID: `aivis_model_uuid`
  - 備考: 現行の `offscreen.js` はデフォルトUUIDを使用。将来的に設定値を採用可能。

- **Slack**
  - Webhook URL: `slack_webhook_url`

設定は `chrome.storage.local` に保存されます。

## 使い方
1. ツールバーの拡張機能アイコンをクリック → ポップアップが開き、自動でページ要約を開始します。
2. または、ページ上でテキストを範囲選択 → 右クリック → 「選択範囲を要約」。ポップアップが開き、要約結果が表示されます。
3. 要約完了後、自動で読み上げが開始されます（停止/再生はポップアップから操作可能）。
4. 要約は自動で Slack に送信されます（Webhook 未設定時はエラーをポップアップに表示）。

## LLM接続の挙動
1. まず LM Studio（`http://127.0.0.1:1234/v1/chat/completions`）に接続を試行
2. 失敗時は OpenAI にフォールバック（モデルはオプションで指定）

## 権限について
- `activeTab`: アクティブタブのコンテンツ抽出
- `scripting`: `Readability.js` の注入など
- `storage`: 設定・要約結果の保存
- `offscreen`: Offscreen Document による音声再生
- `contextMenus`: 右クリックメニューからの要約起動

## 開発と実行
1. 本ディレクトリを `chrome://extensions` から「パッケージ化されていない拡張機能を読み込む」で読み込み
2. オプションページで必要な設定（OpenAI/AIVIS/Slack）を保存
3. 必要に応じて LM Studio をローカルで起動（起動していれば優先使用）

## トラブルシューティング
- 要約が開始しない: ネットワークエラーや LLM 接続失敗の可能性。LM Studio が停止している場合は OpenAI の設定を確認
- 読み上げされない: AIVIS APIキー未設定、または再生エラー。ポップアップの状態表示・コンソールログを確認
- Slack に送れない: Webhook 未設定または権限エラー。ポップアップにエラー表示

## ライブラリ
- `Readability.js`: 本文抽出
- `showdown.min.js`: Markdown → HTML（要約結果表示）
