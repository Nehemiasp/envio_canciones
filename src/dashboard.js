import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import express from 'express';
import cron from 'node-cron';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANCIONES_FILE = path.join(RAIZ, 'canciones.json');
const ENV_FILE = path.join(RAIZ, '.env');
const ESTADO_FILE = path.join(RAIZ, 'estado.json');
const LOG_FILE = path.join(RAIZ, 'actividad.json');
const PUBLIC_DIR = path.join(RAIZ, 'public');
const SEND_SCRIPT = path.join(RAIZ, 'src', 'send.js');
const DIAS = 30;

const leerJson = (f, def) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def);
const guardarJson = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');

// --- Activity log ---
function logActividad(tipo, mensaje, extra = {}) {
  const logs = leerJson(LOG_FILE, []);
  logs.unshift({
    fecha: new Date().toISOString(),
    tipo,
    mensaje,
    ...extra,
  });
  // keep last 50 entries
  if (logs.length > 50) logs.length = 50;
  guardarJson(LOG_FILE, logs);
}

// --- .env helpers ---
function leerEnv() {
  const config = { NUMERO_DESTINO: '', FECHA_INICIO: '', HORA_ENVIO: '', SCHEDULER_ACTIVO: 'false' };
  if (!fs.existsSync(ENV_FILE)) return config;
  for (const linea of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) config[m[1]] = m[2];
  }
  return config;
}

function guardarEnv(config) {
  const lines = [
    `# Número de tu pareja con código de país, sin + ni espacios`,
    `NUMERO_DESTINO=${config.NUMERO_DESTINO || ''}`,
    `# Primer día del envío (YYYY-MM-DD). Si se omite, se usa el día del primer envío.`,
    `FECHA_INICIO=${config.FECHA_INICIO || ''}`,
    `# Hora de envío diario (HH:MM formato 24h)`,
    `HORA_ENVIO=${config.HORA_ENVIO || ''}`,
    `# Scheduler activo (true/false)`,
    `SCHEDULER_ACTIVO=${config.SCHEDULER_ACTIVO || 'false'}`,
  ];
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf8');
}

// --- day calc ---
function calcularDia(estado, config) {
  const hoy = new Date().toLocaleDateString('en-CA');
  const inicio = config.FECHA_INICIO || estado.inicio || hoy;
  const ms = new Date(hoy + 'T00:00:00') - new Date(inicio + 'T00:00:00');
  return Math.floor(ms / 86400000) + 1;
}

// --- Run send.js as child process ---
function ejecutarEnvio(dryRun = false) {
  return new Promise((resolve, reject) => {
    const args = [SEND_SCRIPT];
    if (dryRun) args.push('--dry-run');

    const child = spawn(process.execPath, args, {
      cwd: RAIZ,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      const output = (stdout + stderr).trim();
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output || `Proceso terminó con código ${code}`));
      }
    });

    child.on('error', reject);

    // timeout 60s
    setTimeout(() => {
      child.kill();
      reject(new Error('Timeout: el envío tardó más de 60 segundos'));
    }, 60000);
  });
}

// --- Scheduler ---
let cronJob = null;
let schedulerStatus = { activo: false, hora: '', proximoEnvio: null };

function calcularProximoEnvio(hora) {
  if (!hora) return null;
  const [h, m] = hora.split(':').map(Number);
  const ahora = new Date();
  const proximo = new Date(ahora);
  proximo.setHours(h, m, 0, 0);
  if (proximo <= ahora) {
    proximo.setDate(proximo.getDate() + 1);
  }
  return proximo.toISOString();
}

function iniciarScheduler() {
  detenerScheduler();

  const config = leerEnv();
  const hora = config.HORA_ENVIO;
  const activo = config.SCHEDULER_ACTIVO === 'true';

  if (!activo || !hora) {
    schedulerStatus = { activo: false, hora: '', proximoEnvio: null };
    return;
  }

  const [h, m] = hora.split(':').map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    schedulerStatus = { activo: false, hora, proximoEnvio: null, error: 'Hora inválida' };
    return;
  }

  const cronExpr = `${m} ${h} * * *`;

  cronJob = cron.schedule(cronExpr, async () => {
    console.log(`⏰ [${new Date().toLocaleTimeString()}] Ejecutando envío programado...`);
    logActividad('scheduler', `Envío programado a las ${hora}`);

    try {
      const output = await ejecutarEnvio(false);
      console.log(`✅ Envío programado completado: ${output}`);
      logActividad('envio', output, { exito: true });
    } catch (err) {
      console.error(`❌ Error en envío programado: ${err.message}`);
      logActividad('error', err.message, { exito: false });
    }

    // recalculate next
    schedulerStatus.proximoEnvio = calcularProximoEnvio(hora);
  }, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

  schedulerStatus = {
    activo: true,
    hora,
    proximoEnvio: calcularProximoEnvio(hora),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  console.log(`⏰ Scheduler activado: todos los días a las ${hora}`);
  logActividad('scheduler', `Scheduler activado para las ${hora}`);
}

function detenerScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  schedulerStatus = { activo: false, hora: '', proximoEnvio: null };
}

// --- Express ---
const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Canciones CRUD
app.get('/api/canciones', (_req, res) => {
  res.json(leerJson(CANCIONES_FILE, []));
});

app.post('/api/canciones', (req, res) => {
  const canciones = leerJson(CANCIONES_FILE, []);
  const { titulo, artista, url, dedicatoria } = req.body;
  if (!titulo || !artista) return res.status(400).json({ error: 'Título y artista son obligatorios' });
  canciones.push({ titulo, artista, url: url || '', dedicatoria: dedicatoria || '' });
  guardarJson(CANCIONES_FILE, canciones);
  logActividad('cancion', `Canción agregada: ${titulo} — ${artista}`);
  res.status(201).json({ ok: true, total: canciones.length });
});

app.put('/api/canciones/:i', (req, res) => {
  const canciones = leerJson(CANCIONES_FILE, []);
  const i = parseInt(req.params.i, 10);
  if (i < 0 || i >= canciones.length) return res.status(404).json({ error: 'Índice fuera de rango' });
  const { titulo, artista, url, dedicatoria } = req.body;
  if (!titulo || !artista) return res.status(400).json({ error: 'Título y artista son obligatorios' });
  canciones[i] = { titulo, artista, url: url || '', dedicatoria: dedicatoria || '' };
  guardarJson(CANCIONES_FILE, canciones);
  logActividad('cancion', `Canción #${i + 1} editada: ${titulo}`);
  res.json({ ok: true });
});

app.delete('/api/canciones/:i', (req, res) => {
  const canciones = leerJson(CANCIONES_FILE, []);
  const i = parseInt(req.params.i, 10);
  if (i < 0 || i >= canciones.length) return res.status(404).json({ error: 'Índice fuera de rango' });
  const removed = canciones.splice(i, 1)[0];
  guardarJson(CANCIONES_FILE, canciones);
  logActividad('cancion', `Canción eliminada: ${removed.titulo}`);
  res.json({ ok: true, total: canciones.length });
});

// Reorder
app.put('/api/canciones-reorder', (req, res) => {
  const { from, to } = req.body;
  const canciones = leerJson(CANCIONES_FILE, []);
  if (from < 0 || from >= canciones.length || to < 0 || to >= canciones.length) {
    return res.status(400).json({ error: 'Índices inválidos' });
  }
  const [item] = canciones.splice(from, 1);
  canciones.splice(to, 0, item);
  guardarJson(CANCIONES_FILE, canciones);
  res.json({ ok: true });
});

// Config
app.get('/api/config', (_req, res) => {
  res.json(leerEnv());
});

app.put('/api/config', (req, res) => {
  const { NUMERO_DESTINO, FECHA_INICIO, HORA_ENVIO, SCHEDULER_ACTIVO } = req.body;
  guardarEnv({ NUMERO_DESTINO, FECHA_INICIO, HORA_ENVIO, SCHEDULER_ACTIVO });

  // restart scheduler with new config
  if (SCHEDULER_ACTIVO === 'true' && HORA_ENVIO) {
    iniciarScheduler();
  } else {
    detenerScheduler();
  }

  res.json({ ok: true });
});

// Estado / status
app.get('/api/estado', (_req, res) => {
  const estado = leerJson(ESTADO_FILE, {});
  const config = leerEnv();
  const dia = calcularDia(estado, config);
  const hoy = new Date().toLocaleDateString('en-CA');
  res.json({
    diaActual: dia,
    diasTotal: DIAS,
    ultimoEnvio: estado.ultimoEnvio || null,
    enviadoHoy: estado.ultimoEnvio === hoy,
    inicio: config.FECHA_INICIO || estado.inicio || null,
    terminado: dia > DIAS,
  });
});

// Scheduler status
app.get('/api/scheduler', (_req, res) => {
  res.json(schedulerStatus);
});

// Activity log
app.get('/api/actividad', (_req, res) => {
  res.json(leerJson(LOG_FILE, []));
});

// Send: test (dry-run)
app.post('/api/enviar-prueba', async (_req, res) => {
  try {
    const output = await ejecutarEnvio(true);
    logActividad('prueba', output, { exito: true });
    res.json({ ok: true, output });
  } catch (err) {
    logActividad('error', `Prueba fallida: ${err.message}`, { exito: false });
    res.status(500).json({ error: err.message });
  }
});

// Send: real
app.post('/api/enviar', async (_req, res) => {
  try {
    const output = await ejecutarEnvio(false);
    logActividad('envio', output, { exito: true });
    res.json({ ok: true, output });
  } catch (err) {
    logActividad('error', `Envío fallido: ${err.message}`, { exito: false });
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.DASHBOARD_PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🎵 Dashboard abierto en  http://localhost:${PORT}\n`);
  // auto-start scheduler if configured
  iniciarScheduler();
});
