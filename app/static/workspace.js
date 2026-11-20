import {query, readInput, encodeInput} from './api.js';
import {el, evidence, table} from './table.js';

const byId = id => document.getElementById(id);
const settings = JSON.parse(byId('settings').textContent);
const links = [...document.querySelectorAll('[data-module]')];
const body = byId('grid-data');
const alert = byId('notice');
const live = byId('state');
const action = document.querySelector('#source button[type=submit]');
const topExport = byId('export');
const reviewForm = byId('review');
let selected = Object.hasOwn(settings.tabs, location.hash.slice(1)) ? location.hash.slice(1) : 'domain';
let official = null;   // the one official result; null until the first sign-off
let draft = null;      // a freshly computed correction, never the official result
let inputs = {};       // inputs behind the displayed result
let reviewVersion = 0; // version of the displayed result's timeline
let candidateVersion = 0;
let renderEpoch = 0;
let impactEpoch = 0;
let activeView = null;
const filter = byId('filter');
const differences = byId('differences');

/* The workbench presents exactly one current result: the official one.
   Before the first sign-off the only result is the freshly computed draft. */
function displayed() {
  return official?.result ?? draft;
}

function officialId() {
  return official?.run_id ?? null;
}

function isOfficial(id = displayed()?.manifest.run_id) {
  return Boolean(id) && id === officialId();
}

function hasCandidate() {
  return Boolean(draft) && !isOfficial(draft.manifest.run_id);
}

function filterTable() {
  if (!activeView) return;
  const {columns, rows, stage} = activeView;
  const query = filter.value.trim().toLocaleLowerCase();
  const selected = rows.filter(row => {
    if (stage === 'reconcile' && differences.checked && row.code === 'MATCH') return false;
    return !query || [row.key,row.id,row.line,row.code,settings.reasons[row.code],row.detail,row.note,row.kind]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(query));
  });
  byId('shown').textContent = `${selected.length} / ${rows.length}`;
  table(body, columns, selected);
}
filter.addEventListener('input', filterTable);
differences.addEventListener('change', filterTable);
const uploaded = new Map();

function notice(message, error = false) {
  alert.value = message;
  alert.classList.toggle('problem', error);
}

function tag(code) {
  return el('span', settings.reasons[code] || code, code === 'MATCH' ? 'state' : 'state problem');
}

function statusText() {
  const report = displayed();
  if (!report) return '等待输入';
  const id = report.manifest.run_id.slice(0, 9);
  if (isOfficial()) return `正式成绩 · 第 ${official.version} 版`;
  return officialId() ? `候选批次 ${id} · 正式成绩未变` : `候选批次 ${id} · 尚未签核启用`;
}

function showEvidence(row) {
  const panel = byId('evidence-panel');
  const record = byId('evidence-key');
  const details = byId('signal');
  if (!row) {
    record.textContent = '';
    details.replaceChildren(el('p', '本批没有可采信记录', 'empty'));
    return;
  }
  record.textContent = row.key;
  const content = el('ol', undefined, panel.dataset.instrument);
  for (const item of row.proof) {
    const line = el('li');
    line.append(el('span', item.metric));
    line.append(el('strong', item.unit ? `${item.value} ${item.unit}` : item.value, 'measure'));
    content.append(line);
  }
  details.replaceChildren(content);
}

function inspect(row) {
  const button = el('button', '查看依据', 'btn');
  button.type = 'button';
  button.addEventListener('click', () => showEvidence(row));
  const raw = evidence('原始字段', row.raw);
  const cell = el('div');
  cell.append(button, raw);
  return cell;
}

function paint(report) {
  if (!report) return;
  byId('created').textContent = `${report.manifest.created.slice(0, 19).replace('T', ' ')} UTC`;
  byId('run-id').textContent = report.manifest.run_id.slice(0, 9);
  byId('run-id').title = report.manifest.run_id;
  topExport.hidden = false;
  topExport.href = `/api/export/${report.manifest.run_id}`;
  const values = {...report.counts, delta: report.book.delta, mismatched: report.book.mismatched};
  for (const cell of document.querySelectorAll('[data-count]')) cell.textContent = values[cell.dataset.count];
  showEvidence(report.accepted[0]);
  live.textContent = statusText();
}

function impactTable(changes) {
  const root = el('table');
  const head = el('thead');
  const top = el('tr');
  for (const label of ['计时卡', '改动', '正式成绩', '名次', '候选成绩', '名次', '来源行']) {
    const cell = el('th', label);
    cell.scope = 'col';
    top.append(cell);
  }
  head.append(top);
  const rows = el('tbody');
  for (const item of changes) {
    const row = el('tr');
    for (const value of [item.key, settings.kinds?.[item.kind] || item.kind, item.before, item.rank_before,
                         item.after, item.rank_after,
                         [item.official_line, item.candidate_line].filter(Boolean).join(' → ') || '—']) {
      row.append(el('td', value ?? '—'));
    }
    rows.append(row);
  }
  root.append(head, rows);
  return root;
}

function button(label, primary, handler) {
  const node = el('button', label, primary ? 'btn btn--primary' : 'btn');
  node.type = 'button';
  node.addEventListener('click', async () => {
    node.disabled = true;
    try { await handler(); } catch (error) { notice(error.message, true); }
    finally { node.disabled = false; }
  });
  return node;
}

function officialSummary(state) {
  const when = official.published.slice(0, 19).replace('T', ' ');
  const decision = official.review.find(item => item.version === official.review_version);
  const note = decision?.note ? ` · 复核意见：${decision.note}` : '';
  state.replaceChildren(
    el('b', `正式成绩 · ${official.run_id.slice(0, 9)}`),
    el('span', ` · 第 ${official.version} 版 · 启用 ${when} UTC · ${decision?.decision ?? '确认'}${note}`),
  );
}

function signOffForm() {
  const form = el('form', undefined, 'panel__body');
  form.append(el('label', '补正复核意见'));
  const note = el('textarea');
  note.maxLength = 500;
  note.rows = 2;
  form.append(note);
  const actions = el('div', undefined, 'actions');
  const decision = el('select');
  for (const option of ['确认', '退回']) {
    const item = el('option', option);
    item.value = option;
    decision.append(item);
  }
  actions.append(el('label', '结论'), decision);
  const submit = el('button', '签核补正', 'btn btn--primary');
  submit.type = 'submit';
  actions.append(submit);
  form.append(actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await query(`/api/review/${draft.manifest.run_id}`,
                  {version: candidateVersion, decision: decision.value, note: note.value});
      notice('补正复核已登记');
      await renderOfficial();
    } catch (error) {
      notice(error.message, true);
      if (error.status === 409) await renderOfficial();
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

async function enableCandidate(id) {
  await query(`/api/official/${id}`, {});
  await loadOfficial();
  if (draft?.manifest.run_id === officialId()) draft = null;
  paint(displayed());
  notice(`已启用第 ${official.version} 版正式成绩`);
  await renderOfficial();
  await render();
}

async function renderOfficial() {
  const panel = byId('official-panel');
  const state = byId('official-state');
  const actions = byId('official-actions');
  const impact = byId('impact');
  panel.hidden = false;
  byId('official-version').textContent = officialId() ? `第 ${official.version} 版` : '未产生';
  actions.replaceChildren();
  impact.replaceChildren();
  if (!officialId()) {
    state.textContent = '尚无正式成绩。签核确认候选批次后启用，工作台只呈现这一个正式成绩。';
  } else {
    officialSummary(state);
    state.append(el('span', hasCandidate() ? ' · 候选批次未替换正式成绩' : ' · 当前工作台显示的就是正式成绩'));
  }
  if (!displayed()) return;
  if (!hasCandidate()) {
    if (!officialId() && draft) {
      impact.append(el('p', '签核确认后启用，即成为唯一正式成绩。', 'empty'));
    } else {
      impact.append(el('p', '运行补正批次后，这里列出将被改写的计时卡。', 'empty'));
    }
    return;
  }
  const id = draft.manifest.run_id;
  const ticket = ++impactEpoch;
  impact.append(el('p', '正在核对补正影响…', 'empty'));
  let report, timeline;
  try {
    [report, timeline] = await Promise.all([
      query(`/api/official/impact/${id}`), query(`/api/review/${id}`),
    ]);
  } catch (error) {
    if (ticket === impactEpoch) notice(error.message, true);
    return;
  }
  if (ticket !== impactEpoch) return;
  candidateVersion = timeline[0]?.version || 0;
  const confirmed = timeline[0]?.decision === '确认';
  const summary = report.counts;
  const line = el('p', report.official_run_id
    ? `候选批次 ${id.slice(0, 9)} 将改写计时卡：新增 ${summary.added} · 移除 ${summary.removed} · 成绩 ${summary.changed} · 名次 ${summary.rank}（共 ${summary.total} 张）`
    : `候选批次 ${id.slice(0, 9)} 含 ${summary.added} 张计时卡；签核确认后启用为唯一正式成绩。`);
  const enable = button(confirmed ? '启用为正式成绩' : '签核确认后可启用', true, () => enableCandidate(id));
  enable.disabled = !confirmed;
  actions.append(enable);
  impact.replaceChildren(line);
  if (officialId()) impact.append(signOffForm());
  if (report.changes.length) impact.append(impactTable(report.changes));
  if (officialId()) notice('候选批次已就绪；正式成绩仍在使用，确认改写范围后再签核启用');
}

async function render() {
  const ticket = ++renderEpoch;
  const stage = selected;
  byId('phase').textContent = settings.tabs[stage];
  reviewForm.hidden = true;
  for (const link of links) {
    if (link.dataset.module === stage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const report = displayed();
  if (!report) return;
  const id = report.manifest.run_id;
  const raw = row => evidence('来源字段', row.raw);
  const key = [settings.key, 'key'];
  const line = ['行号', 'line', 'num'];
  try {
    let view, rows;
    if (stage === 'domain') {
      view = [key, [`净计时 · ${settings.unit}`, 'amount', 'num'], line, ['明细依据', inspect]];
      rows = report.accepted;
    } else if (stage === 'quality') {
      view = [key, line, ['判定', row => tag(row.code)], ['说明', 'detail'], ['字段', raw]];
      rows = [...report.quarantine, ...report.suppressed].sort((a,b) => a.line-b.line);
    } else if (stage === 'reconcile') {
      view = [key, ['实际', 'amount', 'num'], ['外部账', 'reference', 'num'], ['差值', 'delta', 'num'], ['外部行', 'book_line', 'num'], ['结论', row => tag(row.code)]];
      rows = [...report.book.rows].sort((a,b) => Number(a.code === 'MATCH') - Number(b.code === 'MATCH'));
    } else if (stage === 'intake') {
      const intake = await query('/api/intake', inputs);
      view = [line, ['分类', 'kind'], ['字段', raw]];
      rows = [...intake.rows.map(row => ({...row,kind:'完整记录'})), ...intake.rejected.map(row => ({...row,kind:'坏行'})),
              ...intake.blank_lines.map(line => ({line,kind:'空白行',raw:[]})),
              ...intake.header_lines.map(line => ({line,kind:'重复表头',raw:[]}))].sort((a,b) => a.line-b.line);
    } else if (stage === 'contract') {
      const contract = await query('/api/contract', inputs);
      view = [key, line, ['修订', 'revision', 'num'], ['来源时刻 UTC', 'time'], ['字段', row => evidence('归一值', Object.entries(row.fields).map(([k,v]) => `${k} · ${v}`))]];
      rows = contract.accepted;
    } else if (stage === 'runs') {
      const runs = await query('/api/runs');
      view = [['指纹','id'], ['创建 UTC','created'], ['操作', row => {
        const current = row.id === id;
        const node = el('button',current ? '复算当前批' : '查看此批','btn');
        node.addEventListener('click', async () => {
          node.disabled = true;
          try {
            const [past, original] = await Promise.all([
              current ? query(`/api/runs/${row.id}/replay`, {}) : query(`/api/runs/${row.id}`),
              query(`/api/runs/${row.id}/source`),
            ]);
            setDraft(past, original);
            await renderOfficial();
            await render();
            notice(isOfficial() ? '正式成绩已复算，内容未变' : '已载入候选批次，正式成绩未变');
          } catch (error) { notice(error.message, true); }
          finally { node.disabled = false; }
        });
        return node;
      }]];
      rows = runs;
    } else {
      const timeline = await query(`/api/review/${id}`);
      view = [['版本','version','num'], ['结论','decision'], ['复核意见','note'], ['登记 UTC','changed']];
      rows = timeline;
      if (ticket === renderEpoch) {
        reviewVersion = timeline[0]?.version || 0;
        reviewForm.hidden = false;
        const locked = isOfficial(id);
        reviewForm.querySelectorAll('textarea,select,button').forEach(item => { item.disabled = locked; });
        if (locked) notice('正式成绩的签核意见已锁定；要改结论请运行补正批次并在「正式成绩」中签核');
      }
    }
    if (ticket === renderEpoch) {
      if (activeView?.stage !== stage) filter.value = '';
      activeView = {stage, columns: view, rows};
      byId('tools').hidden = false;
      byId('only-differences').hidden = stage !== 'reconcile';
      filterTable();
    }
  } catch (error) {
    if (ticket === renderEpoch) notice(error.message, true);
  }
}

function setDraft(report, reportInputs) {
  if (isOfficial(report.manifest.run_id)) {
    draft = null;
    if (reportInputs) inputs = reportInputs;
  } else {
    draft = report;
    if (reportInputs) inputs = reportInputs;
  }
  paint(displayed());
}

async function loadOfficial() {
  official = await query('/api/official');
  if (draft && isOfficial(draft.manifest.run_id)) draft = null;
}

function decoded(bytes) {
  for (const encoding of ['utf-8', 'gb18030']) {
    try { return new TextDecoder(encoding, {fatal: true}).decode(bytes); }
    catch { /* try next encoding */ }
  }
  return '';
}

function bytesOf(encoded) {
  return Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
}

function loadInputs(original) {
  inputs = original;
  for (const [control,name] of [['source','data_base64'],['book','book_base64']]) {
    const bytes = bytesOf(original[name]);
    const text = decoded(bytes);
    byId(`${control}-csv`).value = text;
    uploaded.set(control, {text, bytes});
  }
}

async function openOfficial() {
  loadInputs(await query('/api/official/source'));
}

async function boot() {
  try {
    await loadOfficial();
  } catch (error) {
    notice(error.message, true);
    return;
  }
  if (officialId()) {
    try {
      await openOfficial();
    } catch (error) {
      notice(error.message, true);
    }
  }
  paint(displayed());
  renderOfficial();
  if (!displayed()) live.textContent = '等待输入';
  else await render();
}

window.addEventListener('hashchange', () => {
  selected = Object.hasOwn(settings.tabs, location.hash.slice(1)) ? location.hash.slice(1) : 'domain';
  render();
});
byId('sample').addEventListener('click', async () => {
  const paths = ['shift', 'external'];
  try {
    const responses = await Promise.all(paths.map(name => fetch(`/api/samples/${name}`)));
    if (responses.some(item => !item.ok)) throw Error('样例暂时不可用');
    const files = await Promise.all(responses.map(item => item.arrayBuffer()));
    for (const [index,name] of ['source','book'].entries()) {
      const text = decoded(new Uint8Array(files[index]));
      byId(`${name}-csv`).value = text;
      uploaded.set(name,{text,bytes:files[index]});
    }
    byId('source-file').value = '';
    byId('book-file').value = '';
    document.querySelector('#source details').open = true;
    notice('样例已载入');
  } catch (error) { notice(error.message, true); }
});
for (const name of ['source','book']) {
  byId(`${name}-file`).addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    action.disabled = true;
    try {
      const [text,bytes] = await readInput(file);
      byId(`${name}-csv`).value = text;
      uploaded.set(name,{text:byId(`${name}-csv`).value,bytes});
      notice(`已读取 ${file.name}`);
    } catch (error) {
      event.target.value = '';
      notice(error.message, true);
    } finally { action.disabled = false; }
  });
}
byId('source').addEventListener('submit', async event => {
  event.preventDefault();
  const candidate = {};
  for (const [control,name] of [['source','data'],['book','book']]) {
    const text = byId(`${control}-csv`).value;
    const original = uploaded.get(control);
    if (original && text === original.text) candidate[`${name}_base64`] = encodeInput(original.bytes);
    else if (text.length || original) candidate[name] = text;
  }
  action.disabled = true;
  ++renderEpoch;
  notice('计算中');
  try {
    const report = await query('/api/runs', candidate);
    setDraft(report, candidate);
    notice(officialId()
      ? '候选批次已生成；正式成绩仍在使用，确认改写范围后再签核启用'
      : '候选批次已生成；签核确认后启用为正式成绩');
    await renderOfficial();
    await render();
  } catch (error) {
    if (officialId()) notice(`${error.message}；正式成绩保持不变`, true);
    else notice(error.message, true);
  }
  finally { action.disabled = false; }
});
reviewForm.addEventListener('submit', async event => {
  event.preventDefault();
  const id = displayed().manifest.run_id;
  const note = byId('review-note');
  try {
    await query(`/api/review/${id}`, {version: reviewVersion, decision: byId('decision').value, note: note.value});
    notice('复核已登记');
    note.value = '';
    await loadOfficial();
    paint(displayed());
    await renderOfficial();
    await render();
  } catch (error) {
    notice(error.message, true);
    if (error.status === 409) { await loadOfficial(); await renderOfficial(); await render(); }
  }
});
boot();
