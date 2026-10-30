import http from 'node:http';

const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('Usage: node rehearsal-server.mjs [port: 0-65535]');
}
const cohorts = new Map();
const checkedByCohort = new Map();
const page = String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Survey QA rehearsal</title>
<style>body{font:18px system-ui;max-width:800px;margin:32px auto;padding:16px}label,button{display:block;margin:12px 0}#error{color:#a00}</style>
<h1>Survey QA rehearsal</h1><p id="identity"></p><p id="initial"></p>
<section id="isolation"><button id="mark">Set private marker</button><p id="barrier"></p>
<button id="check" disabled>Check private marker after overlap</button><p id="reading"></p><p id="checked"></p></section>
<form id="survey" hidden novalidate><h2 id="heading"></h2><div id="answers"></div>
<p id="error" role="alert"></p><button>Next</button></form>
<script>
const params = new URLSearchParams(location.search);
const id = params.get('Id'), tier = params.get('tier'), locale = params.get('locale');
const fresh = location.pathname === '/fresh';
const cookie = () => document.cookie.split('; ').find(v => v.startsWith('qa_marker='))?.slice(10) ?? null;
const storage = () => localStorage.getItem('qa_marker');
const absent = v => v ?? 'absent';
document.querySelector('#identity').textContent = 'Id: ' + (id ?? 'fresh check') + '; tier: ' + tier + '; locale: ' + locale;
document.querySelector('#initial').textContent = 'Initial cookie: ' + absent(cookie()) + '; initial localStorage: ' + absent(storage());
const isolation = document.querySelector('#isolation');
if (fresh) {
  isolation.hidden = true;
  document.querySelector('#identity').textContent = 'Fresh context ' + (cookie() === null && storage() === null ? 'PASS' : 'FAIL');
} else {
  let marked = false, checked = false;
  const ping = async () => {
    try {
      const query = new URLSearchParams({Id:id, cohort:params.get('cohort') ?? 'rehearsal', count:params.get('count') ?? '1', marked:String(marked), checked:String(checked)});
      const response = await fetch('/ping?' + query);
      if (!response.ok) throw new Error('Invalid cohort parameters');
      const result = await response.json();
      document.querySelector('#barrier').textContent = 'Live marked workers: ' + result.live + '/' + result.required;
      document.querySelector('#checked').textContent = 'Overlap checks complete: ' + result.checked + '/' + result.required;
      document.querySelector('#check').disabled = checked || !result.ready;
    } catch (error) {
      document.querySelector('#barrier').textContent = 'Overlap check blocked: ' + error.message;
      document.querySelector('#check').disabled = true;
    }
  };
  const timer = setInterval(ping, 500);
  window.addEventListener('pagehide', () => clearInterval(timer));
  ping();
  document.querySelector('#mark').onclick = () => {
    document.cookie = 'qa_marker=' + id + '; path=/; SameSite=Lax';
    localStorage.setItem('qa_marker', id);
    marked = true;
    ping();
  };
  document.querySelector('#check').onclick = () => {
    checked = true;
    const pass = cookie() === id && storage() === id;
    document.querySelector('#reading').textContent = 'After overlap: cookie=' + cookie() + '; localStorage=' + storage() + '; isolation ' + (pass ? 'PASS' : 'FAIL');
    document.querySelector('#survey').hidden = false;
    document.querySelector('#mark').disabled = true;
    document.querySelector('#check').disabled = true;
    ping();
    // Keep heartbeat active through the interview so other workers can check overlap.
    render();
  };
}
const form = document.querySelector('#survey'), answers = document.querySelector('#answers');
let step = 'eligible', issues = [], other = '', loop = 0;
const labels = {H:'Housing', W:'Work', O:'Other', N:'None'};
function options(values, type = 'radio') {
  const shuffled = [...values];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const [value, text] of shuffled) {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = type; input.name = 'answer'; input.value = value;
    label.append(input, document.createTextNode(text)); answers.append(label);
    if (type === 'checkbox') input.onchange = () => {
      if (input.checked) for (const peer of answers.querySelectorAll('input')) {
        if ((value === 'N' && peer !== input) || (value !== 'N' && peer.value === 'N')) peer.checked = false;
      }
    };
  }
}
function render() {
  answers.replaceChildren();
  document.querySelector('#error').textContent = '';
  const heading = document.querySelector('#heading');
  if (step === 'eligible' || step === 'advice') {
    heading.textContent = step === 'eligible' ? 'Q1 Eligible?' : 'Q5 Pro advice?';
    options([['Y','Yes'], ['N','No']]);
  } else if (step === 'issues') {
    heading.textContent = 'Q2 Issues'; options(Object.entries(labels), 'checkbox');
  } else if (step === 'other') {
    heading.textContent = 'Q3 Other text';
    const label = document.createElement('label'), input = document.createElement('input');
    input.name = 'answer'; label.append('Other text', input); answers.append(label);
  } else if (step === 'impact') {
    heading.textContent = 'Q4 Impact: ' + (issues[loop] === 'O' ? other : labels[issues[loop]]);
    options([['L','Low'], ['H','High']]);
  } else {
    form.hidden = true;
    const terminal = document.createElement('h2');
    terminal.textContent = step === 'ineligible' ? 'Ineligible' : 'Complete';
    document.body.append(terminal);
    if (step === 'complete') {
      const thanks = document.createElement('p'); thanks.textContent = locale === 'fr' ? 'Merci' : 'Thank you'; document.body.append(thanks);
    }
  }
}
function afterLoops() { step = tier === 'pro' ? 'advice' : 'complete'; }
function startLoops() { loop = 0; if (issues.length) step = 'impact'; else afterLoops(); }
form.onsubmit = event => {
  event.preventDefault();
  const values = new FormData(form).getAll('answer');
  if (!values.length || !values[0].trim()) {
    document.querySelector('#error').textContent = 'Answer required.'; return;
  }
  if (step === 'eligible') step = values[0] === 'Y' ? 'issues' : 'ineligible';
  else if (step === 'issues') {
    issues = ['H','W','O'].filter(code => values.includes(code));
    if (issues.includes('O')) step = 'other'; else startLoops();
  } else if (step === 'other') { other = values[0]; startLoops(); }
  else if (step === 'impact') { if (++loop >= issues.length) afterLoops(); }
  else if (step === 'advice') step = 'complete';
  render();
};
</script></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.searchParams;
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  const validId = /^[0-9]{4}$/.test(p.get('Id') ?? '');
  if (url.pathname === '/ping') {
    const count = Number(p.get('count')), cohort = p.get('cohort');
    if (!validId || !Number.isInteger(count) || count < 1 || count > 5 || !/^[a-zA-Z0-9_-]{1,64}$/.test(cohort ?? '')) {
      res.writeHead(400).end('Invalid cohort parameters'); return;
    }
    if (!cohorts.has(cohort)) { cohorts.set(cohort, new Map()); checkedByCohort.set(cohort, new Set()); }
    const members = cohorts.get(cohort), now = Date.now();
    if (p.get('marked') === 'true') members.set(p.get('Id'), {time:now, checked:p.get('checked') === 'true'});
    if (p.get('marked') === 'true' && p.get('checked') === 'true') checkedByCohort.get(cohort).add(p.get('Id'));
    for (const [id, member] of members) if (now - member.time > 2500) members.delete(id);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({live:members.size, checked:checkedByCohort.get(cohort).size, required:count, ready:members.size >= count})); return;
  }
  if (url.pathname !== '/start' && url.pathname !== '/fresh') { res.writeHead(404).end('Not found'); return; }
  if (url.pathname === '/start' && (!validId || !['basic','pro'].includes(p.get('tier')) || !['en','fr'].includes(p.get('locale')))) {
    res.writeHead(400).end('Required: four-digit Id, tier basic/pro, locale en/fr'); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(page);
});
server.listen(port, '127.0.0.1', () => console.log('Rehearsal: http://127.0.0.1:' + server.address().port));
