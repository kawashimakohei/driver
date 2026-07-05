# Past Lead SMS Tracking MVP

過去登録リード向けのユニークリンクを生成し、リンククリックをGoogle Apps Scriptへ到達させるMVPです。

現在の最小版では、管理画面でリンク生成だけを行います。Twilio SMS送信、返信LP、電話予約LP、求人LP分岐はコード上に残していますが、管理画面では使わない状態にしています。

最重要ルール: 既存DBスプレッドシートは読み取り専用です。`DB_SPREADSHEET_ID`側の3つの参照シートには、書き込み・列追加・行追加・書式変更を一切しません。書き込みは`LOG_SPREADSHEET_ID`配下のMVP用タブだけです。

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

1. Apps Scriptプロジェクトを作成します。
2. [gas/tracking.gs](gas/tracking.gs)の内容を貼り付けます。
3. スクリプトプロパティを設定します。
4. `setupLogSheets()`を1回実行してログ用タブとヘッダーを作成します。
5. Webアプリとしてデプロイします。
6. 発行されたWebアプリURLを`GAS_WEBAPP_URL`と`LOG_GAS_POST_URL`に設定します。

## GASスクリプトプロパティ

```text
DB_SPREADSHEET_ID=
LOG_SPREADSHEET_ID=
TRACKING_SECRET=
SLACK_WEBHOOK_URL=
DB_OUTPUT_SHEET_NAME=PastSMS_DB
IMMEDIATE_CALL_SHEET_NAME=ImmediateCallQueue
CLICKBOT_SPREADSHEET_ID=10ZMzFfdFqefcZ-IG3YjDWjBOu8WDrrlzZHmT-6HHa3I
CLICKBOT_SHEET_NAME=【記入用】Clickbot
OUTPUT_CLICK_TO_DB=false
OUTPUT_CLICK_TO_IMMEDIATE_CALL=false
REPLY_LP_URL=https://your-render-app.onrender.com/lp/reply
CALL_LP_URL=https://your-render-app.onrender.com/lp/call
JOBS_URL=
```

`TRACKING_SECRET`はNode側の`.env`と同じ値にしてください。

## DB_SPREADSHEET_IDとLOG_SPREADSHEET_ID

`DB_SPREADSHEET_ID`は既存DBです。参照シートは以下の3つです。

```text
【閲覧用】
【閲覧用】タクシー
【閲覧用】スカウト
```

GAS内では`dbSs = SpreadsheetApp.openById(DB_SPREADSHEET_ID)`を読み取り専用として扱い、`getSheetByName()`、`getRange()`、`getDisplayValues()`、`getLastRow()`、`getLastColumn()`だけを使います。

`LOG_SPREADSHEET_ID`はログ用です。書き込みは次の許可シートだけに限定しています。

```text
LinkIndex
SendLogs
ClickEvents
PublicClickEvents
AnswerEvents
PastSMS_DB
ImmediateCallQueue
DBOutputLogs
ImmediateCallOutputLogs
【記入用】Clickbot
```

## ログ用シートのヘッダー

`setupLogSheets()`を実行すると、存在しないログ用タブを作り、以下のヘッダーを入れます。

### LinkIndex

```text
created_at, candidate_key, candidate_no, db_sheet_key, db_sheet_name, match_status, matched_count, matched_sheets, link_id, campaign_id, channel, destination_type, tracking_url, final_message, name, phone_number, phone_without_leading_zero, email, address, license, age, gender, station, prefecture, applied_at, apply_media, apply_route, status, raw_input_phone, raw_input_message
```

### SendLogs

```text
timestamp, candidate_key, candidate_no, db_sheet_name, match_status, matched_count, matched_sheets, name, phone_number, email, address, license, prefecture, campaign_id, link_id, channel, destination_type, tracking_url, final_message, twilio_sid, twilio_status, error_message, raw_json
```

### ClickEvents

```text
timestamp, event_type, candidate_key, candidate_no, db_sheet_name, name, phone_number, email, address, license, age, gender, station, prefecture, applied_at, apply_media, apply_route, status, campaign_id, link_id, channel, destination_type, signature_valid, raw_query
```

### PublicClickEvents

SMS本文に貼った `https://driver-concierge.jp/b/a36063` のようなリンク本体を踏んだタイミングで出力します。

```text
timestamp, phone_number, name, clicked_path_key, public_tracking_code, clicked_url, lp_path, candidate_key, candidate_no, raw_json
```

`clicked_path_key` は `.jp/` 以降の `/` を `-` に置き換えた値です。

```text
https://driver-concierge.jp/scout/jrbus/a36063 -> scout-jrbus-a36063
```

同時に`CLICKBOT_SPREADSHEET_ID`の`CLICKBOT_SHEET_NAME`へ、4行目以降に次の形式で追記します。

```text
A列: 電話番号
B列: 住所
C列: お名前
D列: clicked_path_key
```

### AnswerEvents

```text
timestamp, event_type, answer, candidate_key, candidate_no, db_sheet_name, name, phone_number, email, address, license, age, gender, station, prefecture, applied_at, apply_media, apply_route, status, campaign_id, link_id, channel, signature_valid, raw_query
```

### PastSMS_DB

22列形式で出力します。D列は先頭0なし電話番号、V列は先頭0あり電話番号です。

### ImmediateCallQueue

```text
電話番号, 住所, 氏名, 流入元・キャンペーン名
```

## Renderデプロイ方法

1. このフォルダをGitHubに置きます。
2. RenderでNew Web Serviceを作成します。
3. RuntimeはNode、Build Commandは`npm install`、Start Commandは`npm start`にします。
4. `.env.example`と同じ環境変数をRenderに設定します。
5. デプロイ後のURLをGASスクリプトプロパティの`REPLY_LP_URL`、`CALL_LP_URL`に設定します。

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

このLPにアクセスされた時点で、GASへ`recordPublicClick`を送信します。GAS側は`public_tracking_code`で`LinkIndex`を照合し、電話番号・氏名・clicked_path_keyを`PublicClickEvents`へ記録します。

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

GAS保存に成功した場合は`LinkIndex`にも保存します。GAS保存に失敗しても、リンク生成結果は画面に表示します。

## クリックテスト方法

1. テスト用の電話番号を1件だけ貼り付けます。
2. `リンク生成`を押します。
3. 画面に出た生成リンクを開きます。
4. GAS側で「クリックを記録しました」と表示されることを確認します。
5. `ClickEvents`に出力されたことを確認します。

## 本番送信前の注意点

`DB_SPREADSHEET_ID`と`LOG_SPREADSHEET_ID`を分けることを推奨します。同じスプレッドシートを使う場合でも、既存DBシートには絶対に書き込まず、MVP用の新規タブだけに出力してください。

高温度回答は以下です。

```text
now
good
call_today
call_tomorrow_am
call_tomorrow_pm
line
```

同一`link_id + event_type`は`PastSMS_DB`へ重複出力しません。同一`phone_number + campaign_id + event_type`は`ImmediateCallQueue`へ重複出力しません。

## 既存DBを壊さないための注意点

参照DBシートには、candidate_key、link_id、tracking_url、送信日時、クリック日時、ログ列、メモ列などを追加しません。クリック時・回答時はDB本体を検索せず、SMS送信時に保存した`LinkIndex`だけを参照します。

コード上でも`DB_SPREADSHEET_ID`で開いた`dbSs`には読み取り処理だけを行います。append、set、clear、delete、insert、sort、filter、protectなどの処理は書いていません。
