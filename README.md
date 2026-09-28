# envio_canciones

Envía **una canción por día durante 30 días** a un número de WhatsApp. Gratis, usando tu propia cuenta (Baileys, sesión por QR).

> Usa una librería no oficial: es válido para uso personal y bajo volumen (1 mensaje/día), pero va contra los términos de WhatsApp. Úsalo con moderación.

## Uso
1. `npm install`
2. `cp .env.example .env` y completa `NUMERO_DESTINO` (con código de país, sin `+`).
3. Edita `canciones.json` con las 30 canciones (título, artista, link y dedicatoria opcional).
4. `npm run login` y escanea el QR (WhatsApp > Dispositivos vinculados). Solo una vez.
5. `npm run prueba` muestra el mensaje de hoy sin enviarlo.
6. Programa el envío diario con cron (ej. todos los días a las 9:00):

```
0 9 * * * cd /ruta/envio_canciones && /usr/bin/node src/send.js >> envio.log 2>&1
```

El script es idempotente: si se ejecuta dos veces el mismo día, solo envía una. El día 1 es `FECHA_INICIO` (o el día del primer envío) y tras el día 30 no envía más. Si la PC estaba apagada un día, esa canción se salta.
