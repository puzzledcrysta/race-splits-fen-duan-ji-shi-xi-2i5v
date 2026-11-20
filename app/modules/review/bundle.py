import json
from app.store import connection
from app.modules.runs.service import get
from .decisions import timeline


def bundle(run_id):
    history = timeline(run_id)
    run = get(run_id)
    with connection() as db:
        row = db.execute('SELECT version,run_id FROM official WHERE slot=1').fetchone()
    official = ({'current_version': row['version'], 'is_official': row['run_id'] == run_id}
                if row else {'current_version': 0, 'is_official': False})
    # The export carries source line evidence and the applicable decision version.
    return json.dumps({'manifest':run['manifest'],'counts':run['counts'],'results':run['accepted'],
                       'quarantine':run['quarantine'],'suppressed':run['suppressed'],
                       'reconciliation':run['book'],'review':history,'official':official},
                      ensure_ascii=False,indent=2)
