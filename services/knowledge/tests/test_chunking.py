from knowledge.chunking import chunk_text, tokenize


def test_chinese_tokenizer_and_chunk_bounds():
    assert {'纳西', '西妲'} <= set(tokenize('纳西妲守护须弥'))
    assert 'nahida' in tokenize('Nahida 须弥')
    chunks = chunk_text('这是中文句子。' * 1000, max_chars=400, overlap=40)
    assert len(chunks) > 1
    assert all(0 < len(c['text']) <= 400 for c in chunks)
    assert chunks[0]['start'] == 0
    assert chunks[-1]['end'] == 7000
