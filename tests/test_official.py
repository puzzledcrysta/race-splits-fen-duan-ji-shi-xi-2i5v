import csv
import io

import pytest

from app.settings import FIELDS


def sign(client, run_id, note='补正已逐条核对'):
    version = len(client.get(f'/api/review/{run_id}').json())
    response = client.post(f'/api/review/{run_id}',
                           json={'version': version, 'decision': '确认', 'note': note})
    assert response.status_code == 200
    return response.json()


def correction(source, key='00104', value='起点:0;半程:40;终点:120'):
    reader = csv.reader(io.StringIO(source.decode('utf-8-sig')))
    header = next(reader)
    rows = [row for row in reader if row and row[0] == key]
    rows[0][header.index(FIELDS[-1])] = value
    stream = io.StringIO(newline='')
    csv.writer(stream).writerows([header, rows[0]])
    return stream.getvalue().encode()


@pytest.fixture
def official(client):
    run_id = client.post('/api/runs', json={}).json()['manifest']['run_id']
    sign(client, run_id)
    assert client.post(f'/api/official/{run_id}').json()['version'] == 1
    return run_id


def test_no_official_before_sign_off(client):
    assert client.get('/api/official').json()['run_id'] is None
    run_id = client.post('/api/runs', json={}).json()['manifest']['run_id']
    refused = client.post(f'/api/official/{run_id}')
    assert (refused.status_code, refused.json()['code']) == (409, 'OFFICIAL_UNSIGNED')
    assert client.get('/api/official').json()['version'] == 0


def test_official_carries_result_review_and_diff(client, official):
    publication = client.get('/api/official').json()
    assert publication['run_id'] == official and publication['version'] == 1
    assert publication['result']['book']['mismatched'] == 3
    assert publication['review'][0]['version'] == publication['review_version']


def test_one_official_result_only(client, official):
    other = client.post('/api/runs', json={'book': '计时卡,外部记录值(秒)\n00101,120\n'}).json()
    assert other['manifest']['run_id'] != official
    assert client.get('/api/official').json()['run_id'] == official


def test_replay_keeps_single_version(client, official):
    client.post(f'/api/runs/{official}/replay')
    assert client.post(f'/api/official/{official}').json()['version'] == 1
    assert client.get('/api/official/history').json()['superseded'] == []


def test_impact_names_rewritten_cards(client, official, source):
    candidate = client.post('/api/runs', json={'data': correction(source).decode()}).json()
    report = client.get(f"/api/official/impact/{candidate['manifest']['run_id']}").json()
    assert report['current'] is False and report['official_version'] == 1
    changed = {row['key']: row for row in report['changes']}
    assert changed['00104']['kind'] == 'changed'
    assert changed['00104']['official_line'] and changed['00104']['candidate_line']
    assert report['counts']['changed'] >= 1 and report['counts']['total'] == len(report['changes'])
    # generating a candidate never touches the official slot
    assert client.get('/api/official').json()['run_id'] == official


def test_promote_correction_versions_history(client, official, source):
    candidate = client.post('/api/runs', json={'data': correction(source).decode()}).json()
    run_id = candidate['manifest']['run_id']
    sign(client, run_id)
    published = client.post(f'/api/official/{run_id}').json()
    assert published['version'] == 2 and published['run_id'] == run_id
    history = client.get('/api/official/history').json()
    assert [row['run_id'] for row in history['superseded']] == [official]
    assert client.post(f'/api/official/{run_id}').json()['version'] == 2


def test_old_official_review_is_locked(client, official, source):
    candidate = client.post('/api/runs', json={'data': correction(source).decode()}).json()['manifest']['run_id']
    sign(client, candidate)
    client.post(f'/api/official/{candidate}')
    locked = client.post(f'/api/review/{official}',
                         json={'version': 1, 'decision': '退回', 'note': '改写名次'})
    assert (locked.status_code, locked.json()['code']) == (409, 'OFFICIAL_LOCKED')
    assert client.get('/api/official').json()['run_id'] == candidate


def test_failed_replacement_keeps_official(client, official):
    broken = client.post('/api/runs', json={'data': 'bad\na'})
    assert broken.status_code == 422
    publication = client.get('/api/official').json()
    assert publication['run_id'] == official and publication['version'] == 1


def test_export_follows_official(client, official):
    proof = client.get(f'/api/export/{official}').json()
    assert proof['official'] == {'current_version': 1, 'is_official': True}
    assert proof['review'][0]['decision'] == '确认'


def test_workbench_names_official(client, official):
    page = client.get('/')
    assert page.status_code == 200 and '正式成绩' in page.text
