import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_DIR = path.join(RAIZ, 'auth');
const ESTADO = path.join(RAIZ, 'estado.json');
const DIAS = 30;

const args = new Set(process.argv.slice(2));
const soloLogin = args.has('--login');
const dryRun = args.has('--dry-run');

cargarEnv();

function cargarEnv() {
  const f = path.join(RAIZ, '.env');
  if (!fs.existsSync(f)) return;
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const hoy = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD en hora local
const leerJson = (f, def) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def);

function diaActual(estado) {
  const inicio = process.env.FECHA_INICIO || estado.inicio || hoy();
  estado.inicio = inicio;
  const ms = new Date(hoy() + 'T00:00:00') - new Date(inicio + 'T00:00:00');
  return Math.floor(ms / 86400000) + 1; // día 1 = fecha de inicio
}

function armarMensaje(c, dia) {
  const partes = [`🎵 Canción ${dia}/${DIAS}`, `*${c.titulo}* — ${c.artista}`];
  if (c.dedicatoria) partes.push('', c.dedicatoria);
  if (c.url) partes.push('', c.url);
  return partes.join('\n');
}

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  return new Promise((resolve, reject) => {
    const abrir = () => {
      const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }) });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          console.log('Escanea este QR en WhatsApp > Dispositivos vinculados:');
          qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') resolve(sock);
        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            reject(new Error('Sesión cerrada. Borra la carpeta auth/ y ejecuta: npm run login'));
          } else {
            abrir(); // reconexión (normal justo después de escanear el QR)
          }
        }
      });
    };
    abrir();
  });
}

async function main() {
  const numero = (process.env.NUMERO_DESTINO || '').replace(/\D/g, '');
  if (!soloLogin && !numero) throw new Error('Falta NUMERO_DESTINO en .env');

  const canciones = leerJson(path.join(RAIZ, 'canciones.json'), []);
  const estado = leerJson(ESTADO, {});

  if (soloLogin) {
    const sock = await conectar();
    console.log('✅ Sesión vinculada. Ya puedes programar el envío diario.');
    sock.end(undefined);
    return;
  }

  if (estado.ultimoEnvio === hoy()) return console.log('Ya se envió la canción de hoy.');

  const dia = diaActual(estado);
  if (dia < 1) return console.log('Aún no llega la fecha de inicio.');
  if (dia > DIAS) return console.log('✅ Los 30 días ya terminaron. Nada que enviar.');
  const cancion = canciones[dia - 1];
  if (!cancion) throw new Error(`Falta la canción del día ${dia} en canciones.json`);

  const texto = armarMensaje(cancion, dia);
  if (dryRun) return console.log(`[prueba] Día ${dia} → ${numero}\n${texto}`);

  const sock = await conectar();
  await sock.sendMessage(`${numero}@s.whatsapp.net`, { text: texto });
  estado.ultimoEnvio = hoy();
  fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 2));
  console.log(`✅ Día ${dia} enviado: ${cancion.titulo}`);
  await new Promise((r) => setTimeout(r, 3000)); // deja terminar la entrega
  sock.end(undefined);
}

main().then(() => process.exit(0), (e) => { console.error('❌', e.message); process.exit(1); });
