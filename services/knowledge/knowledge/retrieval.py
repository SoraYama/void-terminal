"""Reciprocal-rank fusion with stable tie breaking."""
def reciprocal_rank_fusion(rankings, k=60, weights=None):
    scores = {}
    weights = weights or [1] * len(rankings)
    for ranking, weight in zip(rankings, weights):
        for rank, key in enumerate(ranking, 1):
            scores[key] = scores.get(key, 0.0) + weight / (k + rank)
    return sorted(scores, key=lambda key: (-scores[key], key)), scores


# Query grammar should not swamp content terms. Indexing retains every token;
# these filters apply only to retrieval queries and require no corpus rebuild.
ENGLISH_QUERY_STOPWORDS = frozenset('a an the and or as at by for from in into of on onto to with without about between than then this that these those it its they them their theirs he him his she her hers we us our ours you your yours i me my mine is are was were be been being do does did have has has had having can could may might must shall should will would who what when where why how which whose tell explain describe please'.split())
ENGLISH_QUERY_STOPWORDS = ENGLISH_QUERY_STOPWORDS | {'s', 't', 'd', 'm', 'll', 're', 've'}
CHINESE_QUERY_STOPWORDS = frozenset('请问 什么 怎么 为何 为什么 如何 是否 一下 介绍 告诉 哪个 哪些 谁是 是谁 有没有 能否 可以 关于 有关 之间 分别 以及 其中 那么 这个 那个 这些 那些 他们 她们 它们 我们 你们 的是 了吗 了么'.split())
COMMON_HAN_CHARACTERS = frozenset('的了是在有和与我你他她它这那一个什么谁吗呢啊也就都而及其或于被不为上中下大小前后由从到来去做把将让所请问东西南北')


def query_terms(query):
    import re
    from .chunking import tokenize
    tokens = tokenize(query)
    has_han_phrase = any(len(token) >= 2 and re.fullmatch(r'[\u3400-\u9fff]+', token) for token in tokens)
    return [token for token in tokens if token not in ENGLISH_QUERY_STOPWORDS
            and token not in CHINESE_QUERY_STOPWORDS
            and not (has_han_phrase and len(token) == 1 and re.fullmatch(r'[\u3400-\u9fff]', token))][:64]


def entity_candidates(query, limit=512):
    """Bounded exact name/alias mentions inside natural-language questions."""
    import re
    import unicodedata
    normalized = unicodedata.normalize('NFKC', query).casefold().strip()
    values = [normalized, exact_entity_name(query)]
    values += re.findall(r'[《「『“\"]([^》」』”\"]{2,100})[》」』”\"]', normalized)
    words = re.findall(r"[a-z0-9]+(?:['’-][a-z0-9]+)*", normalized)
    for start in range(len(words)):
        for size in range(1, min(6, len(words) - start) + 1):
            phrase = words[start:start + size]
            if any(word not in ENGLISH_QUERY_STOPWORDS for word in phrase):
                values.append(' '.join(phrase))
    for run in re.findall(r'[\u3400-\u9fff]+', normalized):
        positions = []
        for index in range((len(run) + 1) // 2):
            positions.append(index)
            if len(run) - index - 1 != index:
                positions.append(len(run) - index - 1)
        for start in positions:
            if run[start] not in COMMON_HAN_CHARACTERS:
                values.append(run[start])
            for size in range(2, min(12, len(run) - start) + 1):
                phrase = run[start:start + size]
                if phrase not in CHINESE_QUERY_STOPWORDS:
                    values.append(phrase)
    return list(dict.fromkeys(values))[:limit]


def exact_entity_name(query):
    import unicodedata
    value = unicodedata.normalize('NFKC', query).casefold().strip()
    pairs = {'《': '》', '「': '」', '『': '』', '“': '”', '‘': '’', '"': '"', "'": "'"}
    if len(value) > 2 and pairs.get(value[0]) == value[-1]:
        value = value[1:-1].strip()
    return value
