# Architecture

Local File Locker の暗号化・保存方式に関する設計記録。将来の実装判断・
仕様変更の際の参照用。コード内のコメント（`lib/crypto.ts`・`lib/vault.ts`
冒頭など）が一次情報源であり、本書はそれらを俯瞰・背景説明するもの。

> ⚠️ フォーマットは複数箇所で同期を取る必要がある。v2 ブロック形式を変更
> する場合は `lib/crypto.ts`・`lib/vault.ts`・`tools/recover-password.mjs`
> の3つを必ず揃えること。

---

## 1. 目的とスコープ

ブラウザ内で完結する暗号化ファイルマネージャ。ファイルはユーザーのデバイ
ス上（OPFS = Origin Private File System）にのみ保存され、サーバーには一切
送信されない（静的ホスティング、`output: "export"`）。

このドキュメントが対象とするのは、2026年8月のセキュリティ指摘に端を発する
一連の破壊的変更で確立した「v2 世代」の設計である。旧「v1 世代」は
`/legacy` ページで読み取り専用としてのみ残存する（§10）。

---

## 2. 脅威モデルと保証

**想定する攻撃者**: 同一オリジンで OPFS の中身を読み書きできる主体（ブラ
ウザ devtools、同一オリジン上の別スクリプト、デバイスを一時的に触れる第三
者など）。暗号文・保存構造はすべて攻撃者から見えうる前提で設計する。

**保証すること**:

| 項目 | 保証 | 手段 |
|---|---|---|
| ファイル内容の機密性 | パスワードを知らなければ復号不可 | AES-256-GCM + PBKDF2 |
| ファイル名・フォルダ名の機密性 | 同上（名前も暗号化） | opaque 化 + name ブロック暗号化（§6） |
| オフライン総当たりへの耐性 | 大幅に緩和（≠ 完全防止） | PBKDF2 60万反復（§4） |
| 事前計算テーブルへの耐性 | あり | ファイルごとのランダムソルト |
| すり替え（ブロック再配置）の検知 | あり | AAD にエントリの opaque id を束縛（§7） |

**保証しないこと・残存リスク**:

- **パスワードのエントロピー依存**: PBKDF2 はコストを上げるだけで、弱いパ
  スワードは依然として破られうる。実効強度はパスワードのエントロピーが上限。
- **メタデータの一部露出**: opaque 化してもツリーの**構造**（階層の深さ・
  各ディレクトリの子の数・各ファイルの概算サイズ）は OPFS 上で観測可能。
  隠すのは「名前（識別情報）」であって「存在」ではない。
- **移動（親の付け替え）の検知はしない**: AAD はエントリ自身の opaque id
  のみに束縛し、親ディレクトリの id は含めない（§7 末尾）。これは将来の
  move 機能（§12）を再暗号化なしで実現するための意図的な設計判断。
- **メモリ上の平文**: 復号された内容・パスワードは React state / モジュー
  ル変数としてメモリ上に存在する。永続化はしない（リロードで消える）。

---

## 3. 層構造

責務を3層に分離し、下2層はパスワードと実名を**同時には**扱わない。

```
┌──────────────────────────────────────────────────────────┐
│ UI: app/page.tsx, components/Finder.tsx, NewFile.tsx      │
│     (メインボールト。VaultEntry を扱う)                    │
│ UI: app/legacy/*, components/LegacyFinder.tsx             │
│     (旧形式の読み取り専用。Entry を扱う)                    │
├──────────────────────────────────────────────────────────┤
│ lib/vault.ts  ── opaque 化・AAD・コンテナ・名前解決キャッシュ・  │
│                  ディレクトリ解決・import/export             │
│                  (パスワードと実名を結びつける唯一の層)        │
├────────────────────────────┬─────────────────────────────┤
│ lib/crypto.ts              │ lib/opfsStore.ts             │
│  暗号プリミティブ           │  OPFS の薄いラッパー          │
│  (PBKDF2 + AES-256-GCM)    │  (opaque セグメント配列のみ)   │
│  パスワードを知るが名前は   │  パスワードも名前も知らない    │
│  知らない                  │                              │
└────────────────────────────┴─────────────────────────────┘

lib/opfs.ts (旧・無変更) ── /legacy 専用。実名をそのまま OPFS 名に使う。
```

**OPFS ルートの分離**:

- 新ボールト: `LocalFileLockerVault`（`lib/opfsStore.ts`）
- 旧データ: `LocalFileLocker`（`lib/opfs.ts`、`/legacy` が参照）

兄弟ディレクトリとして完全分離しており、新旧が同じ一覧に混在することは構造
上ありえない。このためメインページ側に「これは旧形式ファイルだ」という判別・
誘導ロジックは不要。

---

## 4. 暗号プリミティブ（`lib/crypto.ts`）

パスワードとバイト列から、単一の自己完結した暗号ブロックを生成・復号する
最小限の層。opaque id・ロール・コンテナといったボールト固有の概念は持たない。

### v2 ブロック形式

```
blob = magic(4: "LFL2") || salt(16) || iterations(4, u32 BE) || nonce(12)
       || ciphertext_and_tag

key  = PBKDF2-HMAC-SHA256(password_utf8, salt, iterations, dkLen=32)
       → AES-256-GCM の鍵
```

- ヘッダー長 = 36 バイト。GCM タグ 16 バイトを含めた固定オーバーヘッドは
  52 バイト（`V2_BLOB_OVERHEAD`）。
- **反復回数はブロックに保存する**（ハードコードしない）。復号時はブロック
  内の値を読んで使うため、将来 `DEFAULT_ITERATIONS` を引き上げても既存ファ
  イルはそのまま読め、フォーマット破壊を伴わない。
- `DEFAULT_ITERATIONS = 600_000`（OWASP の PBKDF2-HMAC-SHA256 推奨最小値）。

### API

```ts
encrypt(password, plaintext, aad?) → Promise<Uint8Array>  // 常に v2 を生成
decrypt(password, blob,      aad?) → Promise<Uint8Array>  // magic 不一致は throw
decryptLegacy(password, file)      → Promise<Uint8Array>  // v1 専用・読み取りのみ
```

- `aad` は SubtleCrypto の `additionalData` にそのまま渡され、**ブロックに
  は保存されない**。呼び出し側が encrypt/decrypt 双方で同じバイト列を再構築
  する責務を負う（AAD の組み立ては `lib/vault.ts` が担当、§7）。
- 鍵導出は PBKDF2 → `deriveKey` の `AES-GCM` 鍵。抽出不可（`extractable=false`）。

---

## 5. ボールトのオンディスク構造（`lib/vault.ts`）

### ファイル = 単一の OPFS ファイル（コンテナ形式）

ディレクトリ+2ファイルにはせず、1エントリ=1 OPFS ファイルにする。理由:
`File.slice()` でヘッダーと name ブロックだけを部分読みでき、一覧表示時に
巨大な content を触らずに済む／OPFS ハンドル数を最小化できる／エクスポート
がバイト列のコピーだけで完結する。

```
offset  size  field
0       4     magic "LFLF"            (crypto.ts の "LFL2" とは別レイヤー)
4       1     version (u8 = 1)
5       36    opaqueId (UUID 文字列)   ※書き戻し時のヒントのみ。検証には使わない
41      1     contentFormat           0x01 = v2-framed, 0x02 = raw-passthrough
42      4     nameBlobLen (u32 BE)
46      *     nameBlob                v2 ブロック。平文 = 実ファイル名(UTF-8)
                                      AAD = buildAad(このファイルの opaque id, "name")
46+len  *     contentBlob             v2 ブロック。平文 = 実ファイル内容
              または raw bytes        AAD = buildAad(..., "content")
                                      raw-passthrough の場合は素のバイト列
```

- ヘッダー長 `HEADER_LENGTH = 46`。
- **name と content は独立した PBKDF2 導出**（別ソルト）。これにより一覧表示
  は name ブロックだけ復号すればよく、content の PBKDF2 コストはファイルを
  実際に開く時まで遅延できる。
- 一覧表示上のサイズは復号せず算出: v2-framed なら
  `contentLength - V2_BLOB_OVERHEAD`、raw-passthrough なら `contentLength`。

### ディレクトリ = opaque 名の OPFS ディレクトリ

```
<opaqueDirId>/
  name                 ← v2 ブロック。平文 = 実ディレクトリ名
                          AAD = buildAad(opaqueDirId, "name")
  <opaque な子...>      ← ファイル(上記コンテナ) or さらなる opaque ディレクトリ
```

- 子ディレクトリの実名を保持する `name` ファイルは `DIR_NAME_FILE = "name"`
  というリテラル名の**センチネル**。opaque id は必ず `crypto.randomUUID()`
  なのでこのリテラルと衝突しない。`listEntries` はこのセンチネルを子エント
  リとして列挙しないよう除外する（この除外漏れが過去のバグ、コミット
  `e6b374e`）。

### contentFormat の2値

- **v2-framed**: 通常の暗号化ファイル。content もパスワードで復号可能。
- **raw-passthrough**: `.enc` インポート（§8）で作られる。content は素通しで
  保存され、ボールト内では復号できない（`openFileContent` は throw）。名前
  だけは暗号化されている。

---

## 6. opaque 化とファイル単位パスワード

### opaque 化

すべての OPFS 上の名前（ファイル・ディレクトリとも）を `crypto.randomUUID()`
に置き換え、実名は暗号化して name ブロック/センチネルに格納する。ディスクを
直接覗いても UUID の羅列しか見えない。

### ファイル単位パスワード

各エントリの鍵は独立に導出されるため、**エントリごとに異なるパスワードで暗号
化してよい**。「ロッカー全体で1つの鍵」という前提を置かない。

- `listEntries` は各エントリの name ブロックを**現在入力中のパスワード**で復
  号試行する。成功すれば `name` に実名が入り、失敗すれば `name = null`（=
  ロック状態）。ロックはエラーではなく通常の表示状態。
- ロック状態の表現は `name === null` のみ（`locked: boolean` を別に持たない
  ＝同期漏れバグを避ける）。
- **ディレクトリはロック中でも展開可**: 自分の名前が復号できなくても、中の
  子が別パスワードで解ける可能性があるため。
- **削除はロック中でも可**: `opaquePath` だけで完結する操作で実名不要。パス
  ワードを忘れたゴミの掃除口としても機能する。

### 名前解決キャッシュ

PBKDF2 は意図的に遅い（60万反復）ため、一覧・再描画のたびに再導出しないよう
モジュールレベルの `Map<opaqueId, Map<password, NameResolution>>` でキャッシ
ュする。

- キーは `(opaqueId, password)`。opaque id はボールト全体で一意なので、どの
  階層から辿っても安全に共有できる。
- **成功・失敗の両方を永続キャッシュ**する。あるエントリの暗号文は上書きされ
  ない（更新は常に新しい opaque id での新規書き込み）ため、「このパスワード
  では解けない」という失敗結果も恒久的に正しい。
- 無効化は `deleteEntry` 時の当該 id 削除のみ。React state ではなくモジュー
  ル変数なのは、再レンダーをまたいで生存させるため、かつリロードで消えるのが
  セキュリティ上望ましいため。

### パスワード変更時の再解決（`app/page.tsx`）

- `password`（即時値）: 開く・アップロード・ディレクトリ解決など明示的操作に
  使う。
- `debouncedPassword`（500ms デバウンス）: これが変わった時だけ、展開中のツ
  リーに対して `refreshEntries` を呼び名前解決をやり直す。1キー入力ごとに全
  ツリーへ PBKDF2 を回すのを防ぐ。キャッシュがあるので一度試したパスワードへ
  の再変更はほぼ無料。

---

## 7. AAD 設計

GCM の AAD（追加認証データ）に、そのエントリの**opaque id** と**ロール**を
束縛する。

```
AAD = magic(4: "LFAD") || version(1) || roleTag(1: 0x01=name, 0x02=content)
      || opaqueId(UTF-8)
```

**最重要原則**: AAD は必ず「今その暗号文が置かれている OPFS 上の識別子（呼び
出し側が渡す ambient な id）」から都度組み立てる。**コンテナ内に埋め込まれた
`opaqueId` フィールドを検証用 AAD の復元に使ってはならない**。

- 埋め込みフィールドを信頼すると、攻撃者が正当なブロックを丸ごと別の場所にコ
  ピーした際、そのブロックが「自分自身に対して」正しく認証されてしまい、すり
  替え検知という AAD の目的が無効化される。
- コンテナ内の `opaqueId` フィールドは**書き戻し時のヒント専用**（§8 の
  `.lfl` 再インポートで、埋め込み id をそのまま新しい OPFS 名に再利用するこ
  とで AAD 整合性を構造的に保つ）。検証には一切使わない。

**ロールの束縛**: name ブロックと content ブロックで roleTag を変えることで、
content ブロックを name スロットに（あるいは逆に）移し替える攻撃も認証失敗と
して検知できる。

**親 id を含めない判断**: 親ディレクトリの opaque id は AAD に含めない。これ
により move 機能（§12）を再暗号化なしで後付けできる。対価として「サブツリー
を別の親へ丸ごと移す」タンパリングは検知しない（アプリに move 機能が無い現状
では実害がなく、費用対効果で見送り）。

---

## 8. インポート / エクスポート

### エクスポート（`exportEntry`）

オンディスクのコンテナがそのまま自己完結したバイト列なので、エクスポートは
verbatim コピー。contentFormat で拡張子を分ける:

- **v2-framed** → `<実名>.lfl`（コンテナ全体。暗号化されたまま）
- **raw-passthrough** → `<実名>.enc`（ヘッダー/name を剥がし content 部分の
  み。元の外部フォーマットとの互換を保つ）

### アップロード時の3分岐（`NewFile.tsx`）

ローカルファイルの拡張子で処理を分ける:

| 拡張子 | 処理 | パスワード | 関数 |
|---|---|---|---|
| `.lfl` | 以前のエクスポートを verbatim 復元 | 不要※ | `importExportedFile` |
| `.enc` | content 素通し保存・名前のみ暗号化 | **必要** | `writeRawImportedFile` |
| その他 | 通常の暗号化 | 必要 | `writeNewFile` |

※ `.lfl` はバイト列のコピーだけで、埋め込み opaque id をそのまま OPFS 名に
再利用する（AAD 整合性を保つため）。復号はしないのでパスワード不要。

### `.lfl` 再インポートの衝突

同じ opaque id のエントリが既に存在する場合は**中断してエラー**にする（新し
い id を振り直すと、AAD が合わず永久に復号できないゴーストエントリになり、UI
上「パスワードが違うだけ」と区別できず、より悪い失敗になるため）。UUID の
122bit ランダム性から実際の衝突はまず起きない。

---

## 9. 一括ダウンロード

現在開いている（一覧に出ている）フォルダ単位で zip 化する。個別チェックボック
ス選択は未実装（§12）。zip 生成には `client-zip`（store 方式=無圧縮、ストリー
ミング対応、MIT）を使う。暗号化済みバイト列は高エントロピーで圧縮が効かないた
め store で十分。

- **メインボールト（`Finder.tsx` + `collectFolderForDownload`）**: オンディス
  クのまま（暗号化状態）を zip に詰める。復号しないのでパスワード不要、ロック
  中のエントリも opaque id 名で含まれる。バックアップ・他端末への移送用途。
- **/legacy（`LegacyFinder.tsx` + `collectLegacyForDownload`）**: 現在のパス
  ワードで復号できたものだけを**実名の平文**で zip 化。復号失敗分はスキップし
  件数を報告。「まとめて復号 DL → メインへ再アップロード」という手動移行フロ
  ーを支える。

同一ディレクトリ内で表示名が衝突するファイル（別々の暗号文が同じ名前に復号さ
れる等）は、展開時に上書きし合わないよう `dedupeFilename` で `(1)` `(2)`… を
拡張子前に挿入する（コミット `bdce786`）。

---

## 10. Legacy（v1）— 読み取り専用

v2 移行前に作成されたファイルは互換性を意図的に切ったため、メインページから
は一切見えない。`/legacy` で読み取り専用に閲覧できる。

### v1 形式

```
file = nonce(12) || ciphertext || auth_tag(16)
key  = SHA-256(password_utf8)        ← ソルトなし・ストレッチングなし・AAD なし
```

これが元のセキュリティ指摘の対象（同一パスワード→同一鍵、GCM タグをオラクル
にした高速オフライン総当たりが成立）。`decryptLegacy` でのみ読める。v1 を新規
に書き出す経路は存在しない。

### 構成

- `components/LegacyFinder.tsx`: 旧 Finder のコピーに `decryptLegacy` を差した
  もの。`lib/opfs.ts`（実名 = OPFS 名、opaque 化なし、ロック概念なし）をその
  まま使う。
- `app/legacy/{page,layout}.tsx`: `app/bench/` と同じ構成（クライアントページ
  + メタデータ用サーバーレイアウト、`robots: noindex`）。書き込み系コンポーネ
  ントは持たない。

---

## 11. 補助ツール・その他

### `tools/recover-password.mjs`

パスワードのタイプミス復旧用のオフライン CLI（Node.js、手動実行、CI 非連携）。
入力ファイルのフォーマットを自動判別する:

- **v1（`.enc`、ヘッダーなし）**: `sha256(password)` 鍵で復号試行。候補1件あ
  たり SHA-256 一発なので高速。
- **v2 コンテナ（`.lfl`）**: ヘッダーをパースし、`pbkdf2Sync` +
  `lib/vault.ts` と同じ AAD 構築で name→content の順に復号試行。候補1件あたり
  60万反復 PBKDF2 で高コストなため、走査前に1回分を実測して所要時間を見積もり
  表示し、小さい `--max`/`--depth` を推奨する。

### `wasm-crypto`

`/bench` ページ（AES-GCM スループット比較のデモ）専用。実アプリの暗号経路は
コミット `6db6a05` で SubtleCrypto に一本化済みで、この crate の
`encrypt`/`decrypt`/`hash_password` は死コードだったため削除済み。現在は
`BenchCipher`（生鍵での AES-GCM、パスワード非依存）のみ生存。CI の
`wasm-pack build --target web` で `pkg/` を生成する。

---

## 12. 既知の制約・将来対応

技術的障害はなく、現設計と矛盾しないことを確認済みの未実装項目:

- **フォルダ一括アップロード**: `<input webkitdirectory>` /
  `DataTransferItem.webkitGetAsEntry()` で相対パスを得て
  `resolveOrCreateDirPath` + `writeNewFile` に流すだけ。新規ライブラリ不要。
- **zip アップロードからの展開**: unzip が要る（`fflate` 等の追加）。
- **move（移動）機能**: AAD がエントリ自身の opaque id のみに束縛されている
  ため（§7）、移動先の親を変えても**再暗号化は不要**。OPFS に安定した親跨ぎ
  move API が無いため「読み出し→新しい場所へ書き込み→元を削除」のコピー&削
  除で実装する。opaque id は変わらないのでキャッシュもそのまま有効。
- **個別選択 UI（チェックボックス）**: 現在の一括ダウンロードは「フォルダ単位」
  のため未着手。「選んだファイルだけ移動/DL」等が必要になった時に検討。

### やらないと決めたこと

- 旧 `LocalFileLocker`（平文名）→ 新 `LocalFileLockerVault`（opaque 名）への
  **自動移行ツール**は作らない。ユーザーは新規に使い始め、旧ファイルは
  `/legacy` で参照/手動移行する（§9 の DL + 再アップロード）。
- 一度きりの意図的な破壊的変更であり、継続的なフォーマット交渉やフィーチャー
  フラグの仕組みは作らない。

---

## 13. 主要ファイル早見表

| ファイル | 役割 |
|---|---|
| `lib/crypto.ts` | v2 暗号プリミティブ（PBKDF2 + AES-256-GCM）、`decryptLegacy` |
| `lib/opfsStore.ts` | 新ボールト用 OPFS 薄ラッパー（opaque セグメント） |
| `lib/vault.ts` | opaque 化・AAD・コンテナ・名前解決キャッシュ・dir 解決・import/export・一括DL |
| `lib/opfs.ts` | 旧 OPFS 実装（無変更）。`/legacy` 専用 |
| `components/Finder.tsx` | メインボールトの一覧/プレビュー/DL |
| `components/buttons/NewFile.tsx` | アップロード（3分岐）+ dir 解決 |
| `components/LegacyFinder.tsx` | `/legacy` の読み取り専用一覧 + 復号一括DL |
| `app/page.tsx` | メインページ。password/debouncedPassword の2系統 |
| `app/legacy/{page,layout}.tsx` | 読み取り専用の旧ファイル閲覧ルート |
| `tools/recover-password.mjs` | v1/`.lfl` 両対応のタイプミス復旧 CLI |
| `wasm-crypto/` | `/bench` 専用の AES-GCM ベンチ（`BenchCipher`） |
