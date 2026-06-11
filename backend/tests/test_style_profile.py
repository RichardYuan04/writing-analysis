import main


def test_app_boots(client):
    # /essays 是已有接口，能 200 即说明 app 正常起来了
    r = client.get("/essays")
    assert r.status_code == 200


def test_style_profile_model_exists_and_empty(db):
    s = db()
    # 表存在且初始为空
    assert s.query(main.StyleProfile).count() == 0
    s.close()
