from base64 import b64encode
from fastapi import APIRouter
from app.errors import DataError
from app.store import connection
from app.modules.runs.repository import fetch
from .service import current, history, impact, publish

router = APIRouter()


@router.get('/api/official')
def official():
    return current()


@router.get('/api/official/source')
def official_source():
    publication = current()
    if publication['run_id'] is None:
        raise DataError('RUN_UNKNOWN', '还没有正式成绩', 404)
    record = fetch(publication['run_id'])
    return {'run_id': publication['run_id'],
            'data_base64': b64encode(record['source']).decode(),
            'book_base64': b64encode(record['book']).decode()}


@router.get('/api/official/history')
def versions():
    return history()


@router.get('/api/official/impact/{run_id}')
def candidate_impact(run_id: str):
    return impact(run_id)


@router.post('/api/official/{run_id}')
def promote(run_id: str):
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        return publish(db, run_id)
