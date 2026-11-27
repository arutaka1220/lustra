# Lustra

**撮影後の写真にフレームと撮影情報を添えて、共有できる一枚に。**

Lustraは、現像済みの写真を読み込み、フレームや余白、EXIF由来のテキストを整えて一括書き出しするデスクトップアプリです。元写真は変更せず、編集内容はセッションとして保存します。

[English README](README.en.md) · [ダウンロード（GitHub Releases）](https://github.com/arutaka1220/lustra/releases) · [開発に参加する](CONTRIBUTING.md)

![Lustraの編集画面。クラゲの写真にAmbient Gradientを適用し、カメラ情報を添えています。](docs/assets/screenshots/ja/hero.png)

## 写真を読み込み、編集し、まとめて書き出す

1. **読み込み** — JPEG・PNG・WebPの写真を選び、順序を整えます。
2. **編集** — 写真ごとにフレーム、余白、Crop & Rotate、撮影情報のテキストを調整します。
3. **レビュー** — 仕上がりを一覧で確認し、必要な写真に戻って編集します。
4. **書き出し** — 形式や解像度、メタデータの扱いを選び、まとめて保存します。

編集画面では4枚をフィルムストリップで切り替えられます。共通設定と写真ごとの設定を使い分け、Undo / Redoで編集を戻せます。

| 読み込み | 編集 | レビュー |
|---|---|---|
| ![4枚の写真を選ぶImport Photos画面](docs/assets/screenshots/ja/import.png) | ![Crop & Rotateの編集画面](docs/assets/screenshots/ja/crop-and-rotate.png) | ![写真を一覧で確認するReview Photos画面](docs/assets/screenshots/ja/review.png) |

## フレームとキャンバス

フレームは写真の外側に背景や余白を作り、元写真を引き伸ばしたり切り取ったりせずに仕上がりを整えます。None、Black、White、Blurred、Soft Black、Soft White、Ambient Gradient、Edge Stretch、Customを選べます。

| White | Soft White | Black |
|---|---|---|
| ![White frameの書き出し例](docs/assets/examples/white.png) | ![Soft White frameの書き出し例](docs/assets/examples/soft-white.png) | ![Black frameの書き出し例](docs/assets/examples/black.png) |
| Soft Black | Custom | Blurred |
| ![Soft Black frameの書き出し例](docs/assets/examples/soft-black.png) | ![Custom frameの書き出し例](docs/assets/examples/custom.png) | ![Blurred frameの書き出し例](docs/assets/examples/blurred.png) |
| Ambient Gradient | Edge Stretch | Portrait Card |
| ![Ambient Gradient frameの書き出し例](docs/assets/examples/ambient-gradient.png) | ![Edge Stretch frameの書き出し例](docs/assets/examples/edge-stretch.png) | ![Portrait Cardレイアウトの書き出し例](docs/assets/examples/portrait-card.png) |

**Portrait Card**はフレームではなく独立したキャンバスレイアウトです。縦長のカードに横写真を配置し、写真の大きさや位置を調整できます。

フレーム選択や個別機能の画面もご覧いただけます。

| フレーム一覧 | Ambient Gradient | Edge Stretch |
|---|---|---|
| ![9種類のフレーム一覧](docs/assets/screenshots/ja/frame-styles.png) | ![Ambient Gradientの編集画面](docs/assets/screenshots/ja/ambient-gradient.png) | ![Edge Stretchの編集画面](docs/assets/screenshots/ja/edge-stretch.png) |

| Portrait Card | Customカラー | 撮影情報 |
|---|---|---|
| ![Portrait Cardの編集画面](docs/assets/screenshots/ja/portrait-card.png) | ![カスタムカラーの編集画面](docs/assets/screenshots/ja/custom-color.png) | ![EXIF撮影情報の編集画面](docs/assets/screenshots/ja/metadata.png) |

## 撮影情報と写真の管理

- JPEG・PNG・WebPからEXIF・XMPの撮影情報を読み取り、キャンバス上のテキストに利用できます。
- カメラ名やレンズ名を補正できます。補正やテキスト編集は書き出しに反映でき、元写真のファイルは変更しません。
- Crop & Rotateは非破壊編集です。切り抜きとキャンバスの比率を別々に扱えます。
- 作業を中断して後から再開できます。編集履歴もセッションに保存されます。
- 書き出し形式はJPEG・PNG・WebP、解像度はOriginalまたは短辺720 / 1080 / 1440 / 2160pxから選べます。
- GPS位置情報と機器のシリアル番号は、書き出し時に明示的に選ばない限り含めません。

| Metadata Corrections | 書き出し設定 |
|---|---|
| ![カメラ名・レンズ名の補正設定](docs/assets/screenshots/ja/metadata-corrections.png) | ![書き出し形式や解像度を選ぶ画面](docs/assets/screenshots/ja/export.png) |

## 対応環境と現在の制限

- **macOS 13以降:** DMGで配布します。JPEG・PNGの書き出しに対応し、WebPはビルド環境にエンコーダーがある場合に利用できます。
- **Windows 11 x64以降:** NSISインストーラーを構成しています。ネイティブ画像書き出しは現在macOSのみ対応です。
- **Linux:** 現在の配布対象ではありません。

アプリはBetaとして開発中です。署名・Notarization、自動更新、Windowsでの画像書き出しなど、未提供または未完了の機能があります。利用可能なビルドは[GitHub Releases](https://github.com/arutaka1220/lustra/releases)で確認してください。

## 開発

Bun、Rustツールチェーン、および対象OSのネイティブビルドツールが必要です。

```sh
bun install
bun tauri dev
```

```sh
bun run build
bun run test
bun run test:e2e
bun run test:rust
```

macOSのWebP書き出しにはHomebrewの`webp`パッケージが必要です。詳しくは[開発への参加](CONTRIBUTING.md)、[要件定義書](Lustra_requirements.md)、[デザイン仕様書](Lustra_design_spec.md)をご覧ください。
