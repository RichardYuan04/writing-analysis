import json as _json

import main


def _seed_profile(content="克制短句。", taboo="", golden=None, name=None, active=True):
    """建单个风格槽 + 全局 SoulSettings（共用 taboo + 默认指针）。返回该槽 id。"""
    s = main.Session()
    s.query(main.StyleProfile).delete()
    s.query(main.SoulSettings).delete()
    row = main.StyleProfile(name=name, content=content, rationale="{}",
                            source_essay_ids="[]", golden_samples=golden)
    s.add(row)
    s.flush()
    pid = row.id
    s.add(main.SoulSettings(id=1, active_profile_id=(pid if active else None), taboo=(taboo or "")))
    s.commit()
    s.close()
    return pid


class _E:
    """最小 Essay 替身，_golden_samples 只读 .content。"""
    def __init__(self, content):
        self.content = content


def test_golden_samples_skips_short_opening_line():
    # 第一行是地名短行「瘦西湖」，应跳过，取下一段够长的句子
    essays = [_E("瘦西湖\n那天傍晚我沿着长堤走，水面把晚霞揉成了碎金，风一过就散了。")]
    out = main._golden_samples(essays, n=3)
    assert out and not out[0].startswith("瘦西湖")
    assert "晚霞" in out[0]


def test_golden_samples_essay_with_only_short_lines_contributes_nothing():
    essays = [_E("瘦西湖\n清晨\n雨")]   # 全是标题式短行，没有可作语感参照的句子
    assert main._golden_samples(essays, n=3) == []


def test_get_taboo_falls_back_to_default(client, db):
    _seed_profile(taboo="")
    g = client.get("/style-profiles").json()
    assert g["taboo"] == main.DEFAULT_TABOO
    assert "值得注意的是" in g["taboo"]


def test_put_soul_settings_taboo_persists_and_keeps_slot(client, db):
    _seed_profile(content="原正文")
    r = client.put("/soul-settings", json={"taboo": "禁止用 ZZZ 套话"})
    assert r.status_code == 200 and r.json()["taboo"] == "禁止用 ZZZ 套话"
    g = client.get("/style-profiles").json()
    assert g["taboo"] == "禁止用 ZZZ 套话"
    assert g["profiles"][0]["content"] == "原正文"        # 共用禁止项不动槽内容


def test_put_slot_content_keeps_shared_taboo(client, db):
    pid = _seed_profile()
    client.put("/soul-settings", json={"taboo": "我的禁令"})
    client.put(f"/style-profiles/{pid}", json={"content": "新正文"})
    g = client.get("/style-profiles").json()
    assert g["profiles"][0]["content"] == "新正文"
    assert g["taboo"] == "我的禁令"


def test_get_returns_golden_samples(client, db):
    _seed_profile(golden=_json.dumps(["片段一", "片段二"], ensure_ascii=False))
    g = client.get("/style-profiles").json()
    assert g["profiles"][0]["golden_samples"] == ["片段一", "片段二"]


def test_put_golden_samples_cleans_blanks_and_caps_200(client, db):
    pid = _seed_profile()
    long = "字" * 250
    r = client.put(f"/style-profiles/{pid}", json={
        "golden_samples": ["  第一条样例片段  ", "", "   ", long],
    })
    assert r.status_code == 200
    g = r.json()["golden_samples"]
    assert len(g) == 2                       # 空白项被剔除
    assert g[0] == "第一条样例片段"          # 两端空白去掉
    assert len(g[1]) == 200                  # 超长截到 200 字


def test_put_golden_samples_keeps_content_and_taboo(client, db):
    pid = _seed_profile(content="原正文", taboo="我的禁令")
    client.put(f"/style-profiles/{pid}", json={"golden_samples": ["用户自选的片段"]})
    g = client.get("/style-profiles").json()
    assert g["profiles"][0]["golden_samples"] == ["用户自选的片段"]
    assert g["profiles"][0]["content"] == "原正文"
    assert g["taboo"] == "我的禁令"


def test_get_golden_samples_bad_json_falls_back(client, db):
    _seed_profile(golden="{broken")
    assert client.get("/style-profiles").json()["profiles"][0]["golden_samples"] == []


def test_load_soul_bundle_defaults(client, db):
    _seed_profile(taboo="", golden=None)
    b = main._load_soul_bundle()
    assert b["taboo"] == main.DEFAULT_TABOO
    assert b["samples"] == []


def test_generate_stores_golden_samples_not_taboo(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n克制、短句、少抒情。\n【节奏】短\n【意象】具体\n【情绪】克制\n【用词】口语\n【手法】留白")
    r = client.post("/style-profiles/generate", json={"essay_ids": seed_essays})
    assert r.status_code == 200
    assert len(r.json()["golden_samples"]) >= 1            # 抽到了样例
    g = client.get("/style-profiles").json()
    assert len(g["profiles"][0]["golden_samples"]) >= 1
    assert g["taboo"] == main.DEFAULT_TABOO                 # 养成不写共用禁止项


def test_assist_reduce_injects_taboo_and_samples(client, db, mock_anthropic):
    _seed_profile(content="克制短句", taboo="禁止用 ZZZ",
                  golden=_json.dumps(["样例片段ABC"], ensure_ascii=False))
    mock_anthropic.set_text("缩短后的文字")
    client.post("/assist/reduce", json={"text": "一段要缩减的较长文字。", "context": ""})
    sysp = mock_anthropic.captured["system"]
    assert "克制短句" in sysp        # 默认槽 SOUL 正文
    assert "ZZZ" in sysp             # 共用禁止项
    assert "样例片段ABC" in sysp     # 黄金样例


def test_assist_reduce_no_profile_still_has_default_taboo(client, db, mock_anthropic):
    s = main.Session()
    s.query(main.StyleProfile).delete()
    s.query(main.SoulSettings).delete()
    s.commit()
    s.close()
    mock_anthropic.set_text("x")
    client.post("/assist/reduce", json={"text": "一段要缩减的较长文字。", "context": ""})
    assert "值得注意的是" in mock_anthropic.captured["system"]   # 降级也带 DEFAULT_TABOO
