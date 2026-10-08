// Driver Web Bluetooth para Phomemo D30 / rotuladoras compatibles ESC/POS raster

const D30_SERVICE_UUID = 0xff00;
const D30_CHARACTERISTIC_UUID = 0xff02;

/**
 * Genera un canvas en memoria y renderiza la etiqueta del armazón
 */
function generarBitmapEtiqueta({ codigo = '', precio = 0, nombre = 'VER+ ÓPTICA' }) {
  const width = 96; // ~12 mm a 203 DPI
  const height = 240;

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

  // Código del Armazón
  ctx.font = 'bold 15px monospace';
  ctx.fillText(codigo.toUpperCase(), width / 2, 60);

  // Detalle intermedio
  ctx.font = '9px sans-serif';
  ctx.fillText('ARMAZÓN', width / 2, 90);

  // Precio final
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`$${Number(precio).toFixed(2)}`, width / 2, 140);

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
 * Conecta con la impresora y envía la etiqueta.
 */
export async function imprimirEtiquetaD30({ codigo, precio }) {
  if (!navigator.bluetooth) {
    throw new Error('Tu navegador no soporta Bluetooth Web. Usa Google Chrome o Microsoft Edge.');
  }

  // Permite listar todos los dispositivos Bluetooth cercanos para que la D30 aparezca al instante
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      D30_SERVICE_UUID,
      '0000ff00-0000-1000-8000-00805f9b34fb',
      '0000fee7-0000-1000-8000-00805f9b34fb'
    ]
  });

  const server = await device.gatt.connect();

  let service;
  try {
    service = await server.getPrimaryService(D30_SERVICE_UUID);
  } catch {
    try {
      service = await server.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
    } catch {
      service = await server.getPrimaryService('0000fee7-0000-1000-8000-00805f9b34fb');
    }
  }

  let characteristic;
  try {
    characteristic = await service.getCharacteristic(D30_CHARACTERISTIC_UUID);
  } catch {
    characteristic = await service.getCharacteristic('0000ff02-0000-1000-8000-00805f9b34fb');
  }

  const enviarDatos = async (bytes) => {
    if (characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(bytes);
    } else {
      await characteristic.writeValue(bytes);
    }
  };

  const { buffer, widthBytes, height } = generarBitmapEtiqueta({
    codigo,
    precio,
    nombre: 'VER+'
  });

  // Inicialización de la impresora
  await enviarDatos(new Uint8Array([0x1b, 0x40]));

  // Comando de impresión Raster
  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff
  ]);
  await enviarDatos(header);

  // Enviar bloques
  const chunkSize = 64;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const chunk = buffer.slice(i, i + chunkSize);
    await enviarDatos(chunk);
    await new Promise(r => setTimeout(r, 10)); // Pequeña pausa para no saturar el buffer BLE
  }

  // Alimentar papel
  await enviarDatos(new Uint8Array([0x1b, 0x64, 0x02]));

  // Desconectar suavemente
  setTimeout(() => {
    if (device.gatt.connected) device.gatt.disconnect();
  }, 1000);

  return true;
}