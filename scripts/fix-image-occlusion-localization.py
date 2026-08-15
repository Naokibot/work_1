from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'target not found: {path}: {old}')
    file.write_text(text.replace(old, new, 1))


replace(
    'src/app/app.ts',
    "      const open = button('画像穴埋めエディタを開く', 'anki-button');\n      open.addEventListener('click', () => { this.cardDialog.close(); void this.navigate('anki'); });",
    "      const open = button('画像穴埋めエディタを開く', 'anki-button');\n      open.dataset.action = 'image-occlusion-editor';\n      open.addEventListener('click', () => { this.cardDialog.close(); void this.navigate('anki'); });"
)

replace(
    'src/anki/image-occlusion-editor.ts',
    "    this.dialog.setAttribute('aria-label', 'Image Occlusion');",
    "    this.dialog.setAttribute('aria-label', '画像穴埋め');"
)
replace(
    'src/anki/image-occlusion-editor.ts',
    "    const title = document.createElement('div'); title.className = 'io-editor-title'; title.append(document.createTextNode('Image Occlusion'));",
    "    const title = document.createElement('div'); title.className = 'io-editor-title'; title.append(document.createTextNode('画像穴埋め'));"
)
replace(
    'src/anki/image-occlusion-editor.ts',
    "    const modeLabel = document.createElement('label'); modeLabel.textContent = 'モード '; this.mode.append(new Option('Hide All, Guess One','hide-all-guess-one'), new Option('Hide One, Guess One','hide-one-guess-one')); modeLabel.append(this.mode); toolbar.append(modeLabel);",
    "    const modeLabel = document.createElement('label'); modeLabel.textContent = 'モード '; this.mode.append(new Option('すべて隠して1つ答える','hide-all-guess-one'), new Option('1つだけ隠して答える','hide-one-guess-one')); modeLabel.append(this.mode); toolbar.append(modeLabel);"
)
replace(
    'src/anki/image-occlusion-editor.ts',
    "    sidebar.append(this.field('Header', this.header), this.field('Back Extra', this.backExtra), this.field('Comments', this.comments));",
    "    sidebar.append(this.field('見出し', this.header), this.field('裏面の補足', this.backExtra), this.field('コメント', this.comments));"
)
replace(
    'src/anki/image-occlusion-editor.ts',
    "  document.addEventListener('click',(event)=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('#note-fields button');if(!button||!button.textContent?.includes('Image Occlusion'))return;const select=document.getElementById('note-type') as HTMLSelectElement|null;if(!select)return;event.preventDefault();event.stopImmediatePropagation();void getAnkiState().then((state)=>{const type=state.noteTypes.find((item)=>item.id===select.value);if(type?.kind!=='image-occlusion')return;editor?.open();});},true);",
    "  document.addEventListener('click',(event)=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('#note-fields button[data-action=\"image-occlusion-editor\"]');if(!button)return;const select=document.getElementById('note-type') as HTMLSelectElement|null;if(!select)return;event.preventDefault();event.stopImmediatePropagation();void getAnkiState().then((state)=>{const type=state.noteTypes.find((item)=>item.id===select.value);if(type?.kind!=='image-occlusion')return;editor?.open();});},true);"
)

replace(
    'src/anki/center.ts',
    "    const node = section('フィルターデッキ / Custom Study');",
    "    const node = section('フィルターデッキ / カスタム学習');"
)
replace(
    'tests/browser.e2e.mjs',
    "['ブラウザ / 高度な検索', 'フィルターデッキ / Custom Study', 'ノートタイプ / フィールド / カードテンプレート', 'FSRS-6 / デッキオプション']",
    "['ブラウザ / 高度な検索', 'フィルターデッキ / カスタム学習', 'ノートタイプ / フィールド / カードテンプレート', 'FSRS-6 / デッキオプション']"
)
