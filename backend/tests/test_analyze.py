import main


def test_pos_distribution_includes_other_and_excludes_punct():
    # 句中有代词/介词/副词/助词（→其他）、形容词、动词；标点不计
    r = main.analyze_text("我在很安静的夜里慢慢地走着，心里踏实。")
    pos = r["pos_distribution"]
    assert pos.get("其他", 0) >= 1          # 副/连/代/助词等并入「其他」
    assert sum(pos.values()) >= 3           # 实词 + 其他都计入
    # 标点不应作为词性计入任一桶（合计应小于含标点的粗 token 数）
    assert "，" not in pos and "。" not in pos


def test_pos_distribution_only_known_buckets():
    r = main.analyze_text("夜色很温柔，我慢慢走着，想着远方的人和事。")
    assert set(r["pos_distribution"].keys()) <= {"名词", "动词", "形容词", "副词", "代词", "其他"}


def test_pos_distribution_splits_adverb_and_pronoun():
    # 「我」代词、「很/慢慢」副词，应各自单列，不再落进「其他」
    r = main.analyze_text("我很认真地慢慢写着。")
    pos = r["pos_distribution"]
    assert pos.get("代词", 0) >= 1
    assert pos.get("副词", 0) >= 1
