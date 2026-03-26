#!/bin/bash

# 1. Ajouter case 'upload' dans le switch de showPage
sed -i "s|case 'admin': renderAdmin(container, title, actions); break;|case 'admin': renderAdmin(container, title, actions); break;\n    case 'upload': renderUpload(container, title, actions); break;|" /opt/jdrnotes/public/index.html

# 2. Injecter la fonction renderUpload juste avant </script>
# Trouver la dernière ligne </script> et insérer avant
python3 << 'PYEOF'
with open('/opt/jdrnotes/public/index.html', 'r') as f:
    content = f.read()

upload_code = '''
// ═══════════════════════════════════════════════════════
// UPLOAD AUDIO
// ═══════════════════════════════════════════════════════
async function renderUpload(container, title, actions) {
  title.textContent = '🎙️ Importer audio';
  actions.innerHTML += `<button class="btn-gold" onclick="renderUpload(document.getElementById('page-container'), document.getElementById('topbar-title'), document.getElementById('topbar-actions'))">🔄 Actualiser</button>`;

  // Charger campagnes et fichiers
  const [campaigns, files] = await Promise.all([
    fetch('/api/campaigns', {credentials:'include'}).then(r=>r.json()).catch(()=>[]),
    fetch('/api/upload/files', {credentials:'include'}).then(r=>r.json()).catch(()=>[])
  ]);

  const campOptions = Array.isArray(campaigns)
    ? campaigns.map(c => `<option value="${c.id}">[${c.id}] ${c.title}</option>`).join('')
    : '';

  const filesHtml = Array.isArray(files) && files.length ? files.map(f => {
    const size = (f.size / 1024 / 1024).toFixed(1);
    const date = new Date(f.date).toLocaleDateString('fr-FR');
    const ext = f.name.split('.').pop().toLowerCase();
    const icon = ext === 'zip' ? '📦' : '🎵';
    return `
      <div class="file-item" id="file-${CSS.escape(f.name)}">
        <div class="file-info">
          <span class="file-icon">${icon}</span>
          <div>
            <div class="file-name">${f.name}</div>
            <div class="file-meta">${size} Mo • ${date}</div>
          </div>
        </div>
        <div class="file-actions">
          <select class="input-sm" id="camp-${CSS.escape(f.name)}">
            <option value="">-- Campagne --</option>
            ${campOptions}
          </select>
          <input class="input-sm" id="titre-${CSS.escape(f.name)}" placeholder="Titre session" style="width:150px">
          <button class="btn-gold btn-sm" onclick="startTranscription('${f.name}')">⚡ Transcrire</button>
          <button class="btn-red btn-sm" onclick="deleteFile('${f.name}')">🗑️</button>
        </div>
        <div class="transcribe-status" id="status-${CSS.escape(f.name)}" style="display:none"></div>
      </div>`;
  }).join('') : '<div class="empty-state">Aucun fichier audio. Uploadez un enregistrement ci-dessous.</div>';

  container.innerHTML = `
    <div class="page-content">
      <div class="upload-zone" id="upload-zone">
        <div class="upload-icon">🎙️</div>
        <div class="upload-text">Glissez un fichier audio ici</div>
        <div class="upload-subtext">MP3, WAV, FLAC, OGG, M4A, ZIP Craig • Jusqu'à 500 Mo</div>
        <input type="file" id="audio-input" accept=".mp3,.wav,.flac,.ogg,.m4a,.mkv,.webm,.zip" style="display:none" onchange="handleFileSelect(this)">
        <button class="btn-gold" onclick="document.getElementById('audio-input').click()" style="margin-top:16px">📂 Choisir un fichier</button>
        <div id="upload-progress" style="display:none;margin-top:16px;width:100%">
          <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
          <div id="upload-label" style="text-align:center;margin-top:8px;color:var(--ink2)">Upload en cours...</div>
        </div>
      </div>
      <div class="section-title" style="margin-top:32px">📁 Fichiers disponibles</div>
      <div id="files-list">${filesHtml}</div>
    </div>

    <style>
      .upload-zone {
        border: 2px dashed var(--border2);
        border-radius: var(--r);
        padding: 48px 32px;
        text-align: center;
        background: var(--surface);
        cursor: pointer;
        transition: all 0.2s;
      }
      .upload-zone.drag-over { border-color: var(--gold); background: var(--gold-dim); }
      .upload-icon { font-size: 48px; margin-bottom: 12px; }
      .upload-text { font-family: 'Cinzel', serif; font-size: 18px; color: var(--ink); margin-bottom: 8px; }
      .upload-subtext { color: var(--ink3); font-size: 14px; }
      .progress-bar { width: 100%; height: 8px; background: var(--surface2); border-radius: 4px; overflow: hidden; }
      .progress-fill { height: 100%; background: var(--gold); border-radius: 4px; transition: width 0.3s; width: 0%; }
      .file-item {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r);
        padding: 16px;
        margin-bottom: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .file-info { display: flex; align-items: center; gap: 12px; }
      .file-icon { font-size: 28px; }
      .file-name { color: var(--ink); font-weight: 600; word-break: break-all; }
      .file-meta { color: var(--ink3); font-size: 13px; }
      .file-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .input-sm { background: var(--bg2); border: 1px solid var(--border2); border-radius: 6px; color: var(--ink); padding: 6px 10px; font-size: 13px; }
      .btn-sm { padding: 6px 14px; font-size: 13px; border: none; border-radius: 6px; cursor: pointer; font-family: inherit; }
      .btn-gold { background: var(--gold); color: var(--bg); font-weight: 700; }
      .btn-gold:hover { background: var(--gold2); }
      .btn-red { background: var(--red); color: white; }
      .btn-red:hover { opacity: 0.85; }
      .transcribe-status { padding: 10px 14px; border-radius: 6px; font-size: 14px; }
      .transcribe-status.pending { background: var(--gold-dim); color: var(--gold); }
      .transcribe-status.done { background: rgba(74,171,114,0.15); color: var(--green); }
      .transcribe-status.error { background: rgba(192,64,64,0.15); color: var(--red); }
      .section-title { font-family: 'Cinzel', serif; color: var(--gold); font-size: 15px; letter-spacing: 1px; margin-bottom: 16px; }
      .empty-state { text-align: center; color: var(--ink3); padding: 32px; }
    </style>`;

  // Drag & drop
  const zone = document.getElementById('upload-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });
}

function handleFileSelect(input) {
  if (input.files[0]) uploadFile(input.files[0]);
}

async function uploadFile(file) {
  const progress = document.getElementById('upload-progress');
  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('upload-label');
  progress.style.display = 'block';
  label.textContent = `Upload de ${file.name}...`;

  const formData = new FormData();
  formData.append('audio', file);

  try {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        fill.style.width = pct + '%';
        label.textContent = `Upload de ${file.name}... ${pct}%`;
      }
    };
    await new Promise((resolve, reject) => {
      xhr.onload = () => xhr.status < 400 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(xhr.responseText));
      xhr.onerror = () => reject(new Error('Erreur réseau'));
      xhr.open('POST', '/api/upload');
      xhr.withCredentials = true;
      xhr.send(formData);
    });
    label.textContent = `✅ ${file.name} uploadé !`;
    fill.style.width = '100%';
    setTimeout(() => renderUpload(
      document.getElementById('page-container'),
      document.getElementById('topbar-title'),
      document.getElementById('topbar-actions')
    ), 1500);
  } catch(e) {
    label.textContent = `❌ Erreur: ${e.message}`;
    fill.style.background = 'var(--red)';
  }
}

async function startTranscription(filename) {
  const campSel = document.getElementById('camp-' + CSS.escape(filename));
  const titreInput = document.getElementById('titre-' + CSS.escape(filename));
  const statusEl = document.getElementById('status-' + CSS.escape(filename));

  if (!campSel.value) { alert('Choisissez une campagne'); return; }

  statusEl.style.display = 'block';
  statusEl.className = 'transcribe-status pending';
  statusEl.textContent = '⏳ Transcription en cours... (peut prendre plusieurs minutes)';

  try {
    const r = await fetch('/api/upload/transcribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, campaign_id: campSel.value, titre: titreInput.value || undefined })
    });
    const { job_id } = await r.json();

    // Polling du statut
    const poll = setInterval(async () => {
      const job = await fetch(`/api/upload/job/${job_id}`, {credentials:'include'}).then(r=>r.json());
      if (job.status === 'done') {
        clearInterval(poll);
        statusEl.className = 'transcribe-status done';
        statusEl.innerHTML = `✅ Session <strong>${job.title}</strong> créée ! (ID: ${job.session_id}) — <a href="#" onclick="showPage('session', {id:${job.session_id}})" style="color:var(--gold)">Voir la session</a>`;
      } else if (job.status === 'error') {
        clearInterval(poll);
        statusEl.className = 'transcribe-status error';
        statusEl.textContent = `❌ Erreur: ${job.error}`;
      }
    }, 3000);
  } catch(e) {
    statusEl.className = 'transcribe-status error';
    statusEl.textContent = `❌ Erreur: ${e.message}`;
  }
}

async function deleteFile(filename) {
  if (!confirm(`Supprimer ${filename} ?`)) return;
  await fetch(`/api/upload/files/${encodeURIComponent(filename)}`, { method: 'DELETE', credentials: 'include' });
  renderUpload(document.getElementById('page-container'), document.getElementById('topbar-title'), document.getElementById('topbar-actions'));
}
'''

# Insérer avant la dernière balise </script>
last_script = content.rfind('</script>')
content = content[:last_script] + upload_code + '\n' + content[last_script:]

with open('/opt/jdrnotes/public/index.html', 'w') as f:
    f.write(content)

print("Done")
PYEOF

echo "Patch terminé"
