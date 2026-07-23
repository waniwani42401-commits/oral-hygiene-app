口腔衛生学 暗記アプリ v8 強制更新版

【差し替えるファイル】
- index.html
- sw.js

【追加するファイル】
- update.html

1. GitHubのリポジトリ直下へ3ファイルをアップロードして同名ファイルを置き換える
2. 公開URLの末尾を /update.html にしてSafariで開く
3. 自動的に古いCache StorageとService Workerだけを削除してv8へ移動する
4. 学習記録・編集問題はlocalStorage/IndexedDBに残すため削除しない
5. 画面右上が「v8・時刻 保存」、起動時に「v8.0・IndexedDB大容量保存で起動しました」と出れば更新成功

重要：更新前に、可能なら現在のバックアップJSONを書き出してください。
