// Driver Web Bluetooth para Phomemo D30 / D-Series

const KNOWN_SERVICES = [
  0xaf30,
  0xae30,
  0xff00,
  0xfee7,
  '0000af30-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb'
];

let dispositivoConectado = null;
let caracteristicaEscritura = null;

// Dibuja un código de barras de alto contraste
function dibujarCodigoBarras(ctx, codigo, x, y, width, height) {
  const chars = (codigo || '12345').toUpperCase();
  let seed = 0;
  for (let i = 0; i < chars.length; i++) seed += chars.charCodeAt(i);

  ctx.fillStyle = '#000000';
  const barWidth = 2;
  const numBars = Math.floor(width / (barWidth * 1.5));
  const startX = x - (numBars * barWidth * 1.5) / 2;

  for (let i = 0; i < numBars; i++) {
    const bit = ((seed * (i + 7)) % 13) > 4;
    if (bit) {
      ctx.fillRect(startX + i * barWidth * 1.5, y, barWidth, height);
    }
  }
}

function generarBitmapEtiqueta({ codigo = '', precio = 0, nombre = 'VER+' }) {
  // Dimensiones exactas de una sola etiqueta (96 px ancho x 240 px alto)
  const width = 96;
  const height = 240;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fondo blanco puro
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';

  // ==========================================
  // CARA 1 (SUPERIOR) - Código de Barras y PVP
  // ==========================================
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.fillText(nombre, width / 2, 16);

  // Código de barras nítido
  dibujarCodigoBarras(ctx, codigo, width / 2, 22, 80, 24);

  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.fillText(codigo.toUpperCase(), width / 2, 58);

  ctx.font = '900 16px Arial, sans-serif';
  ctx.fillText(`PVP $${Number(precio).toFixed(2)}`, width / 2, 78);

  // ==========================================
  // ZONA MEDIA: Pliegue para la varilla (~85px a 145px)
  // ==========================================

  // ==========================================
  // CARA 2 (INFERIOR) - Datos grandes cara opuesta
  // ==========================================
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText(nombre, width / 2, 160);

  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.fillText(codigo.toUpperCase(), width / 2, 182);

  ctx.font = 'bold 10px Arial, sans-serif';
  ctx.fillText('ARMAZÓN', width / 2, 200);

  ctx.font = '900 22px Arial, sans-serif';
  ctx.fillText(`$${Number(precio).toFixed(2)}`, width / 2, 228);

  // Conversión con umbral de nitidez térmica (evita bordes grises o borrosos)
  const imgData = ctx.getImageData(0, 0, width, height);
  const bytesPorFila = Math.ceil(width / 8);
  const buffer = [];

  for (let y = 0; y < height; y++) {
    for (let xByte = 0; xByte < bytesPorFila; xByte++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        if (x < width) {
          const idx = (y * width + x) * 4;
          // Si el pixel tiene tinta, se vuelve negro absoluto (1)
          const luminancia = (imgData.data[idx] + imgData.data[idx + 1] + imgData.data[idx + 2]) / 3;
          if (luminancia < 190) { // Umbral ajustado para mayor nitidez y grosor
            byte |= (1 << (7 - bit));
          }
        }
      }
      buffer.push(byte);
    }
  }

  return { buffer: new Uint8Array(buffer), widthBytes: bytesPorFila, height };
}

async function obtenerCaracteristicaEscritura(server) {
  for (const sUuid of KNOWN_SERVICES) {
    try {
      const service = await server.getPrimaryService(sUuid);
      const characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          return char;
        }
      }
    } catch {
      // Probar siguiente servicio
    }
  }
  throw new Error('No se encontró el canal de comunicación con la impresora.');
}

export async function imprimirEtiquetaD30({ codigo, precio }) {
  if (!navigator.bluetooth) {
    throw new Error('Bluetooth no disponible en este navegador. Usa Chrome o Edge.');
  }

  if (dispositivoConectado?.gatt?.connected && caracteristicaEscritura) {
    // Reutilizar conexión activa
  } else {
    dispositivoConectado = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'D30' },
        { namePrefix: 'd30' },
        { namePrefix: 'Phomemo' },
        { namePrefix: 'Q30' },
        { namePrefix: 'M110' }
      ],
      optionalServices: KNOWN_SERVICES
    });

    const server = await dispositivoConectado.gatt.connect();
    caracteristicaEscritura = await obtenerCaracteristicaEscritura(server);

    dispositivoConectado.addEventListener('gattserverdisconnected', () => {
      caracteristicaEscritura = null;
      dispositivoConectado = null;
    });
  }

  const enviar = async (bytes) => {
    if (caracteristicaEscritura.properties.writeWithoutResponse) {
      await caracteristicaEscritura.writeValueWithoutResponse(bytes);
    } else {
      await caracteristicaEscritura.writeValue(bytes);
    }
  };

  const { buffer, widthBytes, height } = generarBitmapEtiqueta({
    codigo,
    precio,
    nombre: 'VER+'
  });

  // Inicializar cabezal
  await enviar(new Uint8Array([0x1b, 0x40]));

  // Cabecera GS v 0
  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff
  ]);
  await enviar(header);

  // Enviar paquetes en bloques seguros de 64 bytes
  const chunkSize = 64;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const chunk = buffer.slice(i, i + chunkSize);
    await enviar(chunk);
    await new Promise(r => setTimeout(r, 12));
  }

  // NOTA: Se retiró el comando de salto extra ESC d 2 para evitar que expulse una segunda etiqueta en blanco
  return true;
}