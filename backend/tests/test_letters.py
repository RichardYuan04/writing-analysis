import main


def _seed_essay():
    s = main.Session()
    e = main.Essay(title="T", content="c", date="2026-06-22", word_count=1, sentiment_score=0.5)
    s.add(e); s.flush(); eid = e.id; s.commit(); s.close()
    return eid


def test_create_essay_with_letters_then_get(client, db):
    letters = [{"id": "lt_1", "persona": "poet", "persona_name": "诗人",
                "content": "来信", "created_at": "2026-06-22T10:00:00"}]
    r = client.post("/essays", json={"title": "T", "content": "今天很好。",
                                     "date": "2026-06-22", "letters": letters})
    assert r.status_code == 200
    eid = r.json()["id"]
    g = client.get(f"/essays/{eid}")
    assert g.status_code == 200
    assert len(g.json()["letters"]) == 1
    assert g.json()["letters"][0]["persona_name"] == "诗人"


def test_create_essay_rejects_over_5_letters(client, db):
    letters = [{"id": f"lt_{i}", "persona": "poet", "persona_name": "诗人",
                "content": "x", "created_at": "t"} for i in range(6)]
    r = client.post("/essays", json={"title": "T", "content": "c",
                                     "date": "2026-06-22", "letters": letters})
    assert r.status_code == 400


def test_get_essay_without_letters_returns_empty_list(client, db):
    eid = _seed_essay()
    g = client.get(f"/essays/{eid}")
    assert g.json()["letters"] == []


def test_append_letter_returns_array_with_new(client, db):
    eid = _seed_essay()
    r = client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": "来信"})
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) == 1
    assert arr[0]["persona"] == "poet"
    assert arr[0]["id"] and arr[0]["created_at"]


def test_append_sixth_letter_rejected(client, db):
    eid = _seed_essay()
    for i in range(5):
        client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": str(i)})
    r = client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": "x"})
    assert r.status_code == 400


def test_delete_letter_idempotent(client, db):
    eid = _seed_essay()
    a = client.post(f"/essays/{eid}/letters",
                    json={"persona": "poet", "persona_name": "诗人", "content": "来信"}).json()
    lid = a[0]["id"]
    r = client.delete(f"/essays/{eid}/letters/{lid}")
    assert r.status_code == 200 and r.json() == []
    r2 = client.delete(f"/essays/{eid}/letters/{lid}")
    assert r2.status_code == 200 and r2.json() == []


def test_draft_with_letters_roundtrip(client, db):
    letters = [{"id": "lt_1", "persona": "editor", "persona_name": "编辑",
                "content": "来信", "created_at": "t"}]
    c = client.post("/drafts", json={"title": "T", "content": "内容",
                                     "date": "2026-06-22", "letters": letters})
    assert c.status_code == 200
    assert len(c.json()["letters"]) == 1
    lst = client.get("/drafts").json()
    assert any(len(d.get("letters", [])) == 1 for d in lst)
