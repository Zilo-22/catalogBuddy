
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let csvFile = null;
let csvHeaders = [];
let templates = [];
let currentTemplate = null;
let currentMapping = {}; // { tplFieldKey: shopifyHeader }
let cleanupCols = []; // [header, ...]

async function fetchTemplates() {
  const res = await fetch('/templates');
  const data = await res.json();
  templates = data.templates;

  const sel = $('#templateSelect');
  // placeholder first; nothing selected by default
  sel.innerHTML = [
    '<option value="" disabled selected>Select a template…</option>',
    ...templates.map(t => `<option value="${t.templateKey}">${t.templateName}</option>`)
  ].join('');

  // ensure the button is disabled until a selection is made
  $('#loadTemplateBtn').disabled = true;
}

function parseHeaders(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      preview: 1,
      skipEmptyLines: true,
      complete: (res) => {
        resolve(res.meta.fields || []);
      },
      error: reject
    });
  });
}

function renderMappingUI() {
  if (!currentTemplate) return;
  const area = $('#mappingArea');
  area.innerHTML = '';
  const headersOptions = ['','(none)'].concat(csvHeaders).map(h => `<option value="${h}">${h}</option>`).join('');
  currentMapping = currentMapping || {};

  currentTemplate.fields.forEach(f => {
    const isAutoImage = f.type === 'image' && f.autoMap;
    if (isAutoImage) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<div class="left">${f.label} <span class="field-note">(auto from Image Src + Position ${f.autoMap.split('=').pop()})</span></div>
                       <div><span class="tag">Auto</span></div>`;
      area.appendChild(row);
      return;
    }
    const row = document.createElement('div');
    row.className = 'row';
    const current = currentMapping[f.key] || '';
    row.innerHTML = `<div class="left">${f.label}</div>
                     <div><select data-key="${f.key}">${headersOptions.replace(`value="${current}"`,`value="${current}" selected`)}</select></div>`;
    area.appendChild(row);
  });

  // cleanup UI
  renderCleanupUI();
}

function renderCleanupUI() {
  const list = $('#cleanupList');
  const headersOptions = ['','(none)'].concat(csvHeaders).map(h => `<option value="${h}">${h}</option>`).join('');
  list.innerHTML = '';
  cleanupCols.forEach((col, idx) => {
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `<div class="left">Cleanup column ${idx+1}</div>
                     <div><select data-cleanup-index="${idx}">${headersOptions.replace(`value="${col}"`,`value="${col}" selected`)}</select></div>`;
    list.appendChild(div);
  });
  if (cleanupCols.length === 0) {
    cleanupCols.push('');
    renderCleanupUI();
  }
}

function collectMappingFromUI() {
  currentMapping = {};
  $$('#mappingArea select[data-key]').forEach(sel => {
    const key = sel.getAttribute('data-key');
    const val = sel.value === '(none)' ? '' : sel.value;
    if (val) currentMapping[key] = val;
  });

  // cleanup cols
  cleanupCols = [];
  $$('#cleanupList select[data-cleanup-index]').forEach(sel => {
    const val = sel.value === '(none)' ? '' : sel.value;
    if (val) cleanupCols.push(val);
  });
}

function findUnmappedLabels() {
  const mappedKeys = new Set(Object.keys(currentMapping));
  const labels = [];
  currentTemplate.fields.forEach(f => {
    const isAutoImage = f.type === 'image' && f.autoMap;
    if (isAutoImage) return; // auto-included
    if (!mappedKeys.has(f.key)) labels.push(f.label);
  });
  return labels;
}

async function loadDefaultMapping(templateKey) {
  const res = await fetch(`/mappings/${templateKey}`);
  const data = await res.json();
  currentMapping = data.mapping || {};
  cleanupCols = (data.textCleanup && data.textCleanup.columns) || [];
}

function showPopup(unmapped) {
  $('#unmappedList').innerHTML = unmapped.map(l => `<li>${l}</li>`).join('');
  $('#popup').classList.remove('hidden');
}
function hidePopup() { $('#popup').classList.add('hidden'); }

async function doTransform() {
  collectMappingFromUI();
  const unmapped = findUnmappedLabels();
  if (unmapped.length > 0) {
    showPopup(unmapped);
    return;
  }
  // proceed transform
  await proceedTransform();
}

async function proceedTransform() {
  hidePopup();
  collectMappingFromUI();
  const form = new FormData();
  form.append('file', csvFile);
  form.append('templateKey', currentTemplate.templateKey);
  form.append('mapping', JSON.stringify(currentMapping));
  form.append('textCleanup', JSON.stringify({columns: cleanupCols}));
  form.append('filename', `${currentTemplate.templateKey}_export.csv`);

  const res = await fetch('/transform', { method: 'POST', body: form });
  if (!res.ok) {
    const msg = await res.text();
    alert('Transform error: ' + msg);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentTemplate.templateKey}_export.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', async () => {
  await fetchTemplates();

  // Drag & drop for the pretty upload box
const uploadBox = $('#uploadBox');
uploadBox.addEventListener('dragenter', (e)=>{ e.preventDefault(); uploadBox.classList.add('drag-over'); });
uploadBox.addEventListener('dragover',  (e)=>{ e.preventDefault(); uploadBox.classList.add('drag-over'); });
['dragleave','drop'].forEach(ev => uploadBox.addEventListener(ev, (e)=>{
  e.preventDefault(); uploadBox.classList.remove('drag-over');
}));

uploadBox.addEventListener('drop', async (e) => {
  const f = e.dataTransfer?.files?.[0];
  if(!f) return;
  if(!f.name.toLowerCase().endswith('.csv')) { alert('Please drop a .csv file'); return; }
  csvFile = f;
  $('#fileInfo').textContent = `${f.name} — ${(f.size/1024/1024).toFixed(2)} MB`;
  csvHeaders = await parseHeaders(csvFile);
});


  $('#templateSelect').addEventListener('change', () => {
    $('#loadTemplateBtn').disabled = !$('#templateSelect').value;
  });

  $('#loadTemplateBtn').addEventListener('click', async () => {
    const key = $('#templateSelect').value;
    if (!key) return; // nothing selected, button should be disabled anyway
  
    const res = await fetch(`/templates/${key}`);
    currentTemplate = await res.json();
    await loadDefaultMapping(key);
    renderMappingUI();
  });
  
 

  $('#csvFile').addEventListener('change', async (e) => {
    csvFile = e.target.files[0];
    $('#fileInfo').textContent = csvFile ? `${csvFile.name} — ${(csvFile.size/1024/1024).toFixed(2)} MB` : '';
    csvHeaders = csvFile ? await parseHeaders(csvFile) : [];
  });

  $('#loadTemplateBtn').addEventListener('click', async () => {
    const key = $('#templateSelect').value;
    const res = await fetch(`/templates/${key}`);
    currentTemplate = await res.json();
    await loadDefaultMapping(key);
    renderMappingUI();
  });

  $('#addCleanupBtn').addEventListener('click', () => {
    cleanupCols.push('');
    renderCleanupUI();
  });

  $('#transformBtn').addEventListener('click', doTransform);

  $('#goBackBtn').addEventListener('click', hidePopup);
  $('#proceedBtn').addEventListener('click', async () => {
    // allow proceed anyway (exclude unmapped from export)
    hidePopup();
    await proceedTransform();
  });

  $('#saveDefaultBtn').addEventListener('click', async () => {
    collectMappingFromUI();
    const form = new FormData();
    form.append('mapping', JSON.stringify(currentMapping));
    form.append('textCleanup', JSON.stringify({columns: cleanupCols}));
    form.append('saveAsDefault', 'true');
    const key = currentTemplate.templateKey;
    const res = await fetch(`/mappings/${key}`, { method: 'POST', body: form });
    if (!res.ok) { alert('Failed to save default'); return; }
    alert('Default mapping saved for template: ' + currentTemplate.templateName);
  });
});
