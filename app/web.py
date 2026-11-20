from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from app.settings import TITLE, SLUG, UNIT, ROLE, TABS, ROOT, SIGNATURE, RULE_VERSION, KEY
from app.reasons import REASONS
from app.modules.official.service import KINDS

router = APIRouter()
templates = Jinja2Templates(directory=ROOT/'app/templates')

KIND_LABELS = {'added': '新增', 'removed': '移除', 'changed': '成绩改写', 'rank': '名次变动'}

@router.get('/',response_class=HTMLResponse,include_in_schema=False)
def home(request: Request):
    return templates.TemplateResponse(request,'workbench.html',{'title':TITLE,'slug':SLUG,'unit':UNIT,
                                      'role':ROLE,'tabs':TABS,'signature':SIGNATURE,'reasons':REASONS,
                                      'version':RULE_VERSION,'key':KEY,'kinds':{kind:KIND_LABELS[kind] for kind in KINDS}})
