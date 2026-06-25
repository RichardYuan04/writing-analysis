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
