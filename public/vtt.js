// ═══════════════════════════════════════
// VTT — Table Virtuelle
// ═══════════════════════════════════════
let vttState = {
  room: null, tokens: [], walls: [], ws: null, dragging: null,
  offsetX: 0, offsetY: 0, scale: 1, panX: 0, panY: 0,
  isPanning: false, lastPan: null, canvas: null, ctx: null,
  chatMessages: [], myName: null, combatOrder: [], currentTurn: 0,
  wallMode: false, drawingWall: null, wallColor: '#8b4513', wallThickness: 4,
  fogEnabled: false, visionRadius: 400
};

async function renderVTT(container, title, actions) {
  title.textContent = "Table Virtuelle";
  document.getElementById("page-container").classList.add("vtt-mode");
  const rooms = await api("GET", "/vtt/rooms");

  const roomsList = rooms.map(r =>
    "<div class=\"btn btn-ghost btn-sm\" style=\"text-align:left;cursor:pointer\" onclick=\"vttJoinRoom(" + r.id + ",'" + r.name + "')\">" + r.name + "</div>"
  ).join("");

  const html = [
    "<div style=\"display:flex;height:calc(100vh - 70px);gap:0;overflow:hidden\">",
    // Sidebar gauche
    "<div style=\"width:240px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0\">",
      "<div style=\"padding:12px;border-bottom:1px solid var(--border)\">",
        "<div style=\"font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px\">Salles</div>",
        "<div id=\"vtt-rooms-list\" style=\"display:flex;flex-direction:column;gap:6px;margin-bottom:8px\">" + roomsList + "</div>",
        "<div style=\"display:flex;gap:4px;margin-bottom:4px\">",
          "<input id=\"new-room-name\" class=\"input-sm\" placeholder=\"Nouvelle salle\" style=\"flex:1\">",
          "<button class=\"btn btn-sm\" style=\"background:var(--gold);color:var(--bg)\" onclick=\"vttCreateRoom()\">+</button>",
        "</div>",
        "<select id=\"new-room-system\" class=\"input-sm\" style=\"width:100%;margin-bottom:4px\">",
          "<option value=\"\">(Aucun systeme)</option>",
          "<option value=\"savage_worlds\">Savage Worlds</option>",
          "<option value=\"dnd5e\">D&D 5e</option>",
        "</select>",
      "</div>",
      "<div style=\"padding:12px;border-bottom:1px solid var(--border);flex:1;overflow-y:auto\">",
        "<div style=\"font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px\">Jetons</div>",
        "<div id=\"vtt-tokens-sidebar\" style=\"display:flex;flex-direction:column;gap:4px\"></div>",
        "<button class=\"btn btn-sm btn-ghost\" style=\"margin-top:8px;width:100%\" onclick=\"vttAddTokenModal()\">+ Ajouter jeton</button>",
      "</div>",
      "<div style=\"padding:12px;border-bottom:1px solid var(--border)\">",
        "<div style=\"font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:6px\">Initiative</div>",
        "<div id=\"vtt-initiative\" style=\"font-size:13px;color:var(--ink3)\">Aucun combat</div>",
        "<div style=\"display:flex;gap:4px;margin-top:6px\">",
          "<button class=\"btn btn-sm btn-ghost\" onclick=\"vttNextTurn()\">Suivant</button>",
          "<button class=\"btn btn-sm btn-ghost\" onclick=\"vttRollInit()\">Init</button>",
        "</div>",
      "</div>",
      "<div style=\"padding:12px\">",
        "<div style=\"font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:6px\">Système</div>",
        "<select id=\"room-system-sel\" class=\"input-sm\" style=\"width:100%;margin-bottom:8px\" onchange=\"vttSetRoomSystem(this.value)\">",
          "<option value=\"\">(Aucun)</option>",
          "<option value=\"savage_worlds\">Savage Worlds</option>",
          "<option value=\"dnd5e\">D&D 5e</option>",
        "</select>",
        "<div style=\"font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:6px\">Carte</div>",
        "<input type=\"file\" id=\"map-upload\" accept=\"image/*\" style=\"display:none\" onchange=\"vttUploadMap(this)\">",
        "<button class=\"btn btn-sm btn-ghost\" style=\"width:100%;margin-bottom:6px\" onclick=\"document.getElementById('map-upload').click()\">+ Ajouter carte</button>",
        "<div id=\"vtt-maps-list\" style=\"display:flex;flex-direction:column;gap:4px;margin-bottom:6px\"></div>",
        "<div style=\"display:flex;gap:4px;margin-bottom:6px\">",
          "<button class=\"btn btn-sm btn-ghost\" onclick=\"vttZoom(0.1)\">+</button>",
          "<button class=\"btn btn-sm btn-ghost\" onclick=\"vttZoom(-0.1)\">-</button>",
          "<button class=\"btn btn-sm btn-ghost\" onclick=\"vttResetView()\">Reset</button>",
        "</div>",
        "<div style=\"border-top:1px solid var(--border);padding-top:8px;margin-top:4px\">",
          "<div style=\"font-size:12px;color:var(--ink3);margin-bottom:4px\">Murs</div>",
          "<div style=\"display:flex;gap:4px;margin-bottom:4px\">",
            "<button class=\"btn btn-sm btn-ghost\" id=\"wall-mode-btn\" onclick=\"vttToggleWallMode()\">Dessiner</button>",
            "<button class=\"btn btn-sm btn-ghost\" onclick=\"vttClearWalls()\">Effacer</button>",
          "</div>",
          "<input type=\"color\" value=\"#8b4513\" onchange=\"vttState.wallColor=this.value\" style=\"width:30px;height:22px;border:none;cursor:pointer\">",
        "</div>",
        "<div style=\"border-top:1px solid var(--border);padding-top:8px;margin-top:8px\">",
          "<div style=\"font-size:12px;color:var(--ink3);margin-bottom:4px\">Brouillard</div>",
          "<button class=\"btn btn-sm btn-ghost\" id=\"fog-btn\" onclick=\"vttToggleFog()\">Activer</button>",
          "<input type=\"range\" min=\"100\" max=\"800\" value=\"400\" oninput=\"vttState.visionRadius=parseInt(this.value);vttDraw()\" style=\"width:100%;margin-top:4px\">",
        "</div>",
      "</div>",
    "</div>",
    // Canvas
    "<div style=\"flex:1;position:relative;overflow:hidden;background:#1a1a2e\">",
      "<canvas id=\"vtt-canvas\" style=\"position:absolute;top:0;left:0;cursor:grab\"></canvas>",
      "<div id=\"vtt-no-room\" style=\"position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--ink3);font-size:18px;font-family:Cinzel,serif\">",
        "Selectionne ou cree une salle pour commencer",
      "</div>",
    "</div>",
    // Sidebar droite
    "<div style=\"width:260px;background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0\">",
      "<div style=\"padding:12px;border-bottom:1px solid var(--border)\">",
        "<div style=\"display:flex;border-bottom:1px solid var(--border);margin-bottom:8px\">",
        "<button class=\"btn btn-sm\" id=\"tab-dice-btn\" style=\"flex:1;border-radius:0;background:var(--gold);color:var(--bg)\" onclick=\"swSwitchTab('dice')\">Des</button>",
        "<button class=\"btn btn-sm\" id=\"tab-sw-btn\" style=\"flex:1;border-radius:0\" onclick=\"swSwitchTab('sw')\">SW</button>",
        "<button class=\"btn btn-sm\" id=\"tab-chars-btn\" style=\"flex:1;border-radius:0\" onclick=\"swSwitchTab('chars')\">Fiches</button>",
      "</div>",
      "<div id=\"tab-dice\" style=\"\">",
        "<div style=\"display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px\">",
          [4,6,8,10,12,20,100].map(d => "<button class=\"btn btn-sm btn-ghost\" onclick=\"vttRollDice(" + d + ")\">d" + d + "</button>").join(""),
        "</div>",
        "<div style=\"display:flex;gap:4px\">",
          "<input id=\"dice-expr\" class=\"input-sm\" placeholder=\"2d6+3\" style=\"flex:1\">",
          "<button class=\"btn btn-sm\" style=\"background:var(--gold);color:var(--bg)\" onclick=\"vttRollCustom()\">Roll</button>",
        "</div>",
        "<div id=\"dice-result\" style=\"margin-top:8px;font-size:20px;font-weight:700;color:var(--gold);text-align:center;min-height:30px\"></div>",
      "</div>",
      "</div>",
      "<div id=\"tab-sw\" style=\"display:none\"><div id=\"sw-panel\"></div></div>",
      "<div style=\"flex:1;display:flex;flex-direction:column;overflow:hidden\">",
        "<div style=\"padding:8px 12px;border-bottom:1px solid var(--border);font-family:Cinzel,serif;color:var(--gold);font-size:13px\">Chat</div>",
        "<div id=\"vtt-chat\" style=\"flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px\"></div>",
        "<div style=\"padding:8px;border-top:1px solid var(--border);display:flex;gap:4px\">",
          "<input id=\"chat-input\" class=\"input-sm\" placeholder=\"Message...\" style=\"flex:1\" onkeydown=\"if(event.key==='Enter')vttSendChat()\">",
          "<button class=\"btn btn-sm\" style=\"background:var(--gold);color:var(--bg)\" onclick=\"vttSendChat()\">Envoyer</button>",
        "</div>",
      "</div>",
    "</div>",
    "</div>",
    // Modal
    "<div id=\"vtt-token-modal\" style=\"display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;align-items:center;justify-content:center\">",
      "<div style=\"background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;width:340px\">",
        "<div style=\"font-family:Cinzel,serif;color:var(--gold);margin-bottom:16px\">Ajouter un jeton</div>",
        "<div style=\"display:flex;flex-direction:column;gap:10px\">",
          "<input class=\"input-sm\" id=\"tok-name\" placeholder=\"Nom du jeton\">",
          "<div style=\"display:flex;gap:8px\">",
            "<input class=\"input-sm\" id=\"tok-hp\" placeholder=\"PV actuels\" type=\"number\" style=\"flex:1\">",
            "<input class=\"input-sm\" id=\"tok-hpmax\" placeholder=\"PV max\" type=\"number\" style=\"flex:1\">",
          "</div>",
          "<input class=\"input-sm\" id=\"tok-init\" placeholder=\"Initiative\" type=\"number\">",
          "<div style=\"display:flex;align-items:center;gap:8px\">",
            "<label style=\"color:var(--ink2);font-size:13px\">Couleur :</label>",
            "<input type=\"color\" id=\"tok-color\" value=\"#4aab72\" style=\"width:40px;height:30px;border:none;cursor:pointer\">",
          "</div>",
          "<div style=\"display:flex;gap:8px;margin-top:8px\">",
            "<button class=\"btn btn-sm\" style=\"flex:1;background:var(--gold);color:var(--bg);font-weight:700\" onclick=\"vttAddToken()\">Ajouter</button>",
            "<button class=\"btn btn-sm btn-ghost\" style=\"flex:1\" onclick=\"vttCloseTokenModal()\">Annuler</button>",
          "</div>",
        "</div>",
      "</div>",
    "</div>"
  ].flat().join("");

  container.innerHTML = html;
  vttInitCanvas();
  vttConnectWS();
}

function vttInitCanvas() {
  const canvas = document.getElementById('vtt-canvas');
  if (!canvas) return;
  vttState.canvas = canvas;
  vttState.ctx = canvas.getContext('2d');
  vttResizeCanvas();
  window.addEventListener('resize', vttResizeCanvas);
  canvas.addEventListener('mousedown', vttOnMouseDown);
  canvas.addEventListener('mousemove', vttOnMouseMove);
  canvas.addEventListener('mouseup', vttOnMouseUp);
  canvas.addEventListener('wheel', vttOnWheel, { passive: false });
  canvas.addEventListener('dblclick', vttOnDblClick);
  vttDraw();
}

function vttResizeCanvas() {
  const canvas = vttState.canvas;
  if (!canvas) return;
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
  vttDraw();
}

function vttDraw() {
  const { canvas, ctx, tokens, scale, panX, panY } = vttState;
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(scale, scale);
  // Dessiner la carte
  if (vttState.mapImg) {
    ctx.drawImage(vttState.mapImg, 0, 0);
  } else {
    // Grille par défaut
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const gs = vttState.room?.grid_size || 50;
    const w = canvas.width / scale, h = canvas.height / scale;
    for (let x = 0; x < w + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h + gs); ctx.stroke(); }
    for (let y = 0; y < h + gs; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w + gs, y); ctx.stroke(); }
  }
  // Dessiner les murs
  vttState.walls.forEach(w => {
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    ctx.strokeStyle = w.color || '#8b4513';
    ctx.lineWidth = w.thickness || 4;
    ctx.lineCap = 'round';
    ctx.stroke();
  });
  // Mur en cours de dessin
  if (vttState.drawingWall) {
    const dw = vttState.drawingWall;
    ctx.beginPath();
    ctx.moveTo(dw.x1, dw.y1);
    ctx.lineTo(dw.x2, dw.y2);
    ctx.strokeStyle = vttState.wallColor;
    ctx.lineWidth = vttState.wallThickness;
    ctx.lineCap = 'round';
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Dessiner les jetons
  tokens.forEach(tok => {
    if (!tok.is_visible) return;
    const size = tok.width || 50;
    const x = tok.x, y = tok.y;
    // Cercle jeton
    ctx.beginPath();
    ctx.arc(x + size/2, y + size/2, size/2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = tok.color || '#4aab72';
    ctx.fill();
    ctx.strokeStyle = tok === vttState.selected ? '#fff' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = tok === vttState.selected ? 3 : 1;
    ctx.stroke();
    // Nom
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, size/4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(tok.name.slice(0, 8), x + size/2, y + size/2 + size/8);
    // Barre de vie
    if (tok.hp !== null && tok.hp_max) {
      const pct = Math.max(0, tok.hp / tok.hp_max);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x, y + size + 2, size, 6);
      ctx.fillStyle = pct > 0.5 ? '#4aab72' : pct > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(x, y + size + 2, size * pct, 6);
    }
  });
  // Brouillard de guerre
  vttDrawFog();
  ctx.restore();
}

function vttOnMouseDown(e) {
  const { canvas, tokens, scale, panX, panY } = vttState;
  const rect = canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left - panX) / scale;
  const wy = (e.clientY - rect.top - panY) / scale;
  // Chercher un jeton
  const tok = tokens.find(t => wx >= t.x && wx <= t.x + t.width && wy >= t.y && wy <= t.y + t.width);
  if (vttState.wallMode) {
    if (vttState.drawingWall) {
      // Deuxième clic = finaliser le mur
      vttState.drawingWall.x2 = wx;
      vttState.drawingWall.y2 = wy;
      const w = vttState.drawingWall;
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
      if (Math.sqrt(dx*dx + dy*dy) > 10) {
        const wall = { ...w, color: vttState.wallColor, thickness: vttState.wallThickness };
        api('POST', '/vtt/rooms/' + vttState.room.id + '/walls', wall).then(d => {
          wall.id = d.id;
          vttState.walls.push(wall);
          vttBroadcast({ type: 'wall_add', wall });
          vttDraw();
        });
      }
      vttState.drawingWall = null;
    } else {
      // Premier clic = commencer le mur
      vttState.drawingWall = { x1: wx, y1: wy, x2: wx, y2: wy };
    }
  } else if (tok) {
    vttState.dragging = tok;
    vttState.selected = tok;
    vttState.offsetX = wx - tok.x;
    vttState.offsetY = wy - tok.y;
    canvas.style.cursor = 'grabbing';
  } else {
    vttState.selected = null;
    vttState.isPanning = true;
    vttState.lastPan = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  }
  vttDraw();
}

function vttOnMouseMove(e) {
  const { canvas, scale, panX, panY } = vttState;
  const rect = canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left - panX) / scale;
  const wy = (e.clientY - rect.top - panY) / scale;
  if (vttState.wallMode && vttState.drawingWall) {
    vttState.drawingWall.x2 = wx;
    vttState.drawingWall.y2 = wy;
    vttDraw();
  } else if (vttState.dragging) {
    const gs = vttState.room?.grid_size || 50;
    vttState.dragging.x = Math.round((wx - vttState.offsetX) / gs) * gs;
    vttState.dragging.y = Math.round((wy - vttState.offsetY) / gs) * gs;
    vttDraw();
  } else if (vttState.isPanning && vttState.lastPan) {
    vttState.panX += e.clientX - vttState.lastPan.x;
    vttState.panY += e.clientY - vttState.lastPan.y;
    vttState.lastPan = { x: e.clientX, y: e.clientY };
    vttDraw();
  }
}

function vttOnMouseUp() {
  if (vttState.wallMode && vttState.drawingWall) {
    vttState.drawingWall.x2 = wx;
    vttState.drawingWall.y2 = wy;
    vttDraw();
  } else if (vttState.dragging) {
    const tok = vttState.dragging;
    api('PUT', '/vtt/tokens/' + tok.id, { x: tok.x, y: tok.y }).catch(() => {});
    vttBroadcast({ type: 'token_move', token_id: tok.id, x: tok.x, y: tok.y });
  }
  vttState.dragging = null;
  vttState.isPanning = false;
  vttState.lastPan = null;
  if (vttState.canvas) vttState.canvas.style.cursor = 'grab';
}

function vttOnWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  vttZoom(delta, e.clientX, e.clientY);
}

function vttOnDblClick(e) {
  const { canvas, tokens, scale, panX, panY } = vttState;
  const rect = canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left - panX) / scale;
  const wy = (e.clientY - rect.top - panY) / scale;
  const tok = tokens.find(t => wx >= t.x && wx <= t.x + t.width && wy >= t.y && wy <= t.y + t.width);
  if (tok) vttEditToken(tok);
}

function vttZoom(delta, cx, cy) {
  const canvas = vttState.canvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  cx = cx ?? rect.width / 2; cy = cy ?? rect.height / 2;
  const newScale = Math.max(0.2, Math.min(4, vttState.scale + delta));
  vttState.panX = cx - (cx - vttState.panX) * (newScale / vttState.scale);
  vttState.panY = cy - (cy - vttState.panY) * (newScale / vttState.scale);
  vttState.scale = newScale;
  vttDraw();
}

function vttResetView() { vttState.scale = 1; vttState.panX = 0; vttState.panY = 0; vttDraw(); }

async function vttJoinRoom(id, name) {
  vttState.room = { id, name, grid_size: 50 };
  vttState.tokens = await api('GET', '/vtt/rooms/' + id + '/tokens');
  vttState.walls = await api('GET', '/vtt/rooms/' + id + '/walls');
  // Charger la carte si elle existe
  const rooms = await api('GET', '/vtt/rooms');
  const room = rooms.find(r => r.id === id);
  if (room) vttState.room = room;
  if (room?.map_url) {
    vttLoadMap(room.map_url);
  } else {
    vttState.mapImg = null;
  }
  await vttLoadMapsList();
  document.getElementById('vtt-no-room').style.display = 'none';
  vttUpdateSidebar();
  vttUpdateInitiative();
  vttDraw();
  // Afficher/cacher onglet Fiches selon système
  const charsBtn = document.getElementById('tab-chars-btn');
  if (charsBtn) {
    const hasSystem = room && room.system && room.system !== '';
    charsBtn.style.display = hasSystem ? '' : 'none';
  }
  // Afficher le système actif
  vttShowRoomSystem(room);
  vttBroadcast({ type: 'join', room_id: id, user_id: state.user?.id, username: state.user?.username });
}

function vttShowRoomSystem(room) {
  const el = document.getElementById('vtt-rooms-list');
  if (!el) return;
  const systemNames = { savage_worlds: 'Savage Worlds', dnd5e: 'D&D 5e', '': 'Aucun système' };
  // Mettre à jour le select si la salle active a un système
  if (room && room.system !== undefined) {
    const sel = document.getElementById('room-system-sel');
    if (sel) sel.value = room.system || '';
  }
}

async function vttSetRoomSystem(system) {
  if (!vttState.room) return;
  await api('PUT', '/vtt/rooms/' + vttState.room.id, { system });
  vttState.room.system = system;
  const charsBtn = document.getElementById('tab-chars-btn');
  if (charsBtn) charsBtn.style.display = system ? '' : 'none';
  toast('Système mis à jour : ' + (system || 'aucun'), 'success');
}

async function vttCreateRoom() {
  const name = document.getElementById('new-room-name').value.trim();
  if (!name) return;
  const system = document.getElementById('new-room-system')?.value || null;
  const data = await api('POST', '/vtt/rooms', { name, system });
  document.getElementById('new-room-name').value = '';
  const btn = document.createElement('div');
  btn.className = 'btn btn-ghost btn-sm';
  btn.style.cssText = 'text-align:left;cursor:pointer';
  btn.textContent = name;
  btn.onclick = () => vttJoinRoom(data.id, name);
  document.getElementById('vtt-rooms-list').appendChild(btn);
  vttJoinRoom(data.id, name);
}

function vttAddTokenModal() {
  if (!vttState.room) { toast('Rejoins une salle d\'abord', 'error'); return; }
  document.getElementById('vtt-token-modal').style.display = 'flex';
}

async function vttAddToken() {
  const name = document.getElementById('tok-name').value.trim();
  const hp = parseInt(document.getElementById('tok-hp').value) || null;
  const hp_max = parseInt(document.getElementById('tok-hpmax').value) || null;
  const initiative = parseInt(document.getElementById('tok-init').value) || 0;
  const color = document.getElementById('tok-color').value;
  if (!name) return;
  const gs = vttState.room.grid_size || 50;
  const data = await api('POST', '/vtt/rooms/' + vttState.room.id + '/tokens', { name, x: gs, y: gs, color, hp, hp_max, initiative, width: gs, height: gs });
  const tok = { id: data.id, name, x: gs, y: gs, color, hp, hp_max, initiative, width: gs, height: gs, is_visible: 1 };
  vttState.tokens.push(tok);
  document.getElementById('vtt-token-modal').style.display = 'none';
  vttUpdateSidebar();
  vttUpdateInitiative();
  vttDraw();
  vttBroadcast({ type: 'token_add', token: tok });
}

function vttEditToken(tok) {
  const newHp = prompt('PV de ' + tok.name + ' (' + (tok.hp_max || '?') + ' max):', tok.hp || 0);
  if (newHp === null) return;
  tok.hp = parseInt(newHp) || 0;
  api('PUT', '/vtt/tokens/' + tok.id, { hp: tok.hp }).catch(() => {});
  vttBroadcast({ type: 'token_hp', token_id: tok.id, hp: tok.hp });
  vttUpdateSidebar();
  vttDraw();
}

function vttUpdateSidebar() {
  const el = document.getElementById('vtt-tokens-sidebar');
  if (!el) return;
  el.innerHTML = vttState.tokens.map(t => `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:var(--bg);border-radius:4px">
      <div style="width:12px;height:12px;border-radius:50%;background:${t.color};flex-shrink:0"></div>
      <div style="flex:1;font-size:13px;color:var(--ink)">${t.name}</div>
      ${t.hp !== null ? `<div style="font-size:12px;color:${t.hp/t.hp_max > 0.5 ? 'var(--green)' : 'var(--red)'}">${t.hp}/${t.hp_max}</div>` : ''}
      <button onclick="vttDeleteToken(${t.id})" style="background:none;border:none;color:var(--ink3);cursor:pointer;font-size:12px">🗑️</button>
    </div>`).join('');
}

function vttUpdateInitiative() {
  const sorted = [...vttState.tokens].filter(t => t.initiative).sort((a, b) => b.initiative - a.initiative);
  vttState.combatOrder = sorted;
  const el = document.getElementById('vtt-initiative');
  if (!el) return;
  if (!sorted.length) { el.innerHTML = 'Aucun combat'; return; }
  el.innerHTML = sorted.map((t, i) => `<div style="padding:2px 0;color:${i === vttState.currentTurn ? 'var(--gold)' : 'var(--ink3)'};font-size:13px">${i === vttState.currentTurn ? '▶ ' : ''}${t.name} (${t.initiative})</div>`).join('');
}

function vttNextTurn() {
  if (!vttState.combatOrder.length) return;
  vttState.currentTurn = (vttState.currentTurn + 1) % vttState.combatOrder.length;
  vttUpdateInitiative();
  vttBroadcast({ type: 'next_turn', turn: vttState.currentTurn });
  const current = vttState.combatOrder[vttState.currentTurn];
  vttChatMsg('système', `⚔️ Tour de ${current.name}`);
}

function vttRollInit() {
  vttState.tokens.forEach(tok => {
    const roll = Math.floor(Math.random() * 20) + 1;
    tok.initiative = roll;
    api('PUT', '/vtt/tokens/' + tok.id, { initiative: roll }).catch(() => {});
  });
  vttState.currentTurn = 0;
  vttUpdateInitiative();
  vttChatMsg('système', '🎲 Initiatives lancées !');
}

async function vttDeleteToken(id) {
  await api('DELETE', '/vtt/tokens/' + id);
  vttState.tokens = vttState.tokens.filter(t => t.id !== id);
  vttUpdateSidebar();
  vttUpdateInitiative();
  vttDraw();
  vttBroadcast({ type: 'token_delete', token_id: id });
}

function vttRollDice(sides) {
  const result = Math.floor(Math.random() * sides) + 1;
  document.getElementById('dice-result').textContent = `d${sides}: ${result}`;
  vttChatMsg(state.user?.username || 'Anonyme', `🎲 d${sides} → **${result}**`);
  vttBroadcast({ type: 'dice_roll', sides, result, username: state.user?.username });
}

function vttRollCustom() {
  const expr = document.getElementById('dice-expr').value.trim();
  if (!expr) return;
  try {
    const m = expr.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!m) { toast('Format invalide (ex: 2d6+3)', 'error'); return; }
    const count = parseInt(m[1]), sides = parseInt(m[2]), mod = parseInt(m[3] || 0);
    let total = mod, rolls = [];
    for (let i = 0; i < count; i++) { const r = Math.floor(Math.random() * sides) + 1; rolls.push(r); total += r; }
    const detail = rolls.join('+') + (mod ? (mod > 0 ? '+' : '') + mod : '');
    document.getElementById('dice-result').textContent = `${expr}: ${total}`;
    vttChatMsg(state.user?.username || 'Anonyme', `🎲 ${expr} → **${total}** (${detail})`);
    vttBroadcast({ type: 'dice_roll', expr, result: total, detail, username: state.user?.username });
  } catch(e) { toast('Erreur de calcul', 'error'); }
}

async function vttUploadMap(input) {
  if (!vttState.room || !input.files[0]) return;
  const formData = new FormData();
  formData.append('map', input.files[0]);
  const r = await fetch('/api/vtt/rooms/' + vttState.room.id + '/maps', { method: 'POST', body: formData, credentials: 'include' });
  const data = await r.json();
  vttLoadMap(data.url);
  vttBroadcast({ type: 'map_change', map_url: data.url });
  await vttLoadMapsList();
  toast('Carte ajoutee !', 'success');
}

function vttLoadMap(url) {
  const img = new Image();
  img.onload = () => { vttState.mapImg = img; vttDraw(); };
  img.src = url;
  vttState.currentMapUrl = url;
}

async function vttLoadMapsList() {
  if (!vttState.room) return;
  const maps = await api('GET', '/vtt/rooms/' + vttState.room.id + '/maps');
  const el = document.getElementById('vtt-maps-list');
  if (!el) return;
  el.innerHTML = maps.map(m => {
    const name = m.filename.replace(/^\d+_/, '').replace(/^\d+\./, '');
    const isActive = vttState.currentMapUrl && vttState.currentMapUrl.includes(m.filename);
    return '<div style="display:flex;align-items:center;gap:4px">' +
      '<button class="btn btn-sm btn-ghost" style="flex:1;text-align:left;font-size:11px;' + (isActive ? 'background:var(--gold);color:var(--bg)' : '') + '" onclick="vttSwitchMap(' + m.id + ',this)">' + name + '</button>' +
      '<button onclick="vttDeleteMap(' + m.id + ')" style="background:none;border:none;color:var(--ink3);cursor:pointer;font-size:11px">x</button>' +
      '</div>';
  }).join('');
}

async function vttSwitchMap(mapId, btn) {
  const data = await api('PUT', '/vtt/rooms/' + vttState.room.id + '/maps/' + mapId);
  vttLoadMap(data.url);
  vttBroadcast({ type: 'map_change', map_url: data.url });
  await vttLoadMapsList();
}

async function vttDeleteMap(mapId) {
  if (!confirm('Supprimer cette carte ?')) return;
  await api('DELETE', '/vtt/maps/' + mapId);
  await vttLoadMapsList();
}

function vttSendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  vttChatMsg(state.user?.username || 'Anonyme', msg);
  vttBroadcast({ type: 'chat', message: msg, username: state.user?.username });
}

function vttChatMsg(username, message) {
  const chat = document.getElementById('vtt-chat');
  if (!chat) return;
  const isSystem = username === 'système';
  const div = document.createElement('div');
  div.style.cssText = `font-size:13px;padding:3px 0;${isSystem ? 'color:var(--gold);font-style:italic' : ''}`;
  div.innerHTML = isSystem ? message : `<span style="color:var(--gold);font-weight:600">${username}</span>: ${message}`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function vttConnectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  vttState.ws = new WebSocket(proto + '//' + location.host);
  vttState.ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'token_move') {
      const tok = vttState.tokens.find(t => t.id === msg.token_id);
      if (tok) { tok.x = msg.x; tok.y = msg.y; vttDraw(); }
    } else if (msg.type === 'token_add') {
      vttState.tokens.push(msg.token); vttUpdateSidebar(); vttUpdateInitiative(); vttDraw();
    } else if (msg.type === 'token_delete') {
      vttState.tokens = vttState.tokens.filter(t => t.id !== msg.token_id); vttUpdateSidebar(); vttDraw();
    } else if (msg.type === 'token_hp') {
      const tok = vttState.tokens.find(t => t.id === msg.token_id);
      if (tok) { tok.hp = msg.hp; vttUpdateSidebar(); vttDraw(); }
    } else if (msg.type === 'chat' || msg.type === 'dice_roll') {
      const text = msg.type === 'dice_roll' ? (msg.expr || 'd' + msg.sides) + ' → **' + msg.result + '**' : msg.message;
      vttChatMsg(msg.username || 'Anonyme', text);
    } else if (msg.type === 'next_turn') {
      vttState.currentTurn = msg.turn; vttUpdateInitiative();
    } else if (msg.type === 'map_change') {
      const img = new Image(); img.onload = () => { vttState.mapImg = img; vttDraw(); }; img.src = msg.map_url;
    } else if (msg.type === 'fog_toggle') {
      vttState.fogEnabled = msg.enabled; vttDraw();
    } else if (msg.type === 'wall_add') {
      vttState.walls.push(msg.wall); vttDraw();
    } else if (msg.type === 'walls_clear') {
      vttState.walls = []; vttDraw();
    } else if (msg.type === 'user_joined') {
      vttChatMsg('système', msg.username + ' a rejoint la salle');
    } else if (msg.type === 'user_left') {
      vttChatMsg('système', msg.username + ' a quitté la salle');
    }
  };
  vttState.ws.onopen = () => {
    if (vttState.room) vttState.ws.send(JSON.stringify({ type: 'join', room_id: vttState.room.id, user_id: state.user?.id, username: state.user?.username }));
  };
  vttState.ws.onclose = () => setTimeout(vttConnectWS, 3000);
}

function vttToggleFog() {
  vttState.fogEnabled = !vttState.fogEnabled;
  const btn = document.getElementById('fog-btn');
  if (btn) {
    btn.style.background = vttState.fogEnabled ? 'var(--gold)' : '';
    btn.style.color = vttState.fogEnabled ? 'var(--bg)' : '';
    btn.textContent = vttState.fogEnabled ? 'Desactiver' : 'Activer';
  }
  vttDraw();
  vttBroadcast({ type: 'fog_toggle', enabled: vttState.fogEnabled });
}

function vttToggleWallMode() {
  vttState.wallMode = !vttState.wallMode;
  const btn = document.getElementById('wall-mode-btn');
  if (btn) { btn.style.background = vttState.wallMode ? 'var(--gold)' : ''; btn.style.color = vttState.wallMode ? 'var(--bg)' : ''; }
  if (vttState.canvas) vttState.canvas.style.cursor = vttState.wallMode ? 'crosshair' : 'grab';
}

async function vttClearWalls() {
  if (!vttState.room) return;
  if (!confirm('Effacer tous les murs ?')) return;
  await api('DELETE', '/vtt/rooms/' + vttState.room.id + '/walls');
  vttState.walls = [];
  vttBroadcast({ type: 'walls_clear' });
  vttDraw();
}

function vttBroadcast(msg) {
  if (!vttState.ws) return;
  if (vttState.ws.readyState === 1) {
    vttState.ws.send(JSON.stringify(msg));
  } else if (vttState.ws.readyState === 0) {
    vttState.ws.addEventListener('open', () => vttState.ws.send(JSON.stringify(msg)), { once: true });
  }
}

// ═══════════════════════════════════════
// BROUILLARD DE GUERRE — Ray Casting
// ═══════════════════════════════════════

function vttSegmentIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const a1 = by - ay, b1 = ax - bx, c1 = a1*ax + b1*ay;
  const a2 = dy - cy, b2 = cx - dx, c2 = a2*cx + b2*cy;
  const det = a1*b2 - a2*b1;
  if (Math.abs(det) < 1e-10) return null;
  const x = (b2*c1 - b1*c2) / det;
  const y = (a1*c2 - a2*c1) / det;
  const t = ((x-ax)*(bx-ax) + (y-ay)*(by-ay)) / ((bx-ax)**2 + (by-ay)**2);
  const u = ((x-cx)*(dx-cx) + (y-cy)*(dy-cy)) / ((dx-cx)**2 + (dy-cy)**2);
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { x, y, t };
  return null;
}

function vttCastRay(ox, oy, angle, walls, maxDist) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let minT = maxDist;
  let hit = { x: ox + dx * maxDist, y: oy + dy * maxDist };
  for (const w of walls) {
    const res = vttSegmentIntersect(ox, oy, ox + dx * maxDist, oy + dy * maxDist, w.x1, w.y1, w.x2, w.y2);
    if (res && res.t < minT) { minT = res.t; hit = res; }
  }
  return hit;
}

function vttComputeVisibility(ox, oy, walls, maxDist = 600) {
  const angles = [];
  // Angles vers les extrémités des murs
  for (const w of walls) {
    for (const [px, py] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - 0.001, a, a + 0.001);
    }
  }
  // Angles de base (360°)
  for (let i = 0; i < 36; i++) angles.push((i / 36) * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const points = angles.map(a => vttCastRay(ox, oy, a, walls, maxDist));
  return points;
}

function vttDrawFog() {
  const { canvas, ctx, tokens, walls, scale, panX, panY } = vttState;
  if (!canvas || !ctx) return;
  if (!vttState.fogEnabled) return;

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(scale, scale);

  const w = canvas.width / scale, h = canvas.height / scale;

  // Créer un canvas offscreen pour le fog
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = canvas.width / scale;
  fogCanvas.height = canvas.height / scale;
  const fogCtx = fogCanvas.getContext('2d');

  // Remplir de noir (brouillard total)
  fogCtx.fillStyle = 'rgba(0,0,0,0.85)';
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);

  // Pour chaque jeton joueur visible, calculer la zone de vision
  const isGM = state.user?.is_admin;
  if (!isGM) {
    const playerTokens = tokens.filter(t => t.is_visible && t.name === state.user?.username);
    for (const tok of playerTokens) {
      const cx = tok.x + (tok.width || 50) / 2;
      const cy = tok.y + (tok.width || 50) / 2;
      const pts = vttComputeVisibility(cx, cy, walls, vttState.visionRadius || 400);
      if (!pts.length) continue;
      fogCtx.save();
      fogCtx.globalCompositeOperation = 'destination-out';
      fogCtx.beginPath();
      fogCtx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) fogCtx.lineTo(pts[i].x, pts[i].y);
      fogCtx.closePath();
      fogCtx.fill();
      fogCtx.restore();
    }
  }

  // Dessiner le fog sur le canvas principal
  if (!isGM) ctx.drawImage(fogCanvas, 0, 0);

  ctx.restore();
}


function vttCloseTokenModal() {
  document.getElementById('vtt-token-modal').style.display = 'none';
}

// ═══════════════════════════════════════
// SAVAGE WORLDS
// ═══════════════════════════════════════

function swRollExploding(sides) {
  let total = 0, roll;
  do {
    roll = Math.floor(Math.random() * sides) + 1;
    total += roll;
  } while (roll === sides);
  return total;
}

function swRollTrait(sides, modifier = 0) {
  const traitRoll = swRollExploding(sides);
  const wildRoll = swRollExploding(6);
  const best = Math.max(traitRoll, wildRoll);
  const total = best + modifier;
  const raises = Math.max(0, Math.floor((total - 4) / 4));
  return { traitRoll, wildRoll, best, total, modifier, raises, success: total >= 4 };
}

function swRollDamage(expr, modifier = 0) {
  const m = expr.match(/^(\d+)d(\d+)$/i);
  if (!m) return null;
  const count = parseInt(m[1]), sides = parseInt(m[2]);
  let total = modifier;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const r = swRollExploding(sides);
    rolls.push(r);
    total += r;
  }
  return { rolls, total, modifier };
}

// Deck de cartes d'initiative
const SW_SUITS = ['♠', '♥', '♦', '♣'];
const SW_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SW_SUIT_NAMES = { '♠': 'Pique', '♥': 'Coeur', '♦': 'Carreau', '♣': 'Trefle' };

let swDeck = [];
let swDealt = {};

function swInitDeck() {
  swDeck = [];
  for (const suit of SW_SUITS) {
    for (const val of SW_VALUES) {
      swDeck.push({ suit, val, label: val + suit });
    }
  }
  // Jokers
  swDeck.push({ suit: '🃏', val: 'JR', label: 'Joker Rouge', isJoker: true });
  swDeck.push({ suit: '🃏', val: 'JN', label: 'Joker Noir', isJoker: true });
  swShuffleDeck();
  swDealt = {};
}

function swShuffleDeck() {
  for (let i = swDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [swDeck[i], swDeck[j]] = [swDeck[j], swDeck[i]];
  }
}

function swDealCard(tokenName) {
  if (!swDeck.length) swInitDeck();
  const card = swDeck.pop();
  swDealt[tokenName] = card;
  return card;
}

function swGetInitiativeOrder() {
  const SW_ORDER = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2, 'JR': 15, 'JN': 15 };
  return Object.entries(swDealt)
    .sort((a, b) => (SW_ORDER[b[1].val] || 0) - (SW_ORDER[a[1].val] || 0))
    .map(([name, card]) => ({ name, card }));
}

// Interface SW dans le VTT
function swRenderPanel() {
  const el = document.getElementById('sw-panel');
  if (!el) return;

  const order = swGetInitiativeOrder();
  const bennies = vttState.swBennies || {};

  el.innerHTML =
    '<div style="padding:12px;border-bottom:1px solid var(--border)">' +
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Savage Worlds</div>' +
      // Lancer de trait
      '<div style="font-size:12px;color:var(--ink3);margin-bottom:4px">Lancer un trait :</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">' +
        [4,6,8,10,12].map(d =>
          '<button class="btn btn-sm btn-ghost" onclick="swDoTrait(' + d + ')">d' + d + '+Wd6</button>'
        ).join('') +
      '</div>' +
      '<div id="sw-trait-result" style="font-size:13px;color:var(--gold);min-height:20px;margin-bottom:8px"></div>' +
      // Dégâts
      '<div style="font-size:12px;color:var(--ink3);margin-bottom:4px">Degats :</div>' +
      '<div style="display:flex;gap:4px;margin-bottom:8px">' +
        '<input id="sw-dmg-expr" class="input-sm" placeholder="2d6" style="flex:1">' +
        '<input id="sw-dmg-mod" class="input-sm" placeholder="+0" style="width:40px">' +
        '<button class="btn btn-sm btn-ghost" onclick="swDoDamage()">Roll</button>' +
      '</div>' +
      '<div id="sw-dmg-result" style="font-size:13px;color:var(--gold);min-height:20px;margin-bottom:8px"></div>' +
    '</div>' +
    // Initiative
    '<div style="padding:12px;border-bottom:1px solid var(--border)">' +
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Initiative</div>' +
      '<div style="display:flex;gap:4px;margin-bottom:8px">' +
        '<button class="btn btn-sm btn-ghost" onclick="swDealAll()">Distribuer</button>' +
        '<button class="btn btn-sm btn-ghost" onclick="swNewRound()">Nouveau tour</button>' +
      '</div>' +
      (order.length ?
        order.map(o =>
          '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px">' +
            '<span style="font-size:16px">' + o.card.label + '</span>' +
            '<span style="color:var(--ink)">' + o.name + '</span>' +
            (o.card.isJoker ? '<span style="color:var(--gold);font-size:11px">JOKER!</span>' : '') +
          '</div>'
        ).join('') :
        '<div style="color:var(--ink3);font-size:12px">Pas encore distribue</div>'
      ) +
    '</div>' +
    // Bennies
    '<div style="padding:12px">' +
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Bennies</div>' +
      (vttState.tokens.length ?
        vttState.tokens.map(t =>
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
            '<span style="font-size:12px;color:var(--ink);flex:1">' + t.name + '</span>' +
            '<button onclick="swChangeBennie(' + t.id + ',-1)" style="background:none;border:1px solid var(--border);color:var(--ink3);width:20px;height:20px;cursor:pointer;border-radius:3px">-</button>' +
            '<span style="font-size:13px;color:var(--gold);min-width:20px;text-align:center">' + (bennies[t.id] || 0) + '</span>' +
            '<button onclick="swChangeBennie(' + t.id + ',1)" style="background:none;border:1px solid var(--border);color:var(--ink3);width:20px;height:20px;cursor:pointer;border-radius:3px">+</button>' +
          '</div>'
        ).join('') :
        '<div style="color:var(--ink3);font-size:12px">Pas de jetons</div>'
      ) +
    '</div>';
}

function swDoTrait(sides) {
  const result = swRollTrait(sides);
  const el = document.getElementById('sw-trait-result');
  if (!el) return;
  const txt = 'd' + sides + '=' + result.traitRoll + ' Wd6=' + result.wildRoll + ' → ' + result.total +
    (result.success ? (result.raises > 0 ? ' ✅ +' + result.raises + ' relance(s)' : ' ✅ Succès') : ' ❌ Echec');
  el.textContent = txt;
  vttChatMsg(state.user?.username || 'MJ', '🎲 Trait d' + sides + ': ' + txt);
  vttBroadcast({ type: 'chat', message: '🎲 Trait d' + sides + ': ' + txt, username: state.user?.username });
}

function swDoDamage() {
  const expr = document.getElementById('sw-dmg-expr')?.value || '2d6';
  const mod = parseInt(document.getElementById('sw-dmg-mod')?.value) || 0;
  const result = swRollDamage(expr, mod);
  if (!result) { toast('Format invalide (ex: 2d6)', 'error'); return; }
  const el = document.getElementById('sw-dmg-result');
  if (!el) return;
  const wounds = result.total >= 12 ? 3 : result.total >= 8 ? 2 : result.total >= 4 ? 1 : 0;
  const txt = expr + (mod ? '+' + mod : '') + ' = ' + result.total + ' [' + result.rolls.join('+') + ']' +
    (wounds > 0 ? ' → ' + wounds + ' blessure(s)' : ' → Secoué');
  el.textContent = txt;
  vttChatMsg(state.user?.username || 'MJ', '⚔️ Dégâts: ' + txt);
  vttBroadcast({ type: 'chat', message: '⚔️ Degats: ' + txt, username: state.user?.username });
}

function swDealAll() {
  if (!swDeck.length) swInitDeck();
  vttState.tokens.forEach(t => {
    const card = swDealCard(t.name);
    vttChatMsg('initiative', t.name + ' → ' + card.label);
  });
  swRenderPanel();
  vttBroadcast({ type: 'sw_initiative', dealt: swDealt });
}

function swNewRound() {
  swDealt = {};
  if (swDeck.length < 10) swInitDeck();
  swRenderPanel();
  vttChatMsg('initiative', 'Nouveau tour — cartes redistribuées');
}

function swChangeBennie(tokenId, delta) {
  if (!vttState.swBennies) vttState.swBennies = {};
  vttState.swBennies[tokenId] = Math.max(0, (vttState.swBennies[tokenId] || 0) + delta);
  swRenderPanel();
  vttBroadcast({ type: 'sw_bennies', bennies: vttState.swBennies });
}

// Init SW
swInitDeck();

async function swRenderCharTab() {
  const el = document.getElementById('sw-panel');
  if (!el) return;
  // Charger les membres de la campagne si une salle est active
  let memberOptions = '<option value="">-- Joueur --</option>';
  if (vttState.room?.campaign_id) {
    try {
      const members = await api('GET', '/invitations/campaign/' + vttState.room.campaign_id + '/members');
      memberOptions += members.map(m => '<option value="' + m.id + '">' + m.username + '</option>').join('');
    } catch(e) {}
  }
  // Ajouter aussi tous les utilisateurs si admin
  if (state.user?.is_admin) {
    try {
      const adminData = await api('GET', '/admin/dashboard');
      memberOptions = '<option value="">-- Joueur --</option>' + adminData.users.map(u => '<option value="' + u.id + '">' + u.username + '</option>').join('');
    } catch(e) {}
  }

  el.innerHTML =
    '<div style="padding:12px">' +
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Fiches ' + (vttState.room?.system === 'savage_worlds' ? 'Savage Worlds' : 'Personnages') + '</div>' +
      '<div style="display:flex;gap:4px;margin-bottom:4px">' +
        '<input class="input-sm" id="sw-new-name" placeholder="Nom du perso" style="flex:1">' +
        '<button class="btn btn-sm" style="background:var(--gold);color:var(--bg)" onclick="swCreateChar()">+</button>' +
      '</div>' +
      '<select id="sw-new-player" class="input-sm" style="width:100%;margin-bottom:8px">' + memberOptions + '</select>' +
      '<div id="sw-chars-list"></div>' +
    '</div>' +
    '<div id="sw-sheet-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:2000;align-items:center;justify-content:center;overflow-y:auto"></div>';
  swLoadCharacters();
}

function swSwitchTab(tab) {
  const dice = document.getElementById('tab-dice');
  const sw = document.getElementById('tab-sw');
  const diceBtn = document.getElementById('tab-dice-btn');
  const swBtn = document.getElementById('tab-sw-btn');
  const charsBtn = document.getElementById('tab-chars-btn');
  [dice, sw].forEach(el => { if (el) el.style.display = 'none'; });
  [diceBtn, swBtn, charsBtn].forEach(btn => { if (btn) { btn.style.background = ''; btn.style.color = ''; }});
  if (tab === 'dice') {
    if (dice) dice.style.display = '';
    if (diceBtn) { diceBtn.style.background = 'var(--gold)'; diceBtn.style.color = 'var(--bg)'; }
  } else if (tab === 'sw') {
    if (sw) sw.style.display = '';
    if (swBtn) { swBtn.style.background = 'var(--gold)'; swBtn.style.color = 'var(--bg)'; }
    swRenderPanel();
  } else if (tab === 'chars') {
    if (sw) sw.style.display = '';
    if (charsBtn) { charsBtn.style.background = 'var(--gold)'; charsBtn.style.color = 'var(--bg)'; }
    swRenderCharTab();
  }
}

// ═══════════════════════════════════════
// FICHE PERSONNAGE SAVAGE WORLDS
// ═══════════════════════════════════════

let swCurrentChar = null;

async function swOpenSheet(charId) {
  const chars = await api('GET', '/sw/characters');
  const char = chars.find(c => c.id === charId) || chars[0];
  if (!char) return;
  swCurrentChar = char;
  swRenderSheet(char);
}

async function swLoadCharacters() {
  const chars = await api('GET', '/sw/characters');
  const el = document.getElementById('sw-chars-list');
  if (!el) return;
  const isAdmin = state.user?.is_admin;
  el.innerHTML = chars.length ? chars.map(ch => {
    const canEdit = isAdmin || ch.assigned_user_id === state.user?.id || ch.user_id === state.user?.id;
    return '<div style="display:flex;align-items:center;gap:6px;padding:6px;background:var(--bg);border-radius:4px;margin-bottom:4px">' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;color:var(--ink);font-size:13px">' + ch.name + '</div>' +
        '<div style="font-size:11px;color:var(--ink3)">' + ch.race + ' — ' + ch.rank + (ch.assigned_username ? ' · ' + ch.assigned_username : '') + '</div>' +
      '</div>' +
      (canEdit ? '<button class="btn btn-sm btn-ghost" onclick="swRenderSheet(' + JSON.stringify(ch).replace(/"/g, '&quot;') + ')">📋</button>' : '<span style="font-size:11px;color:var(--ink3);padding:4px">🔒</span>') +
      (isAdmin ? '<button onclick="swDeleteChar(' + ch.id + ')" style="background:none;border:none;color:var(--ink3);cursor:pointer">🗑️</button>' : '') +
    '</div>';
  }).join('') : '<div style="color:var(--ink3);font-size:13px">Aucun personnage</div>';
}

function swRenderSheet(char) {
  swCurrentChar = char;
  const modal = document.getElementById('sw-sheet-modal');
  if (!modal) return;

  const dieVal = v => ['d4','d6','d8','d10','d12'][Math.max(0,Math.floor((v-4)/2))];
  const dieOpts = [4,6,8,10,12].map(d =>
    '<option value="' + d + '">d' + d + '</option>'
  ).join('');

  modal.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:800px;max-height:90vh;overflow-y:auto;padding:24px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
        '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:18px">' + char.name + '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-sm" style="background:var(--gold);color:var(--bg)" onclick="swSaveSheet()">💾 Sauvegarder</button>' +
          '<button class="btn btn-sm btn-ghost" onclick="swCloseSheet()">✕</button>' +
        '</div>' +
      '</div>' +
      // Infos générales
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">' +
        '<div><label style="font-size:11px;color:var(--ink3)">Nom</label><input class="input-sm" id="sw-name" value="' + char.name + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;color:var(--ink3)">Race</label><input class="input-sm" id="sw-race" value="' + (char.race||'') + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;color:var(--ink3)">Rang</label><select class="input-sm" id="sw-rank" style="width:100%">' +
          ['Novice','Recrue','Veteran','Heroique','Legendaire'].map(r => '<option value="' + r + '"' + (char.rank===r?' selected':'') + '>' + r + '</option>').join('') +
        '</select></div>' +
        '<div><label style="font-size:11px;color:var(--ink3)">XP</label><input class="input-sm" id="sw-xp" type="number" value="' + (char.xp||0) + '" style="width:100%"></div>' +
      '</div>' +
      // Caractéristiques
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Caractéristiques</div>' +
      '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">' +
        [['agilite','Agilité'],['astuce','Astuce'],['esprit','Esprit'],['force','Force'],['vigueur','Vigueur']].map(([key, label]) =>
          '<div style="text-align:center;background:var(--bg);border-radius:6px;padding:8px">' +
            '<div style="font-size:11px;color:var(--ink3);margin-bottom:4px">' + label + '</div>' +
            '<select class="input-sm" id="sw-' + key + '" style="width:100%">' +
              [4,6,8,10,12].map(d => '<option value="' + d + '"' + (char[key]===d?' selected':'') + '>d' + d + '</option>').join('') +
            '</select>' +
          '</div>'
        ).join('') +
      '</div>' +
      // Stats dérivées
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Stats dérivées</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">' +
        [['charisme','Charisme',char.charisme||0],['celerite','Célérité',char.celerite||6],['parade','Parade',char.parade||2],['robustesse','Robustesse',char.robustesse||4]].map(([key,label,val]) =>
          '<div><label style="font-size:11px;color:var(--ink3)">' + label + '</label><input class="input-sm" id="sw-' + key + '" type="number" value="' + val + '" style="width:100%"></div>'
        ).join('') +
      '</div>' +
      // État
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">État</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">' +
        '<div><label style="font-size:11px;color:var(--ink3)">Blessures (max ' + (char.wounds_max||3) + ')</label>' +
          '<div style="display:flex;gap:4px;margin-top:4px">' +
            [0,1,2,3].map(i => '<button onclick="swSetWounds(' + i + ')" style="width:28px;height:28px;border-radius:50%;border:2px solid var(--border);cursor:pointer;background:' + (char.blessures>=i+1?'var(--red)':'var(--bg)') + '" id="sw-wound-' + i + '"></button>').join('') +
          '</div>' +
        '</div>' +
        '<div><label style="font-size:11px;color:var(--ink3)">Fatigue</label>' +
          '<div style="display:flex;gap:4px;margin-top:4px">' +
            [0,1,2].map(i => '<button onclick="swSetFatigue(' + i + ')" style="width:28px;height:28px;border-radius:50%;border:2px solid var(--border);cursor:pointer;background:' + (char.fatigue>=i+1?'var(--gold)':'var(--bg)') + '" id="sw-fatigue-' + i + '"></button>').join('') +
          '</div>' +
        '</div>' +
        '<div><label style="font-size:11px;color:var(--ink3)">Bennies</label>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
            '<button onclick="swChangeBennieDirect(-1)" style="background:none;border:1px solid var(--border);color:var(--ink3);width:24px;height:24px;cursor:pointer;border-radius:3px">-</button>' +
            '<span id="sw-bennies-val" style="font-size:18px;color:var(--gold);font-weight:700">' + (char.bennies||3) + '</span>' +
            '<button onclick="swChangeBennieDirect(1)" style="background:none;border:1px solid var(--border);color:var(--ink3);width:24px;height:24px;cursor:pointer;border-radius:3px">+</button>' +
            '<span style="font-size:11px;color:var(--ink3)">/ ' + (char.bennies_max||3) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // Compétences
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Compétences</div>' +
      '<div id="sw-skills-list" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">' +
        (char.skills||[]).map((s,i) =>
          '<div style="display:flex;gap:4px;align-items:center">' +
            '<input class="input-sm" value="' + s.name + '" id="sw-skill-name-' + i + '" placeholder="Compétence" style="flex:1">' +
            '<select class="input-sm" id="sw-skill-die-' + i + '">' +
              [4,6,8,10,12].map(d => '<option value="' + d + '"' + (s.die===d?' selected':'') + '>d' + d + '</option>').join('') +
            '</select>' +
            '<input class="input-sm" value="' + (s.linked||'') + '" id="sw-skill-linked-' + i + '" placeholder="Attr." style="width:60px">' +
            '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">✕</button>' +
          '</div>'
        ).join('') +
      '</div>' +
      '<button class="btn btn-sm btn-ghost" onclick="swAddSkillRow()">+ Compétence</button>' +
      // Atouts & Handicaps
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;margin-bottom:16px">' +
        '<div>' +
          '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Atouts</div>' +
          '<div id="sw-edges-list">' +
            (char.edges||[]).map((e,i) =>
              '<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">' +
                '<input class="input-sm" value="' + e + '" id="sw-edge-' + i + '" style="flex:1">' +
                '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">✕</button>' +
              '</div>'
            ).join('') +
          '</div>' +
          '<button class="btn btn-sm btn-ghost" style="margin-top:4px" onclick="swAddEdgeRow()">+ Atout</button>' +
        '</div>' +
        '<div>' +
          '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Handicaps</div>' +
          '<div id="sw-hindrances-list">' +
            (char.hindrances||[]).map((h,i) =>
              '<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">' +
                '<input class="input-sm" value="' + (typeof h === 'string' ? h : h.name||'') + '" id="sw-hindrance-' + i + '" style="flex:1">' +
                '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">✕</button>' +
              '</div>'
            ).join('') +
          '</div>' +
          '<button class="btn btn-sm btn-ghost" style="margin-top:4px" onclick="swAddHindranceRow()">+ Handicap</button>' +
        '</div>' +
      '</div>' +
      // Équipement
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-bottom:8px">Équipement</div>' +
      '<div id="sw-gear-list" style="margin-bottom:8px">' +
        (char.gear||[]).map((g,i) =>
          '<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">' +
            '<input class="input-sm" value="' + (typeof g === 'string' ? g : g.name||'') + '" id="sw-gear-' + i + '" style="flex:1">' +
            '<input class="input-sm" value="' + (g.notes||'') + '" id="sw-gear-notes-' + i + '" placeholder="Notes" style="width:120px">' +
            '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">✕</button>' +
          '</div>'
        ).join('') +
      '</div>' +
      '<button class="btn btn-sm btn-ghost" onclick="swAddGearRow()">+ Équipement</button>' +
      // Notes
      '<div style="font-family:Cinzel,serif;color:var(--gold);font-size:13px;margin-top:16px;margin-bottom:8px">Notes</div>' +
      '<textarea id="sw-notes" style="width:100%;height:80px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--ink);font-size:13px">' + (char.notes||'') + '</textarea>' +
    '</div>';

  modal.style.display = 'flex';
}

function swAddSkillRow() {
  const list = document.getElementById('sw-skills-list');
  const i = list.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:4px;align-items:center';
  div.innerHTML =
    '<input class="input-sm" id="sw-skill-name-' + i + '" placeholder="Competence" style="flex:1">' +
    '<select class="input-sm" id="sw-skill-die-' + i + '">' +
      [4,6,8,10,12].map(d => '<option value="' + d + '">d' + d + '</option>').join('') +
    '</select>' +
    '<input class="input-sm" id="sw-skill-linked-' + i + '" placeholder="Attr." style="width:60px">' +
    '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">x</button>';
  list.appendChild(div);
}

function swAddEdgeRow() {
  const list = document.getElementById('sw-edges-list');
  const i = list.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px';
  div.innerHTML = '<input class="input-sm" id="sw-edge-' + i + '" style="flex:1" placeholder="Atout"><button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">x</button>';
  list.appendChild(div);
}

function swAddHindranceRow() {
  const list = document.getElementById('sw-hindrances-list');
  const i = list.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px';
  div.innerHTML = '<input class="input-sm" id="sw-hindrance-' + i + '" style="flex:1" placeholder="Handicap"><button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">x</button>';
  list.appendChild(div);
}

function swAddGearRow() {
  const list = document.getElementById('sw-gear-list');
  const i = list.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px';
  div.innerHTML =
    '<input class="input-sm" id="sw-gear-' + i + '" style="flex:1" placeholder="Objet">' +
    '<input class="input-sm" id="sw-gear-notes-' + i + '" placeholder="Notes" style="width:120px">' +
    '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--ink3);cursor:pointer">x</button>';
  list.appendChild(div);
}

function swSetWounds(i) {
  if (!swCurrentChar) return;
  swCurrentChar.blessures = swCurrentChar.blessures === i + 1 ? i : i + 1;
  [0,1,2,3].forEach(j => {
    const btn = document.getElementById('sw-wound-' + j);
    if (btn) btn.style.background = swCurrentChar.blessures >= j + 1 ? 'var(--red)' : 'var(--bg)';
  });
}

function swSetFatigue(i) {
  if (!swCurrentChar) return;
  swCurrentChar.fatigue = swCurrentChar.fatigue === i + 1 ? i : i + 1;
  [0,1,2].forEach(j => {
    const btn = document.getElementById('sw-fatigue-' + j);
    if (btn) btn.style.background = swCurrentChar.fatigue >= j + 1 ? 'var(--gold)' : 'var(--bg)';
  });
}

function swChangeBennieDirect(delta) {
  if (!swCurrentChar) return;
  swCurrentChar.bennies = Math.max(0, (swCurrentChar.bennies || 0) + delta);
  const el = document.getElementById('sw-bennies-val');
  if (el) el.textContent = swCurrentChar.bennies;
}

async function swSaveSheet() {
  if (!swCurrentChar) return;
  const skills = [];
  document.querySelectorAll('[id^="sw-skill-name-"]').forEach((el, i) => {
    if (!el.value) return;
    const name = el.value.trim();
    const die = parseInt(document.getElementById('sw-skill-die-' + i)?.value || 6);
    const linked = document.getElementById('sw-skill-linked-' + i)?.value || '';
    if (name) skills.push({ name, die, linked });
  });
  const edges = Array.from(document.querySelectorAll('[id^="sw-edge-"]')).map(el => el.value.trim()).filter(Boolean);
  const hindrances = Array.from(document.querySelectorAll('[id^="sw-hindrance-"]')).map(el => el.value.trim()).filter(Boolean);
  const gear = [];
  document.querySelectorAll('[id^="sw-gear-"]:not([id*="notes"])').forEach((el, i) => {
    if (!el.value) return;
    const name = el.value.trim();
    const notes = document.getElementById('sw-gear-notes-' + i)?.value || '';
    if (name) gear.push({ name, notes });
  });

  const data = {
    name: document.getElementById('sw-name')?.value,
    race: document.getElementById('sw-race')?.value,
    rank: document.getElementById('sw-rank')?.value,
    xp: parseInt(document.getElementById('sw-xp')?.value || 0),
    agilite: parseInt(document.getElementById('sw-agilite')?.value || 6),
    astuce: parseInt(document.getElementById('sw-astuce')?.value || 6),
    esprit: parseInt(document.getElementById('sw-esprit')?.value || 6),
    force: parseInt(document.getElementById('sw-force')?.value || 6),
    vigueur: parseInt(document.getElementById('sw-vigueur')?.value || 6),
    charisme: parseInt(document.getElementById('sw-charisme')?.value || 0),
    celerite: parseInt(document.getElementById('sw-celerite')?.value || 6),
    parade: parseInt(document.getElementById('sw-parade')?.value || 2),
    robustesse: parseInt(document.getElementById('sw-robustesse')?.value || 4),
    blessures: swCurrentChar.blessures || 0,
    fatigue: swCurrentChar.fatigue || 0,
    bennies: swCurrentChar.bennies || 3,
    notes: document.getElementById('sw-notes')?.value || '',
    skills, edges, hindrances, gear
  };

  await api('PUT', '/sw/characters/' + swCurrentChar.id, data);
  toast('Fiche sauvegardée !', 'success');
  swCurrentChar = { ...swCurrentChar, ...data };
  await swLoadCharacters();
}

function swCloseSheet() {
  const modal = document.getElementById('sw-sheet-modal');
  if (modal) modal.style.display = 'none';
}

async function swDeleteChar(id) {
  if (!confirm('Supprimer ce personnage ?')) return;
  await api('DELETE', '/sw/characters/' + id);
  await swLoadCharacters();
  toast('Personnage supprimé', 'success');
}

async function swCreateChar() {
  const name = document.getElementById('sw-new-name')?.value?.trim();
  if (!name) { toast('Nom requis', 'error'); return; }
  const playerId = document.getElementById('sw-new-player')?.value || null;
  const campaignId = vttState.room?.campaign_id || null;
  const system = vttState.room?.system || null;
  const data = await api('POST', '/sw/characters', { name, campaign_id: campaignId, assigned_user_id: playerId ? parseInt(playerId) : null, system });
  document.getElementById('sw-new-name').value = '';
  const chars = await api('GET', '/sw/characters');
  const char = chars.find(c => c.id === data.id);
  if (char) swRenderSheet(char);
  await swLoadCharacters();
}
