"""Deterministic Chinese-aware lexical tokens and source-preserving chunks."""
import re
import unicodedata


def tokenize(text):
    text = unicodedata.normalize('NFKC', text).casefold()
    words = re.findall(r'[a-z0-9_]+|[\u3400-\u9fff]+', text)
    result = []
    for word in words:
        if re.fullmatch(r'[\u3400-\u9fff]+', word):
            result.extend(word)
            result.extend(word[i:i + 2] for i in range(len(word) - 1))
            if len(word) <= 32:
                result.append(word)
        else:
            result.append(word)
    return list(dict.fromkeys(result))


def chunk_text(text, max_chars=1000, overlap=100):
    if max_chars < 2 or not 0 <= overlap < max_chars:
        raise ValueError('invalid chunk limits')
    chunks, start = [], 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            # Prefer paragraph/sentence boundaries without generating tiny chunks.
            cut = max(text.rfind(sep, start + max_chars // 2, end) for sep in ('\n', '。', '！', '？', '. '))
            if cut >= start + max_chars // 2:
                end = cut + 1
        if text[start:end].strip():
            chunks.append({'text': text[start:end], 'start': start, 'end': end})
        if end == len(text):
            break
        start = max(start + 1, end - overlap)
    return chunks
