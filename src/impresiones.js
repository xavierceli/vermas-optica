import { safeString, safeNum, calcularCerca, generarDiagnosticos } from './utilidades';
import { esc } from './escape';
import { calcularTotal, calcularSaldo, calcularMontoDescuento } from './reglas';
import { mostrarAviso } from './avisos';

const txt = valor => esc(safeString(valor));
const pvpFixed = val => Number(val || 0).toFixed(2);

const ESPERA_MAX_SIN_LOAD_MS = 2500;

const alCargar = (win, fn) => {
  let salvavidas = null;
  const imprimir = () => {
    try { fn(); } catch (e) { console.error(e); }
    if (salvavidas !== null) { clearTimeout(salvavidas); salvavidas = null; }
  };
  try {
    if (win.document.readyState === 'complete') { imprimir(); return; }
    win.addEventListener('load', imprimir, { once: true });
    salvavidas = setTimeout(() => {
      console.warn('[impresion] La ventana no terminó de cargar a tiempo; se imprime igualmente.');
      imprimir();
    }, ESPERA_MAX_SIN_LOAD_MS);
  } catch (e) { console.error(e); }
};

export const imprimirInforme = (item) => {
  try {
    const diagnosticos = generarDiagnosticos(item).join(' - ') || 'Evaluación Optométrica Regular';
    const win = window.open('', '_blank');
    if (!win) {
      mostrarAviso('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para continuar.', 'warning');
      return;
    }

    win.document.write(`
      <html translate="no">
        <head>
          <title>Informe - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: auto; }
            .header { text-align: center; border-bottom: 2px solid #0f766e; padding-bottom: 15px; margin-bottom: 20px; }
            .header h1 { color: #0f766e; margin: 0; font-size: 26px; letter-spacing: 1px;}
            .header h2 { margin: 5px 0; color: #555; font-size: 18px; text-transform: uppercase; }
            .info-grid { display: grid; grid-template-columns: 150px 1fr; gap: 10px; margin-bottom: 20px; font-size: 14px; }
            .info-grid strong { color: #0f766e; }
            .section { margin-bottom: 25px; }
            .section h3 { color: #0f766e; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 10px; font-size: 16px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; text-align: center; font-size: 13px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; }
            th { background-color: #f1f5f9; color: #333; }
            .text-box { background: #f8fafc; padding: 10px; border: 1px solid #e2e8f0; font-size: 13px; border-radius: 4px; }
            .firma { margin-top: 60px; text-align: center; }
            .firma-line { border-top: 1px solid #333; width: 250px; margin: 0 auto; padding-top: 5px; font-weight: bold; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="header"><h1>VER+ ÓPTICA</h1><h2>Informe Optométrico</h2></div>
          <div class="info-grid">
            <strong>Nombre del Paciente:</strong> <span>${txt(item?.nombre) || '-'}</span>
            <strong>Cédula de Identidad:</strong> <span>${txt(item?.cedula) || '-'}</span>
            <strong>Fecha de Examen:</strong> <span>${txt(item?.fecha) || '-'}</span>
          </div>
          <div class="section">
            <h3>Lensometría (RX Anterior)</h3>
            <table>
              <tr><th>Ojo</th><th>Esfera</th><th>Cilindro</th><th>Eje</th><th>Add</th><th>A.V.L</th><th>A.V.C</th></tr>
              <tr><td><strong>OD</strong></td><td>${txt(item?.lenso_esf_od) || '-'}</td><td>${txt(item?.lenso_cil_od) || '-'}</td><td>${txt(item?.lenso_eje_od) || '-'}</td><td>${txt(item?.lenso_add_od) || '-'}</td><td>${txt(item?.lenso_avl_od) || '-'}</td><td>${txt(item?.lenso_avc_od) || '-'}</td></tr>
              <tr><td><strong>OI</strong></td><td>${txt(item?.lenso_esf_oi) || '-'}</td><td>${txt(item?.lenso_cil_oi) || '-'}</td><td>${txt(item?.lenso_eje_oi) || '-'}</td><td>${txt(item?.lenso_add_oi) || '-'}</td><td>${txt(item?.lenso_avl_oi) || '-'}</td><td>${txt(item?.lenso_avc_oi) || '-'}</td></tr>
            </table>
          </div>
          <div class="section">
            <h3>Agudeza Visual (Sin Corrección)</h3>
            <table>
              <tr><th>Ojo</th><th>A.V.S.L (Lejos)</th><th>A.V.S.C (Cerca)</th></tr>
              <tr><td><strong>OD</strong></td><td>${txt(item?.avsl_od) || '-'}</td><td>${txt(item?.avsc_od) || '-'}</td></tr>
              <tr><td><strong>OI</strong></td><td>${txt(item?.avsl_oi) || '-'}</td><td>${txt(item?.avsc_oi) || '-'}</td></tr>
            </table>
          </div>
          <div class="section">
            <h3>Refracción Final</h3>
            <table>
              <tr><th>Ojo</th><th>Esfera</th><th>Cilindro</th><th>Eje</th><th>Add</th><th>DNP</th><th>Cerca (Add)</th><th>A.V.C.L</th><th>A.V.C.C</th></tr>
              <tr><td><strong>OD</strong></td><td>${txt(item?.esfera_od) || '-'}</td><td>${txt(item?.cilindro_od) || '-'}</td><td>${txt(item?.eje_od) || '-'}</td><td>${txt(item?.adicion_od) || '-'}</td><td>${txt(item?.dnp_od) || '-'}</td><td>${txt(calcularCerca(item?.esfera_od, item?.adicion_od)) || '-'}</td><td>${txt(item?.avcl_od) || '-'}</td><td>${txt(item?.avcc_od) || '-'}</td></tr>
              <tr><td><strong>OI</strong></td><td>${txt(item?.esfera_oi) || '-'}</td><td>${txt(item?.cilindro_oi) || '-'}</td><td>${txt(item?.eje_oi) || '-'}</td><td>${txt(item?.adicion_oi) || '-'}</td><td>${txt(item?.dnp_oi) || '-'}</td><td>${txt(calcularCerca(item?.esfera_oi, item?.adicion_oi)) || '-'}</td><td>${txt(item?.avcl_oi) || '-'}</td><td>${txt(item?.avcc_oi) || '-'}</td></tr>
            </table>
          </div>
          <div class="section">
            <h3>Diagnóstico</h3>
            <div class="text-box"><strong>${txt(diagnosticos)}</strong></div>
          </div>
          <div class="section">
            <h3>Recomendaciones y Conclusiones</h3>
            <p style="font-size: 13px; color: #333; line-height: 1.6;">
              Utilizar la corrección óptica prescrita, de acuerdo con la fórmula indicada en el presente informe.<br>
              Incluir tratamientos de lentes como Antirreflejo y Protección UV.<br>
              Uso de Lágrimas Artificiales sin conservantes cada 4/6 H.<br><br>
              La fórmula óptica consignada corresponde al estado refractivo del paciente al momento de la evaluación. Se aconseja realizar controles periódicos.
            </p>
          </div>
          <div class="firma">
            <div class="firma-line">Darwin Xavier Celi</div>
            <p style="margin:2px; font-size:12px;">Optómetra | Reg. 2250-2024-8005219</p>
          </div>
        </body>
      </html>
    `);
    win.document.close();
    alCargar(win, () => win.print());
  } catch(e) { console.error(e); }
};

export const imprimirRecetaSimple = (item) => {
  try {
    const win = window.open('', '_blank');
    if (!win) {
      mostrarAviso('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para continuar.', 'warning');
      return;
    }

    win.document.write(`
      <html translate="no">
        <head>
          <title>Receta - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            body { font-family: 'Times New Roman', serif; padding: 50px; color: #333; max-width: 600px; margin: auto; }
            .header { text-align: center; margin-bottom: 40px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: normal; letter-spacing: 3px; color: #2c3e50; }
            .title { text-align: center; text-transform: uppercase; letter-spacing: 2px; font-size: 14px; margin-bottom: 30px; color: #34495e;}
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; text-align: center; }
            th, td { border: 1px solid #bdc3c7; padding: 12px; font-size: 16px; }
            th { background-color: #fcfcfc; font-weight: normal; font-size: 12px; text-transform: uppercase;}
            .bold { font-weight: bold; font-size: 18px; }
            .label { color: #7f8c8d; font-size: 12px; }
            .add-table { width: 50%; margin: 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>VER+ ÓPTICA</h1>
          </div>
          <div style="text-align: right; margin-bottom: 30px;">
            <strong>Paciente:</strong> ${txt(item?.nombre || '-')} <br>
            <strong>Fecha:</strong> ${txt(item?.fecha || '-')}
          </div>
          <div class="title">Receta de Lentes</div>
          <table>
            <tr><th style="border:none; background:none;"></th><th>Esfera</th><th>Cilindro</th><th>Eje</th></tr>
            <tr><td class="label">Lejos OD</td><td class="bold">${txt(item?.esfera_od) || '-'}</td><td class="bold">${txt(item?.cilindro_od) || '-'}</td><td class="bold">${txt(item?.eje_od) || '-'}</td></tr>
            <tr><td class="label">OI</td><td class="bold">${txt(item?.esfera_oi) || '-'}</td><td class="bold">${txt(item?.cilindro_oi) || '-'}</td><td class="bold">${txt(item?.eje_oi) || '-'}</td></tr>
          </table>
          <table class="add-table">
            <tr><th style="border:none; background:none;"></th><th>ADD</th></tr>
            <tr><td class="label">Cerca OD</td><td class="bold">${txt(item?.adicion_od) || '-'}</td></tr>
            <tr><td class="label">OI</td><td class="bold">${txt(item?.adicion_oi) || '-'}</td></tr>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    alCargar(win, () => win.print());
  } catch(e) { console.error(e); }
};

export const imprimirOrdenTrabajo = (item) => {
  try {
    const win = window.open('', '_blank');
    if (!win) {
      mostrarAviso('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para continuar.', 'warning');
      return;
    }
    
    let tratList = [];
    if (item?.tratam_ninguno === 'SI') tratList.push('NINGUNO / BLANCO');
    if (item?.tratam_ar === 'SI') tratList.push('Antirreflejo Verde');
    if (item?.tratam_ar_azul === 'SI') tratList.push('Antirreflejo Azul');
    if (item?.tratam_azul === 'SI') tratList.push('Filtro Azul');
    if (item?.tratam_foto === 'SI') tratList.push(`Fotocromático ${item?.tratam_foto_nota ? '(' + txt(item.tratam_foto_nota) + ')' : ''}`);
    if (item?.tratam_trans === 'SI') tratList.push(`Transition ${item?.tratam_trans_nota ? '(' + txt(item.tratam_trans_nota) + ')' : ''}`);
    if (item?.tratam_tinturado === 'SI') tratList.push(`Tinturado ${item?.tratam_tinturado_nota ? '(' + txt(item.tratam_tinturado_nota) + ')' : ''}`);

    const tratHTML = tratList.length > 0 
        ? tratList.map(t => `<span class="box-item" style="font-size: 13px; font-weight: bold; margin-right: 15px;">${t}</span>`).join('') 
        : `<span class="box-item" style="color: #666; font-style: italic;">Ninguno especificado</span>`;

    win.document.write(`
      <html translate="no">
        <head>
          <title>Orden Laboratorio - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #000; font-size: 12px; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
            .header h1 { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 1px;}
            .row { display: flex; margin-bottom: 10px; }
            .field { flex: 1; border-bottom: 1px solid #000; padding-bottom: 2px; margin-right: 15px; display: flex; }
            .label { font-weight: normal; margin-right: 5px; }
            .value { font-weight: bold; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; text-align: center; }
            th, td { border: 1px solid #000; padding: 5px; }
            th { background-color: #eee; font-size: 11px; font-weight: normal; text-transform: capitalize; }
            td { font-weight: bold; font-size: 13px; }
            .section-title { font-weight: normal; margin: 15px 0 5px 0; font-size: 11px; text-transform: uppercase;}
            .grid-opciones { display: flex; align-items: center; margin-bottom: 5px;}
            .grid-opciones .section-title { width: 150px; margin: 0; }
            .box-group { display: flex; gap: 15px; flex-wrap: wrap; align-items: center; }
            .obs-box { border: 1px solid #000; min-height: 40px; width: 100%; margin-top: 5px; padding: 5px; font-family: monospace; font-weight: bold; font-size: 13px;}
            .footer-contacto { text-align: center; font-size: 12px; color: #000; margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; font-weight: 900; }
          </style>
        </head>
        <body>
          <div class="header">
            <div><h1><strong>VER+ ÓPTICA</strong></h1><p style="margin:2px 0; font-weight: normal; font-size: 11px;">LABORATORIO</p></div>
          </div>
          <div class="row">
            <div class="field" style="flex:2;"><span class="label">Paciente:</span> <span class="value">${txt(item?.nombre || '-')}</span></div>
            <div class="field"><span class="label">Fecha:</span> <span class="value">${txt(item?.fecha || '-')}</span></div>
          </div>
          <table>
            <tr><th style="background: #fff; border: none;"></th><th>Esfera</th><th>Cilindro</th><th>Eje</th><th>DNP</th><th>Adición</th><th>Altura</th></tr>
            <tr><td style="font-weight: normal; border-left: 1px solid #000;">O.D.</td><td>${txt(item?.esfera_od) || '-'}</td><td>${txt(item?.cilindro_od) || '-'}</td><td>${txt(item?.eje_od) || '-'}</td><td>${txt(item?.dnp_od) || '-'}</td><td>${txt(item?.adicion_od) || '-'}</td><td>${txt(item?.altura_od) || '-'}</td></tr>
            <tr><td style="font-weight: normal; border-left: 1px solid #000;">O.I.</td><td>${txt(item?.esfera_oi) || '-'}</td><td>${txt(item?.cilindro_oi) || '-'}</td><td>${txt(item?.eje_oi) || '-'}</td><td>${txt(item?.dnp_oi) || '-'}</td><td>${txt(item?.adicion_oi) || '-'}</td><td>${txt(item?.altura_oi) || '-'}</td></tr>
          </table>
          
          <div class="grid-opciones">
            <div class="section-title">Lente / Material:</div>
            <div class="box-group">
               <div class="box-item"><span class="label">Tipo:</span> <span class="value">${txt(item?.tipo_lente) || '_________________'}</span></div>
               <div class="box-item"><span class="label">Material/Luna:</span> <span class="value">${item?.material_lente === 'Otros' ? txt(item?.material_nota || '') : (txt(item?.material_lente) || '_________________')}</span></div>
            </div>
          </div>

          <div class="grid-opciones">
            <div class="section-title">Tratamientos:</div>
            <div class="box-group">
              ${tratHTML}
            </div>
          </div>

          <div class="grid-opciones" style="margin-top: 15px;">
            <div class="section-title">Armazón:</div>
            <div class="box-group">
               <div class="box-item"><span class="label">Cod:</span> <span class="value">${item?.codigo_armazon === '2905' ? 'DEL PACIENTE' : (txt(item?.codigo_armazon) || '_______')}</span></div>
               <div class="box-item"><span class="label">Tipo:</span> <span class="value">${txt(item?.tipo_armazon) || '_______'}</span></div>
            </div>
          </div>

          <div class="section-title">Medidas de Armazón:</div>
          <table>
            <tr><th>Horizontal</th><th>Puente</th><th>Vertical</th><th>Diám. Diagonal</th></tr>
            <tr><td style="height:25px;">${txt(item?.param_horizontal) || '-'}</td><td>${txt(item?.param_puente) || '-'}</td><td>${txt(item?.param_vertical) || '-'}</td><td>${txt(item?.param_diagonal) || '-'}</td></tr>
          </table>

          <div class="section-title">Observaciones / Notas del Pedido:</div>
          <div class="obs-box">${txt(item?.notas) || ''}</div>
          
          <div class="footer-contacto">
            OPT. XAVIER CELI | 📱 0999911209 / 0988503206 | ✉️ XAVIERCELI@ICLOUD.COM
          </div>
        </body>
      </html>
    `);
    win.document.close();
    alCargar(win, () => win.print());
  } catch(e) { console.error(e); }
};

export const imprimirRecibo = (item) => {
  try {
    const pVenta = safeNum(item?.venta);
    const pDesc = safeNum(item?.descuento);
    const pAbono = safeNum(item?.abono);
    const descAmount = calcularMontoDescuento(pVenta, pDesc);
    const pFinal = calcularTotal(pVenta, pDesc);
    const pSaldo = calcularSaldo(pVenta, pDesc, pAbono);

    const win = window.open('', '_blank');
    if (!win) {
      mostrarAviso('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para continuar.', 'warning');
      return;
    }

    win.document.write(`
      <html translate="no">
        <head>
          <title>Nota de Venta - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            body { font-family: 'Courier New', Courier, monospace; padding: 20px; color: #000; max-width: 350px; margin: auto; font-size: 14px; }
            .text-center { text-align: center; }
            .bold { font-weight: bold; }
            .border-b { border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 5px; }
            .title { font-size: 20px; margin: 5px 0; }
            .footer { font-size: 11px; text-align: center; margin-top: 20px; border-top: 1px dashed #000; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="text-center border-b">
            <div class="title bold">VER+ ÓPTICA</div>
            <div>Darwin Xavier Celi</div>
            <div>📱 0999911209 / 0988503206</div>
            <div style="margin-top:10px; font-size: 16px;" class="bold">NOTA DE VENTA</div>
            <div style="font-size:10px;">(Documento de control interno)</div>
          </div>

          <div class="border-b">
            <div class="row"><span>Fecha:</span> <span>${txt(item?.fecha)}</span></div>
            <div class="row"><span>Paciente:</span> <span class="bold" style="text-align:right;">${txt(item?.nombre)}</span></div>
            <div class="row"><span>Cédula:</span> <span>${txt(item?.cedula)}</span></div>
          </div>

          <div class="border-b">
            <div class="bold" style="margin-bottom: 5px;">Detalle:</div>
            <ul style="margin: 0; padding-left: 15px; font-size: 12px; line-height: 1.6;">
              ${item?.codigo_armazon ? `<li>Armazón: ${item.codigo_armazon === '2905' ? 'Del Paciente' : txt(item.codigo_armazon)}</li>` : ''}
              ${item?.tipo_lente ? `<li>Lentes: ${txt(item.tipo_lente)} (${txt(item.material_lente || '')})</li>` : ''}
              ${item?.tratam_ar === 'SI' ? '<li>+ Antirreflejo Verde</li>' : ''}
              ${item?.tratam_ar_azul === 'SI' ? '<li>+ Antirreflejo Azul</li>' : ''}
              ${item?.tratam_azul === 'SI' ? '<li>+ Filtro Azul</li>' : ''}
              ${item?.tratam_foto === 'SI' ? '<li>+ Fotocromático</li>' : ''}
              ${item?.tratam_trans === 'SI' ? '<li>+ Transition</li>' : ''}
              ${item?.tratam_tinturado === 'SI' ? '<li>+ Tinturado</li>' : ''}
              ${item?.accesorio_id ? '<li>+ Accesorio (Varios)</li>' : ''}
            </ul>
            ${item?.notas ? `<div style="font-size: 11px; margin-top: 8px;"><strong>Notas:</strong> ${txt(item?.notas)}</div>` : ''}
          </div>

          <div class="border-b">
            <div class="row"><span>Subtotal:</span> <span>$${pvpFixed(pVenta)}</span></div>
            ${pDesc > 0 ? `<div class="row"><span>Descuento (${pDesc}%):</span> <span>-$${pvpFixed(descAmount)}</span></div>` : ''}
            <div class="row bold" style="font-size: 16px; margin-top: 5px;"><span>TOTAL A PAGAR:</span> <span>$${pvpFixed(pFinal)}</span></div>
          </div>

          <div class="border-b">
            <div class="row"><span>Forma de Pago:</span> <span>${txt(item?.forma_pago)}</span></div>
            <div class="row"><span>Abono:</span> <span>$${pvpFixed(pAbono)}</span></div>
            <div class="row bold" style="margin-top: 5px;"><span>Saldo Pendiente:</span> <span>$${pvpFixed(pSaldo)}</span></div>
          </div>

          <div class="footer">
            ¡Gracias por confiar en VER+ ÓPTICA para el cuidado de tu salud visual!<br><br>
            Por favor revisa tus medidas y productos al momento de la entrega.
          </div>
        </body>
      </html>
    `);
    win.document.close();
    alCargar(win, () => win.print());
  } catch(e) { console.error(e); }
};

export const imprimirEtiqueta = (item) => {
  try {
    const win = window.open('', '_blank', 'width=500,height=300');
    if (!win) {
      mostrarAviso('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para continuar.', 'warning');
      return;
    }

    const codigoPlano = safeString(item?.codigo) || '0000';
    const codigo = txt(codigoPlano);
    const pvp = safeNum(item?.precio).toFixed(2);
    const modelo = txt(item?.tipo_armazon) + ' ' + txt(item?.material);
    const categoria = txt(item?.categoria) || 'Armazones';

    win.document.write(`
      <html translate="no">
        <head>
          <title>Etiqueta ${codigo}</title>
          <style>
            @page { margin: 0; size: 80mm 15mm; }
            body {
              margin: 0; padding: 0;
              font-family: Arial, sans-serif;
              font-size: 7px;
              color: #000;
              width: 80mm; height: 15mm;
              display: flex;
              align-items: center;
              box-sizing: border-box;
            }
            .side {
              width: 35mm; height: 15mm;
              padding: 2px 4px;
              box-sizing: border-box;
              display: flex; flex-direction: column; justify-content: center;
            }
            .bridge { width: 10mm; height: 15mm; }
            .text-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 1px; }
            .barcode-container { text-align: left; margin-bottom: 1px; margin-left: -2px; }
            .barcode-container svg { height: 6mm !important; width: auto !important; }
            .bold { font-weight: bold; }
          </style>
          <script src="/vendor/JsBarcode.all.min.js"></script>
        </head>
        <body>
          <div class="side">
            <div class="barcode-container"><svg id="barcode"></svg></div>
            <div class="text-line bold" style="font-size: 8px;">PVP $ ${pvp}</div>
            <div class="text-line">VER+ OPTICA</div>
          </div>
          <div class="bridge"></div>
          <div class="side">
            <div class="text-line">${codigo}</div>
            <div class="text-line bold">${modelo}</div>
            <div class="text-line">${categoria}</div>
          </div>
        </body>
      </html>
    `);
    win.document.close();
    alCargar(win, () => {
      try {
        if (typeof win.JsBarcode !== 'function') {
          console.warn('[impresion] El generador de código de barras no está disponible; se imprime sin barras.');
        } else {
          win.JsBarcode('#barcode', codigoPlano, {
            format: 'CODE128',
            displayValue: false,
            height: 25,
            margin: 0,
            width: 1.2
          });
        }
      } catch (e) {
        console.error('[impresion] No se pudo dibujar el código de barras:', e);
      }
      setTimeout(() => { try { win.print(); } catch (e) { console.error(e); } }, 500);
    });
  } catch (e) { console.error(e); }
};
