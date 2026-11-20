from datetime import datetime, timezone
from decimal import Decimal
from app.errors import DataError
from app.settings import UNIT
from app.store import connection
from app.modules.runs.repository import lookup
from app.modules.runs.service import get

KINDS = ('added', 'removed', 'changed', 'rank')


def _empty():
    return {'version': 0, 'run_id': None, 'review_version': 0, 'published': None,
            'result': None, 'review': [], 'results': []}


def _publication(db):
    row = db.execute('SELECT * FROM official WHERE slot=1').fetchone()
    return dict(row) if row else None


def _timeline(db, run_id):
    return list(map(dict, db.execute(
        'SELECT version,decision,note,changed FROM reviews WHERE run_id=? ORDER BY version DESC',
        (run_id,))))


def publish(db, run_id, changed=None):
    """Atomically make a signed-off run the single official result.

    The incumbent stays in force until the replacement is fully built and
    signed off; generating a correction never touches the official slot.
    Publishing the run that is already official is a no-op, so replaying the
    same correction cannot open a new version.
    """
    lookup(db, run_id)
    current = _publication(db)
    if current and current['run_id'] == run_id:
        return current
    review = db.execute('SELECT version,decision FROM reviews WHERE run_id=? ORDER BY version DESC LIMIT 1',
                        (run_id,)).fetchone()
    if review is None or review['decision'] != '确认':
        raise DataError('OFFICIAL_UNSIGNED', '补正尚未签核确认，正式成绩保持不变', 409)
    changed = changed or datetime.now(timezone.utc).isoformat()
    version = (current['version'] if current else 0) + 1
    if current:
        db.execute('INSERT INTO official_history VALUES (?,?,?,?,?)',
                   (current['version'], current['run_id'], current['review_version'],
                    current['published'], changed))
    db.execute('INSERT INTO official(slot,run_id,version,review_version,published) VALUES (1,?,?,?,?) '
               'ON CONFLICT(slot) DO UPDATE SET run_id=excluded.run_id, version=excluded.version, '
               'review_version=excluded.review_version, published=excluded.published',
               (run_id, version, review['version'], changed))
    return _publication(db)


def current():
    with connection() as db:
        publication = _publication(db)
        if publication is None:
            return _empty()
        review = _timeline(db, publication['run_id'])
    result = get(publication['run_id'])
    return {**publication, 'result': result, 'review': review, 'results': ranked(result['accepted'])}


def history():
    with connection() as db:
        superseded = list(map(dict, db.execute(
            'SELECT version,run_id,review_version,published,superseded '
            'FROM official_history ORDER BY version DESC')))
        publication = _publication(db)
    return {'current': publication, 'superseded': superseded}


def ranked(accepted):
    """Stable placing by net time; ties share a place and fall back to card."""
    ordered = sorted(accepted, key=lambda row: (Decimal(row['amount']), row['key']))
    places, place = {}, 0
    for index, row in enumerate(ordered):
        if index == 0 or Decimal(row['amount']) != Decimal(ordered[index-1]['amount']):
            place = index + 1
        places[row['key']] = place
    for row in accepted:
        row['rank'] = places[row['key']]
    return accepted


def _states(result):
    """Pick the one decisive state per timing card for impact comparison."""
    state = {}
    for row in ranked(result['accepted']):
        state[row['key']] = ('已采信', f"{row['amount']} {UNIT}", row['line'], row['rank'])
    for row in result['quarantine']:
        state.setdefault(row['key'], ('隔离', row['code'], row['line'], None))
    for row in result['suppressed']:
        state.setdefault(row['key'], ('未采信', row['code'], row['line'], None))
    return state


def _change(key, kind, before, after):
    return {'key': key, 'kind': kind,
            'before': f'{before[0]} · {before[1]}' if before else None,
            'after': f'{after[0]} · {after[1]}' if after else None,
            'rank_before': before[3] if before else None,
            'rank_after': after[3] if after else None,
            'official_line': before[2] if before else None,
            'candidate_line': after[2] if after else None}


def impact(run_id):
    """Show which timing cards a late correction would rewrite or re-place."""
    candidate = get(run_id)
    with connection() as db:
        publication = _publication(db)
        review = _timeline(db, run_id)
    incumbent = get(publication['run_id']) if publication else None
    before = _states(incumbent) if incumbent else {}
    after = _states(candidate)
    changes = []
    for key in sorted(before.keys() | after.keys()):
        old, new = before.get(key), after.get(key)
        if old is None:
            changes.append(_change(key, 'added', None, new))
        elif new is None:
            changes.append(_change(key, 'removed', old, None))
        elif old[:3] != new[:3]:
            changes.append(_change(key, 'changed', old, new))
        elif old[3] != new[3]:
            changes.append(_change(key, 'rank', old, new))
    counts = {kind: sum(1 for row in changes if row['kind'] == kind) for kind in KINDS}
    counts['total'] = sum(counts.values())
    return {'run_id': run_id, 'current': bool(publication and publication['run_id'] == run_id),
            'official_version': publication['version'] if publication else 0,
            'official_run_id': publication['run_id'] if publication else None,
            'changes': changes, 'counts': counts, 'review': review}
