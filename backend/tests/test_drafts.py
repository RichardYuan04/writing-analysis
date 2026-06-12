import main


def test_create_draft(client, db):
    r = client.post("/drafts", json={"title": "未完成", "content": "写到一半的内容", "date": "2026-06-12"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] > 0
    assert body["title"] == "未完成"
    assert body["content"] == "写到一半的内容"
    assert body["date"] == "2026-06-12"
    assert "updated_at" in body


def test_create_draft_rejects_empty_content(client, db):
    r = client.post("/drafts", json={"title": "x", "content": "   ", "date": "2026-06-12"})
    assert r.status_code == 400


def test_list_drafts_ordered_by_updated_desc(client, db):
    a = client.post("/drafts", json={"title": "A", "content": "aaa", "date": "2026-06-10"}).json()
    b = client.post("/drafts", json={"title": "B", "content": "bbb", "date": "2026-06-11"}).json()
    r = client.get("/drafts")
    assert r.status_code == 200
    ids = [d["id"] for d in r.json()]
    assert ids == [b["id"], a["id"]]  # 后建的 B 排最前


def test_list_drafts_empty(client, db):
    r = client.get("/drafts")
    assert r.status_code == 200
    assert r.json() == []


def test_update_draft(client, db):
    d = client.post("/drafts", json={"title": "原", "content": "原内容", "date": "2026-06-12"}).json()
    r = client.put(f"/drafts/{d['id']}", json={"title": "改", "content": "改后内容", "date": "2026-06-12"})
    assert r.status_code == 200
    assert r.json()["title"] == "改"
    assert r.json()["content"] == "改后内容"
    got = client.get("/drafts").json()
    assert got[0]["content"] == "改后内容"  # 持久化生效


def test_update_draft_404(client, db):
    r = client.put("/drafts/99999", json={"title": "x", "content": "y", "date": "2026-06-12"})
    assert r.status_code == 404


def test_delete_draft(client, db):
    d = client.post("/drafts", json={"title": "删", "content": "删我", "date": "2026-06-12"}).json()
    r = client.delete(f"/drafts/{d['id']}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert client.get("/drafts").json() == []


def test_delete_draft_404(client, db):
    r = client.delete("/drafts/99999")
    assert r.status_code == 404
