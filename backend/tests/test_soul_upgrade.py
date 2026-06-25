import main


def _seed_profile(content="克制短句。", taboo=None, golden=None):
    s = main.Session()
    s.query(main.StyleProfile).delete()
    row = main.StyleProfile(id=1, content=content, rationale="{}", source_essay_ids="[]",
                            taboo=taboo, golden_samples=golden)
    s.add(row); s.commit(); s.close()


def test_get_taboo_falls_back_to_default(client, db):
    _seed_profile(taboo=None)
    g = client.get("/style-profile").json()
    assert g["taboo"] == main.DEFAULT_TABOO
    assert "值得注意的是" in g["taboo"]


def test_put_taboo_persists_and_keeps_content(client, db):
    _seed_profile(content="原正文")
    r = client.put("/style-profile", json={"taboo": "禁止用 ZZZ 套话"})
    assert r.status_code == 200
    g = client.get("/style-profile").json()
    assert g["taboo"] == "禁止用 ZZZ 套话"
    assert g["content"] == "原正文"


def test_put_content_only_keeps_taboo(client, db):
    _seed_profile()
    client.put("/style-profile", json={"taboo": "我的禁令"})
    client.put("/style-profile", json={"content": "新正文"})
    g = client.get("/style-profile").json()
    assert g["content"] == "新正文"
    assert g["taboo"] == "我的禁令"


def test_get_returns_golden_samples(client, db):
    import json
    _seed_profile(golden=json.dumps(["片段一", "片段二"], ensure_ascii=False))
    g = client.get("/style-profile").json()
    assert g["golden_samples"] == ["片段一", "片段二"]


def test_get_golden_samples_bad_json_falls_back(client, db):
    _seed_profile(golden="{broken")
    assert client.get("/style-profile").json()["golden_samples"] == []


def test_load_soul_bundle_defaults(client, db):
    _seed_profile(taboo=None, golden=None)
    b = main._load_soul_bundle()
    assert b["taboo"] == main.DEFAULT_TABOO
    assert b["samples"] == []


def test_generate_stores_golden_samples_not_taboo(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n克制、短句、少抒情。\n【节奏】短\n【意象】具体\n【情绪】克制\n【用词】口语\n【手法】留白")
    r = client.post("/style-profile/generate", json={"essay_ids": seed_essays})
    assert r.status_code == 200
    assert len(r.json()["golden_samples"]) >= 1            # 抽到了样例
    g = client.get("/style-profile").json()
    assert len(g["golden_samples"]) >= 1
    assert g["taboo"] == main.DEFAULT_TABOO                 # 养成不写 taboo


import json as _json


def test_assist_reduce_injects_taboo_and_samples(client, db, mock_anthropic):
    s = main.Session(); s.query(main.StyleProfile).delete()
    s.add(main.StyleProfile(id=1, content="克制短句", rationale="{}", source_essay_ids="[]",
                            taboo="禁止用 ZZZ", golden_samples=_json.dumps(["样例片段ABC"], ensure_ascii=False)))
    s.commit(); s.close()
    mock_anthropic.set_text("缩短后的文字")
    client.post("/assist/reduce", json={"text": "一段要缩减的较长文字。", "context": ""})
    sysp = mock_anthropic.captured["system"]
    assert "克制短句" in sysp        # SOUL 正文
    assert "ZZZ" in sysp             # 用户禁止项
    assert "样例片段ABC" in sysp     # 黄金样例


def test_assist_reduce_no_profile_still_has_default_taboo(client, db, mock_anthropic):
    s = main.Session(); s.query(main.StyleProfile).delete(); s.commit(); s.close()
    mock_anthropic.set_text("x")
    client.post("/assist/reduce", json={"text": "一段要缩减的较长文字。", "context": ""})
    assert "值得注意的是" in mock_anthropic.captured["system"]   # 降级也带 DEFAULT_TABOO
