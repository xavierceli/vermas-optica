// Driver Web Bluetooth para Phomemo D30 / rotuladoras compatibles ESC/POS raster

const D30_SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb';
const D30_CHARACTERISTIC_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';

/**
 * Genera un canvas en memoria y renderiza la etiqueta del armazón
 * Ancho estándar para etiqueta de 12-14 mm: ~96-112 puntos a 203 DPI.
 */
function generarBitmapEtiqueta({ codigo = '', precio = 0, nombre = 'VER+ ÓPTICA' }) {
  const width = 96; // 12 mm aprox a 203 dpi
  const height = 240; // longitud de la tira

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fondo blanco limpio
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';

  // Encabezado
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(nombre, width / 2, 22);

  // Línea divisoria
  ctx.fillRect(8, 28, width - 16, 1.5);

  // Código del Armazón (rotado o vertical para aprovechar el largo)
  ctx.font = 'bold 16px monospace';
  ctx.fillText(codigo.toUpperCase(), width / 2, 60);

  // Espacio central (para el doblez si es etiqueta tipo joyero)
  ctx.font = '9px sans-serif';
  ctx.fillText('ARMAZÓN', width / 2, 90);

  // Precio final destacado
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`$${Number(precio).toFixed(2)}`, width / 2, 140);

  // Obtener matriz binaria monocromática (1 = negro, 0 = blanco)
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
          const luminancia = (imgData.data[idx] + imgData.data[idx + 1] + imgData.data[idx + 2]) / 3;
          if (luminancia < 128) {
            byte |= (1 << (7 - bit));
          }
        }
      }
      buffer.push(byte);
    }
  }

  return { buffer: new Uint8Array(buffer), widthBytes: bytesPorFila, height };
}

/**
 * Conecta con la impresora D30 por Bluetooth y envía la etiqueta.
 */
export async function imprimirEtiquetaD30({ codigo, precio }) {
  if (!navigator.bluetooth) {
    throw new Error('Tu navegador no soporta Bluetooth Web. Usa Chrome, Edge o Bluefy (iOS).');
  }

  // 1. Solicitar dispositivo Bluetooth
  const device = await navigator.bluetooth.requestDevice({
    filters: [
      { namePrefix: 'D30' },
      { namePrefix: 'Phomemo' },
      { namePrefix: 'Q30' }
    ],
    optionalServices: [D30_SERVICE_UUID, '0000fee7-0000-1000-8000-00805f9b34fb']
  });

  const server = await device.gatt.connect();

  let service;
  try {
    service = await server.getPrimaryService(D30_SERVICE_UUID);
  } catch {
    service = await server.getPrimaryService('0000fee7-0000-1000-8000-00805f9b34fb');
  }

  const characteristic = await service.getCharacteristic(D30_CHARACTERISTIC_UUID);

  // 2. Renderizar imagen a imprimir
  const { buffer, widthBytes, height } = generarBitmapEtiqueta({
    codigo,
    precio,
    nombre: 'VER+'
  });

  // 3. Comandos de inicialización y trama de mapa de bits estándar CPCL/ESC
  const initCmd = new Uint8Array([0x1b, 0x40]); // ESC @
  await characteristic.writeValue(initCmd);

  // Enviar comando raster de impresión (GS v 0)
  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff
  ]);
  await characteristic.writeValue(header);

  // Enviar buffer en paquetes pequeños (MTU BLE ~20 bytes o bloques seguros de 100 bytes)
  const chunkSize = 100;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const chunk = buffer.slice(i, i + chunkSize);
    await characteristic.writeValue(chunk);
  }

  // Alimentar papel y cortar margen
  const feedCmd = new Uint8Array([0x1b, 0x64, 0x02]); // ESC d 2
  await characteristic.writeValue(feedCmd);

  await device.gatt.disconnect();
  return true;
}