from pathlib import Path

path = Path('tests/full-function.e2e.mjs')
text = path.read_text()
replacements = [
    ("async function addDialogNote(page, { type='Basic', deck='ReviewDeck'", "async function addDialogNote(page, { type='基本', deck='ReviewDeck'"),
    ("type:'Basic (and reversed card)'", "type:'基本（表裏2枚）'"),
    ("type:'Cloze'", "type:'穴埋め'"),
    ("panel(page,'フィルターデッキ / Custom Study')", "panel(page,'フィルターデッキ / カスタム学習')"),
    ("statsText.includes('コレクション統計') && statsText.includes('カード状態 / 保持率') && statsText.includes('予測 / 間隔')", "statsText.includes('期間サマリー') && statsText.includes('現在のカード状態 / 選択期間の保持率') && statsText.includes('予測 / 間隔')")
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'missing target: {old}')
    text = text.replace(old, new)
path.write_text(text)
