# Past Lead SMS Tracking MVP

過去登録リード向けのユニークリンクを生成し、リンククリックをGoogle Apps Scriptへ到達させるMVPです。

現在の最小版では、管理画面でリンク生成だけを行います。Twilio SMS送信、返信LP、電話予約LP、求人LP分岐はコード上に残していますが、管理画面では使わない状態にしています。

最重要ルール: GASは対象スプレッドシートに紐づけて作成し、`@OnlyCurrentDoc`でそのスプレッドシート内だけを操作します。既存DBタブには、書き込み・列追加・行追加・書式変更を一切しません。Render側へDB照会結果は返さず、クリック時にGAS内だけで必要な1行を照合します。書き込みはMVP用ログタブと`【記入用】Clickbot`だけです。

## ファイル構成

```text
package.json
server.js
.env.example
README.md
views/admin.ejs
views/reply_lp.ejs
views/call_lp.ejs
public/style.css
gas/tracking.gs
```

## ローカル起動方法

```bash
npm install
cp .env.example .env
npm start
```

起動後、`http://localhost:3000/admin`を開きます。

## .env設定方法

```text
PORT=3000
ADMIN_PASSWORD=管理画面パスワード
TWILIO_ACCOUNT_SID=Twilio Account SID
TWILIO_AUTH_TOKEN=Twilio Auth Token
TWILIO_FROM_NUMBER=Twilio送信元番号
GAS_WEBAPP_URL=GASのWebアプリURL
LOG_GAS_POST_URL=GASのWebアプリURL
TRACKING_SECRET=NodeとGASで共通の長いランダム文字列
JOBS_URL=求人一覧LP
```

`.env`はGitに含めないでください。

現時点のリンク生成だけなら、最低限必要なのは以下です。

```text
ADMIN_PASSWORD=
GAS_WEBAPP_URL=
LOG_GAS_POST_URL=
TRACKING_SECRET=
```

## Twilio設定方法

現時点のリンク生成だけではTwilio設定は不要です。SMS送信フェーズに進む場合は、TwilioでSMS送信可能な番号を用意し、`TWILIO_FROM_NUMBER`に設定します。

## Google Apps Scriptデプロイ方法

1. 対象スプレッドシートを開き、`拡張機能 > Apps Script`からコンテナ紐づきApps Scriptを作成します。
2. [gas/tracking.gs](gas/tracking.gs)の内容を貼り付けます。
3. スクリプトプロパティに`TRACKING_SECRET`だけを設定します。
4. `setupLogSheets()`を1回実行してログ用タブとヘッダーを作成します。
5. Webアプリとしてデプロイします。
6. 発行されたWebアプリURLを`GAS_WEBAPP_URL`と`LOG_GAS_POST_URL`に設定します。

## GASスクリプトプロパティ

```text
TRACKING_SECRET=
```

`TRACKING_SECRET`はNode側の`.env`と同じ値にしてください。

## DBタブと出力タブ

DBはコンテナ紐づきGASと同じスプレッドシート内の以下3タブだけを参照します。`IMPORTRANGE`などのシート関数は使いません。`【記入用】AI Slackbot`と`【記入用】SMS折返`は読み取り元として使いません。

```text
【閲覧用】
【閲覧用】タクシー
【閲覧用】スカウト
```

GAS内では`SpreadsheetApp.getActiveSpreadsheet()`だけを使います。`openById()`で別ファイルを開きません。照合時は電話番号列を`TextFinder`で検索し、見つかった1行のC:Fだけを読みます。

書き込みは次の許可シートだけに限定しています。

```text
LinkIndex
SendLogs
PublicClickEvents
【記入用】Clickbot
```

## ログ用シートのヘッダー

`setupLogSheets()`を実行すると、存在しないログ用タブを作り、以下のヘッダーを入れます。

### LinkIndex

```text
created_at, candidate_key, candidate_no, db_sheet_key, db_sheet_name, match_status, matched_count, matched_sheets, link_id, campaign_id, channel, destination_type, tracking_url, lp_url, public_tracking_code, send_url, final_message, name, phone_number, phone_without_leading_zero, email, address, license, age, gender, station, prefecture, applied_at, apply_media, apply_route, status, raw_input_phone, raw_input_message
```

DB由来の氏名・住所などはリンク生成時には書き込みません。クリック時の照合に必要な電話番号、公開コード、生成URLだけを保持します。

### SendLogs

```text
timestamp, candidate_key, candidate_no, db_sheet_name, match_status, matched_count, matched_sheets, name, phone_number, email, address, license, prefecture, campaign_id, link_id, channel, destination_type, tracking_url, send_url, final_message, twilio_sid, twilio_status, error_message, raw_json
```

この最小安全版では、SMS本文やTwilioの生レスポンスはGAS側で空欄化します。

### PublicClickEvents

SMS本文に貼った `https://driver-concierge.jp/b/a36063` のようなリンク本体を踏んだタイミングで出力します。

```text
timestamp, public_tracking_code, clicked_path_key, clicked_url, lp_path, link_id, lookup_status, clickbot_output_status
```

`clicked_path_key` は `.jp/` 以降の `/` を `-` に置き換えた値です。

```text
https://driver-concierge.jp/scout/jrbus/a36063 -> scout-jrbus-a36063
```

同時に同じスプレッドシート内の`【記入用】Clickbot`へ、4行目以降に次の形式で追記します。

```text
A列: 電話番号
B列: 住所
C列: お名前
D列: clicked_path_key
```

## Renderデプロイ方法

1. このフォルダをGitHubに置きます。
2. RenderでNew Web Serviceを作成します。
3. RuntimeはNode、Build Commandは`npm install`、Start Commandは`npm start`にします。
4. `.env.example`と同じ環境変数をRenderに設定します。
5. デプロイ後、GAS WebアプリURLと同じ`TRACKING_SECRET`をRender環境変数に設定します。

## 管理画面の使い方

`/admin`を開いて`ADMIN_PASSWORD`でログインします。使用するLP URLを入れ、以下の形式のCSVを選択します。

```text
電話番号,送信内容,URL
09012345678,以前ご登録いただいた件です。{{url}},
08012345678,良い求人があれば話を聞きたい方向けの確認です。,
```

`{{url}}`がある場合は、その場所に生成URLを差し込みます。`{{url}}`がない場合は、送信内容の末尾に改行して生成URLを追加します。URL列が空のCSVでも問題ありません。

`URL生成`を押すと、電話番号ごとに `https://driver-concierge.jp/a/a10429` のようなユニークリンクを生成し、画面上の表に生成URLと最終送信内容を表示します。`送信開始`を押すと、同じ流れでURLを生成してTwilio SMS送信を実行します。

キャンペーンIDの入力は不要です。内部ログ用には、LP URLから自動で識別名を作ります。

## LP

`/b/:識別コード` で、`https://driver-concierge.jp/b/` のLPをベースにしたページを表示します。

CTAは以下です。

```text
アドバイザーに電話で相談する -> tel:07084435034
アドバイザーにLINEで相談する -> https://lin.ee/UTlxf1Q
求人を見る -> https://driver-concierge.jp/b/form/?utm_campaign=<clicked_path_key>
```

このLPにアクセスされた時点で、GASへ`recordPublicClick`を送信します。GAS側は`public_tracking_code`で`LinkIndex`を照合し、LinkIndex内の電話番号を使ってGAS内部だけでDBの電話番号列を検索します。見つかった1行の電話番号・住所・氏名・clicked_path_keyを`【記入用】Clickbot`へ記録します。DB照会結果はRenderやブラウザへ返しません。

## リンク生成の使い方

画面に次を表示します。

```text
入力電話番号
candidate_key
電話番号
生成リンク
メモ/文面
エラー有無
```

GAS保存に成功した場合は`LinkIndex`にも保存します。GAS保存に失敗しても、リンク生成結果は画面に表示します。リンク生成時はDB照会を行わず、CSVの電話番号と生成URLだけを保存します。

## クリックテスト方法

1. テスト用の電話番号を1件だけ貼り付けます。
2. `リンク生成`を押します。
3. 画面に出た生成リンクを開きます。
4. `PublicClickEvents`にクリックログが出力されたことを確認します。
5. `【記入用】Clickbot`の4行目以降にA-Dが出力されたことを確認します。

## 本番送信前の注意点

対象スプレッドシート以外のDBを参照したい場合は、`@OnlyCurrentDoc`の範囲を超えるため、この方式では扱いません。個人情報保護を優先するため、DBタブを対象スプレッドシート内に置いた状態で運用します。

## 既存DBを壊さないための注意点

参照DBシートには、candidate_key、link_id、tracking_url、送信日時、クリック日時、ログ列、メモ列などを追加しません。クリック時はGAS内部で電話番号を照合しますが、DB側には一切書き込みません。

コード上でもDBタブに対しては`TextFinder`、`getRange()`、`getDisplayValues()`、`getLastRow()`だけを使います。append、set、clear、delete、insert、sort、filter、protectなどの処理はDBタブに対して書いていません。
