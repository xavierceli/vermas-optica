// Driver Web Bluetooth para Phomemo D30 / D-Series

// Servicios conocidos en las diferentes versiones de hardware de Phomemo D30 / D110
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

function generarBitmapEtiqueta({ codigo = '', precio = 0, nombre = 'VER+' }) {
  // Ajuste calibrado al área real de la etiqueta de 12-14 mm (ancho 96 px, alto 190 px)
  const width = 96;
  const height = 190;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fondo blanco limpio
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';

  // Marca superior
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(nombre, width / 2, 20);

  // Línea divisoria
  ctx.fillRect(8, 26, width - 16, 2);

  // Código del Armazón destacado y nítido
  ctx.font = 'bold 18px monospace';
  ctx.fillText(codigo.toUpperCase(), width / 2, 62);

  // Detalle tipo
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = '#333333';
  ctx.fillText('ARMAZÓN', width / 2, 92);

  // Precio final grande
  ctx.fillStyle = '#000000';
  ctx.font = '900 24px sans-serif';
  ctx.fillText(`$${Number(precio).toFixed(2)}`, width / 2, 138);

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

  // Reutilizar conexión activa si sigue conectada
  if (dispositivoConectado?.gatt?.connected && caracteristicaEscritura) {
    // Listo para imprimir directo
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

  // Comando de inicio (ESC @)
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

  // Avance de línea calibrado
  await enviar(new Uint8Array([0x1b, 0x64, 0x02]));
  return true;
}