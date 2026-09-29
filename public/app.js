/* ===== State ===== */
let canciones = [];
let estado = {};
let config = {};
let scheduler = {};
let editIndex = -1;
let deleteIndex = -1;

/* ===== DOM refs ===== */
const $ = (s) => document.querySelector(s);

const statDia = $('#stat-dia');
const statUltimo = $('#stat-ultimo');
const statCanciones = $('#stat-canciones');
const statNumero = $('#stat-numero');
const headerStatus = $('#header-status');
const schedulerBadge = $('#scheduler-badge');
const schedDot = $('#sched-dot');
const schedText = $('#sched-text');
const inputNumero = $('#input-numero');
const inputFecha = $('#input-fecha');
const inputHora = $('#input-hora');
const toggleScheduler = $('#toggle-scheduler');
const btnSaveConfig = $('#btn-save-config');
const btnSaveScheduler = $('#btn-save-scheduler');
const nextSendInfo = $('#next-send-info');
const nextSendTime = $('#next-send-time');
const progressBar = $('#progress-bar');
const progressLabel = $('#progress-label');
const progressDetail = $('#progress-detail');
const songsList = $('#songs-list');
const songsCount = $('#songs-count');
const emptyState = $('#empty-state');
const btnAddSong = $('#btn-add-song');
const btnTestSend = $('#btn-test-send');
const btnRealSend = $('#btn-real-send');
const sendOutput = $('#send-output');
const logList = $('#log-list');
const btnRefreshLog = $('#btn-refresh-log');

// Modals
const modalOverlay = $('#modal-overlay');
const modalTitle = $('#modal-title');
const modalClose = $('#modal-close');
const modalCancel = $('#modal-cancel');
const modalSave = $('#modal-save');
const deleteOverlay = $('#delete-overlay');
const deleteClose = $('#delete-close');
const deleteCancel = $('#delete-cancel');
const deleteConfirm = $('#delete-confirm');
const deleteMsg = $('#delete-msg');
const sendOverlay = $('#send-overlay');
const sendClose = $('#send-close');
const sendCancel = $('#send-cancel');
const sendConfirm = $('#send-confirm');

/* ===== API helpers ===== */
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

/* ===== Toast ===== */
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ===== Data fetching ===== */
async function fetchAll() {
  [canciones, estado, config, scheduler] = await Promise.all([
    api('/api/canciones'),
    api('/api/estado'),
    api('/api/config'),
    api('/api/scheduler'),
  ]);
  render();
}

async function fetchLog() {
  const logs = await api('/api/actividad');
  renderLog(logs);
}

/* ===== Render ===== */
function render() {
  // Stats
  const dia = estado.diaActual || 0;
  statDia.textContent = dia < 1 ? 'Pendiente' : dia > 30 ? '✅ Fin' : `${dia} / 30`;
  statUltimo.textContent = estado.ultimoEnvio || 'Nunca';
  statCanciones.textContent = `${canciones.length} / 30`;
  statNumero.textContent = config.NUMERO_DESTINO || 'No configurado';

  // Header status
  const dot = headerStatus.querySelector('.status-dot');
  const txt = headerStatus.querySelector('.status-text');
  if (estado.terminado) {
    dot.className = 'status-dot done';
    txt.textContent = '30 días completados';
  } else if (estado.enviadoHoy) {
    dot.className = 'status-dot active';
    txt.textContent = 'Enviado hoy ✓';
  } else if (dia >= 1) {
    dot.className = 'status-dot';
    txt.textContent = 'Pendiente de envío';
  } else {
    dot.className = 'status-dot';
    txt.textContent = 'Esperando inicio';
  }

  // Scheduler badge
  if (scheduler.activo) {
    schedulerBadge.classList.add('active');
    schedText.textContent = `Diario a las ${scheduler.hora}`;
  } else {
    schedulerBadge.classList.remove('active');
    schedText.textContent = 'Scheduler inactivo';
  }

  // Config inputs
  inputNumero.value = config.NUMERO_DESTINO || '';
  inputFecha.value = config.FECHA_INICIO || '';
  inputHora.value = config.HORA_ENVIO || '09:00';
  toggleScheduler.checked = config.SCHEDULER_ACTIVO === 'true';

  // Next send
  if (scheduler.activo && scheduler.proximoEnvio) {
    nextSendInfo.style.display = 'flex';
    const next = new Date(scheduler.proximoEnvio);
    nextSendTime.textContent = next.toLocaleString('es', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } else {
    nextSendInfo.style.display = 'none';
  }

  // Progress
  const pct = Math.min(Math.max(((dia - 1) / 30) * 100, 0), 100);
  progressBar.style.width = `${estado.enviadoHoy ? Math.min((dia / 30) * 100, 100) : pct}%`;
  progressLabel.textContent = `${Math.min(Math.max(dia - (estado.enviadoHoy ? 0 : 1), 0), 30)} / 30 días`;
  progressDetail.textContent = estado.inicio ? `Inicio: ${estado.inicio}` : 'Sin fecha de inicio definida';

  // Songs
  songsCount.textContent = canciones.length;
  if (canciones.length === 0) {
    songsList.style.display = 'none';
    emptyState.style.display = '';
  } else {
    songsList.style.display = '';
    emptyState.style.display = 'none';
    renderSongs();
  }

  // Fetch log
  fetchLog();
}

function renderSongs() {
  const dia = estado.diaActual || 0;
  songsList.innerHTML = canciones
    .map((c, i) => {
      const isToday = i + 1 === dia && !estado.terminado;
      const isSent = i + 1 < dia;
      let cls = 'song-card';
      if (isToday) cls += ' is-today';
      if (isSent) cls += ' is-sent';

      const urlBadge = c.url
        ? `<span class="song-url-icon" title="${escapeHtml(c.url)}">🔗</span>`
        : '';

      const dedic = c.dedicatoria
        ? `<div class="song-dedic">"${escapeHtml(c.dedicatoria)}"</div>`
        : '';

      return `
        <div class="${cls}" data-index="${i}">
          <div class="song-number">${i + 1}</div>
          <div class="song-info">
            <div class="song-title">${escapeHtml(c.titulo)}${urlBadge}</div>
            <div class="song-artist">${escapeHtml(c.artista)}</div>
            ${dedic}
          </div>
          <div class="song-actions">
            <button class="btn btn-icon" onclick="openEdit(${i})" title="Editar">✏️</button>
            <button class="btn btn-icon danger" onclick="openDelete(${i})" title="Eliminar">🗑️</button>
          </div>
        </div>`;
    })
    .join('');
}

function renderLog(logs) {
  if (!logs || logs.length === 0) {
    logList.innerHTML = '<div class="log-empty">Sin actividad registrada</div>';
    return;
  }

  const typeIcons = {
    envio: '📤',
    prueba: '🧪',
    error: '❌',
    scheduler: '⏰',
    cancion: '🎵',
  };

  logList.innerHTML = logs
    .slice(0, 20)
    .map((l) => {
      const icon = typeIcons[l.tipo] || '📝';
      const time = new Date(l.fecha).toLocaleString('es', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `
        <div class="log-entry">
          <div class="log-type">${icon}</div>
          <div class="log-content">
            <div class="log-msg">${escapeHtml(l.mensaje)}</div>
            <div class="log-time">${time}</div>
          </div>
        </div>`;
    })
    .join('');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/* ===== Config save ===== */
btnSaveConfig.addEventListener('click', async () => {
  const numero = inputNumero.value.trim().replace(/\D/g, '');
  const fecha = inputFecha.value.trim();
  await api('/api/config', {
    method: 'PUT',
    body: {
      NUMERO_DESTINO: numero,
      FECHA_INICIO: fecha,
      HORA_ENVIO: config.HORA_ENVIO || '09:00',
      SCHEDULER_ACTIVO: config.SCHEDULER_ACTIVO || 'false',
    },
  });
  toast('Configuración guardada', 'success');
  await fetchAll();
});

/* ===== Scheduler save ===== */
btnSaveScheduler.addEventListener('click', async () => {
  const hora = inputHora.value.trim();
  const activo = toggleScheduler.checked;

  if (activo && !hora) {
    toast('Selecciona una hora para el envío', 'error');
    return;
  }

  await api('/api/config', {
    method: 'PUT',
    body: {
      NUMERO_DESTINO: config.NUMERO_DESTINO || '',
      FECHA_INICIO: config.FECHA_INICIO || '',
      HORA_ENVIO: hora,
      SCHEDULER_ACTIVO: activo ? 'true' : 'false',
    },
  });

  toast(activo ? `Programado todos los días a las ${hora}` : 'Scheduler desactivado', 'success');
  await fetchAll();
});

/* ===== Send test ===== */
btnTestSend.addEventListener('click', async () => {
  btnTestSend.disabled = true;
  btnTestSend.innerHTML = '<span class="spinner"></span> Ejecutando...';
  sendOutput.style.display = 'none';

  try {
    const res = await api('/api/enviar-prueba', { method: 'POST' });
    if (res.error) throw new Error(res.error);
    sendOutput.style.display = 'block';
    sendOutput.className = 'send-output success';
    sendOutput.textContent = res.output || 'Prueba completada';
    toast('Prueba ejecutada', 'success');
  } catch (err) {
    sendOutput.style.display = 'block';
    sendOutput.className = 'send-output error';
    sendOutput.textContent = err.message;
    toast('Error en la prueba', 'error');
  } finally {
    btnTestSend.disabled = false;
    btnTestSend.innerHTML = '<span>🧪 Envío de prueba</span>';
    fetchLog();
  }
});

/* ===== Send real ===== */
btnRealSend.addEventListener('click', () => {
  sendOverlay.classList.add('open');
});

sendClose.addEventListener('click', () => sendOverlay.classList.remove('open'));
sendCancel.addEventListener('click', () => sendOverlay.classList.remove('open'));
sendOverlay.addEventListener('click', (e) => {
  if (e.target === sendOverlay) sendOverlay.classList.remove('open');
});

sendConfirm.addEventListener('click', async () => {
  sendOverlay.classList.remove('open');
  btnRealSend.disabled = true;
  btnRealSend.innerHTML = '<span class="spinner"></span> Enviando...';
  sendOutput.style.display = 'none';

  try {
    const res = await api('/api/enviar', { method: 'POST' });
    if (res.error) throw new Error(res.error);
    sendOutput.style.display = 'block';
    sendOutput.className = 'send-output success';
    sendOutput.textContent = res.output || 'Envío completado';
    toast('¡Canción enviada! 🎵', 'success');
  } catch (err) {
    sendOutput.style.display = 'block';
    sendOutput.className = 'send-output error';
    sendOutput.textContent = err.message;
    toast('Error al enviar', 'error');
  } finally {
    btnRealSend.disabled = false;
    btnRealSend.innerHTML = '<span>📤 Enviar ahora</span>';
    await fetchAll();
  }
});

/* ===== Modal: add / edit ===== */
function openModal() { modalOverlay.classList.add('open'); }
function closeModal() { modalOverlay.classList.remove('open'); editIndex = -1; }

btnAddSong.addEventListener('click', () => {
  editIndex = -1;
  modalTitle.textContent = 'Agregar canción';
  $('#m-titulo').value = '';
  $('#m-artista').value = '';
  $('#m-url').value = '';
  $('#m-dedicatoria').value = '';
  openModal();
});

window.openEdit = (i) => {
  editIndex = i;
  const c = canciones[i];
  modalTitle.textContent = `Editar canción #${i + 1}`;
  $('#m-titulo').value = c.titulo;
  $('#m-artista').value = c.artista;
  $('#m-url').value = c.url || '';
  $('#m-dedicatoria').value = c.dedicatoria || '';
  openModal();
};

modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

modalSave.addEventListener('click', async () => {
  const titulo = $('#m-titulo').value.trim();
  const artista = $('#m-artista').value.trim();
  const url = $('#m-url').value.trim();
  const dedicatoria = $('#m-dedicatoria').value.trim();

  if (!titulo || !artista) {
    toast('Título y artista son obligatorios', 'error');
    return;
  }

  const body = { titulo, artista, url, dedicatoria };

  if (editIndex >= 0) {
    await api(`/api/canciones/${editIndex}`, { method: 'PUT', body });
    toast(`Canción #${editIndex + 1} actualizada`, 'success');
  } else {
    await api('/api/canciones', { method: 'POST', body });
    toast('Canción agregada', 'success');
  }

  closeModal();
  await fetchAll();
});

/* ===== Delete confirm ===== */
window.openDelete = (i) => {
  deleteIndex = i;
  const c = canciones[i];
  deleteMsg.textContent = `¿Eliminar "${c.titulo}" de ${c.artista}?`;
  deleteOverlay.classList.add('open');
};

function closeDelete() { deleteOverlay.classList.remove('open'); deleteIndex = -1; }

deleteClose.addEventListener('click', closeDelete);
deleteCancel.addEventListener('click', closeDelete);
deleteOverlay.addEventListener('click', (e) => { if (e.target === deleteOverlay) closeDelete(); });

deleteConfirm.addEventListener('click', async () => {
  if (deleteIndex < 0) return;
  await api(`/api/canciones/${deleteIndex}`, { method: 'DELETE' });
  toast('Canción eliminada', 'success');
  closeDelete();
  await fetchAll();
});

/* ===== Refresh log ===== */
btnRefreshLog.addEventListener('click', () => {
  fetchLog();
  toast('Log actualizado', 'info');
});

/* ===== Keyboard shortcuts ===== */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeDelete();
    sendOverlay.classList.remove('open');
  }
});

/* ===== Init ===== */
fetchAll();
