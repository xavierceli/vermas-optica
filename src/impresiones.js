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
      <!DOCTYPE html>
      <html translate="no">
        <head>
          <meta charset="utf-8">
          <title>Informe - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            @page { size: A4 portrait; margin: 8mm 12mm; }
            * { box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; 
              color: #1e293b; 
              margin: 0; 
              padding: 0; 
              font-size: 11px; 
              line-height: 1.35;
            }
            .header { 
              text-align: center; 
              border-bottom: 2px solid #0f766e; 
              padding-bottom: 8px; 
              margin-bottom: 12px; 
            }
            .header h1 { 
              color: #0f766e; 
              margin: 0; 
              font-size: 20px; 
              letter-spacing: 1.5px;
              font-weight: 900;
            }
            .header h2 { 
              margin: 2px 0 0; 
              color: #475569; 
              font-size: 12px; 
              text-transform: uppercase; 
              letter-spacing: 1px;
            }
            .info-card {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 8px;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              padding: 8px 12px;
              margin-bottom: 12px;
              font-size: 11px;
            }
            .info-item strong { color: #0f766e; display: block; font-size: 10px; text-transform: uppercase; }
            .info-item span { font-weight: bold; color: #0f172a; }
            .section { margin-bottom: 10px; page-break-inside: avoid; }
            .section h3 { 
              color: #0f766e; 
              border-bottom: 1px solid #cbd5e1; 
              padding-bottom: 2px; 
              margin: 0 0 5px 0; 
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            table { width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; }
            th, td { border: 1px solid #cbd5e1; padding: 4px 5px; }
            th { background-color: #f1f5f9; color: #334155; font-weight: 700; font-size: 10px; }
            td strong { color: #0f766e; }
            .text-box { 
              background: #f8fafc; 
              padding: 6px 10px; 
              border: 1px solid #e2e8f0; 
              font-size: 11px; 
              border-radius: 4px; 
              font-weight: 600;
              color: #0f172a;
            }
            .recs-box {
              background: #fafaf9;
              border: 1px solid #e7e5e4;
              border-radius: 4px;
              padding: 6px 10px;
              font-size: 10.5px;
              color: #292524;
              line-height: 1.45;
            }
            .firma-container { 
              margin-top: 24px; 
              text-align: center; 
              page-break-inside: avoid;
            }
            .firma-line { 
              border-top: 1.5px solid #334155; 
              width: 220px; 
              margin: 0 auto; 
              padding-top: 4px; 
              font-weight: 800; 
              font-size: 11px; 
              color: #0f172a;
            }
            .firma-reg { margin: 1px 0 0; font-size: 9.5px; color: #475569; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>VER+ ÓPTICA</h1>
            <h2>Informe Optométrico</h2>
          </div>
          
          <div class="info-card">
            <div class="info-item">
              <strong>Paciente</strong>
              <span>${txt(item?.nombre) || '-'}</span>
            </div>
            <div class="info-item">
              <strong>Cédula de Identidad</strong>
              <span>${txt(item?.cedula) || '-'}</span>
            </div>
            <div class="info-item">
              <strong>Fecha de Examen</strong>
              <span>${txt(item?.fecha) || '-'}</span>
            </div>
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
            <h3>Refracción Final Prescrita</h3>
            <table>
              <tr><th>Ojo</th><th>Esfera</th><th>Cilindro</th><th>Eje</th><th>Add</th><th>DNP</th><th>Cerca (Add)</th><th>A.V.C.L</th><th>A.V.C.C</th></tr>
              <tr><td><strong>OD</strong></td><td>${txt(item?.esfera_od) || '-'}</td><td>${txt(item?.cilindro_od) || '-'}</td><td>${txt(item?.eje_od) || '-'}</td><td>${txt(item?.adicion_od) || '-'}</td><td>${txt(item?.dnp_od) || '-'}</td><td>${txt(calcularCerca(item?.esfera_od, item?.adicion_od)) || '-'}</td><td>${txt(item?.avcl_od) || '-'}</td><td>${txt(item?.avcc_od) || '-'}</td></tr>
              <tr><td><strong>OI</strong></td><td>${txt(item?.esfera_oi) || '-'}</td><td>${txt(item?.cilindro_oi) || '-'}</td><td>${txt(item?.eje_oi) || '-'}</td><td>${txt(item?.adicion_oi) || '-'}</td><td>${txt(item?.dnp_oi) || '-'}</td><td>${txt(calcularCerca(item?.esfera_oi, item?.adicion_oi)) || '-'}</td><td>${txt(item?.avcl_oi) || '-'}</td><td>${txt(item?.avcc_oi) || '-'}</td></tr>
            </table>
          </div>

          <div class="section">
            <h3>Diagnóstico</h3>
            <div class="text-box">${txt(diagnosticos)}</div>
          </div>

          <div class="section">
            <h3>Recomendaciones y Conclusiones</h3>
            <div class="recs-box">
              Utilizar la corrección óptica prescrita, de acuerdo con la fórmula indicada en el presente informe.<br>
              Incluir tratamientos de lentes como Antirreflejo y Protección UV.<br>
              Uso de Lágrimas Artificiales sin conservantes cada 4/6 H.<br><br>
              La fórmula óptica consignada corresponde al estado refractivo del paciente al momento de la evaluación. Se aconseja realizar controles periódicos.
            </div>
          </div>

          <div class="firma-container">
            <div class="firma-line">Darwin Xavier Celi</div>
            <p class="firma-reg">Optómetra | Reg. 2250-2024-8005219</p>
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
      <!DOCTYPE html>
      <html translate="no">
        <head>
          <meta charset="utf-8">
          <title>Receta - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            @page { size: A5 landscape; margin: 8mm 12mm; }
            * { box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; 
              color: #1e293b; 
              margin: 0; 
              padding: 10px 20px; 
              font-size: 12px; 
            }
            .header { text-align: center; border-bottom: 2px solid #0f766e; padding-bottom: 6px; margin-bottom: 12px; }
            .header h1 { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 2px; color: #0f766e; }
            .title { text-align: center; text-transform: uppercase; letter-spacing: 1.5px; font-size: 12px; margin-bottom: 12px; color: #475569; font-weight: 700; }
            .meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 15px; text-align: center; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 10px; font-size: 13px; }
            th { background-color: #f8fafc; font-weight: 700; font-size: 11px; text-transform: uppercase; color: #475569; }
            .bold { font-weight: 800; font-size: 14px; color: #0f172a; }
            .label { font-weight: 700; color: #0f766e; }
            .add-container { display: flex; justify-content: flex-end; margin-bottom: 15px; }
            .add-table { width: 45%; }
            .firma { margin-top: 25px; text-align: center; }
            .firma-line { border-top: 1.5px solid #334155; width: 200px; margin: 0 auto; padding-top: 4px; font-weight: 800; font-size: 11px; }
            .firma-reg { margin: 1px 0 0; font-size: 9.5px; color: #64748b; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>VER+ ÓPTICA</h1>
          </div>
          <div class="meta">
            <div><strong>Paciente:</strong> ${txt(item?.nombre || '-')}</div>
            <div><strong>Fecha:</strong> ${txt(item?.fecha || '-')}</div>
          </div>
          <div class="title">Receta Oftálmica</div>
          <table>
            <tr><th style="width: 25%;">Ojo</th><th>Esfera</th><th>Cilindro</th><th>Eje</th></tr>
            <tr><td class="label">Lejos OD</td><td class="bold">${txt(item?.esfera_od) || '-'}</td><td class="bold">${txt(item?.cilindro_od) || '-'}</td><td class="bold">${txt(item?.eje_od) || '-'}</td></tr>
            <tr><td class="label">Lejos OI</td><td class="bold">${txt(item?.esfera_oi) || '-'}</td><td class="bold">${txt(item?.cilindro_oi) || '-'}</td><td class="bold">${txt(item?.eje_oi) || '-'}</td></tr>
          </table>
          <div class="add-container">
            <table class="add-table">
              <tr><th>Cerca (Add)</th><th>Valor</th></tr>
              <tr><td class="label">OD</td><td class="bold">${txt(item?.adicion_od) || '-'}</td></tr>
              <tr><td class="label">OI</td><td class="bold">${txt(item?.adicion_oi) || '-'}</td></tr>
            </table>
          </div>
          <div class="firma">
            <div class="firma-line">Darwin Xavier Celi</div>
            <p class="firma-reg">Optómetra | Reg. 2250-2024-8005219</p>
          </div>
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
        ? tratList.map(t => `<span class="tag-item">${t}</span>`).join('') 
        : `<span style="color: #64748b; font-style: italic;">Ninguno especificado</span>`;

    win.document.write(`
      <!DOCTYPE html>
      <html translate="no">
        <head>
          <meta charset="utf-8">
          <title>Orden Laboratorio - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            @page { size: A4 portrait; margin: 8mm 12mm; }
            * { box-sizing: border-box; }
            body { 
              font-family: Arial, sans-serif; 
              color: #000; 
              margin: 0; 
              padding: 0; 
              font-size: 11px; 
              line-height: 1.3;
            }
            .header { 
              display: flex; 
              justify-content: space-between; 
              align-items: center; 
              border-bottom: 2px solid #000; 
              padding-bottom: 6px; 
              margin-bottom: 10px; 
            }
            .header h1 { margin: 0; font-size: 18px; font-weight: 900; letter-spacing: 1px; }
            .header p { margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; }
            .row { display: flex; gap: 15px; margin-bottom: 8px; }
            .field { flex: 1; border-bottom: 1px solid #000; padding-bottom: 2px; display: flex; }
            .label { font-weight: normal; margin-right: 5px; color: #333; }
            .value { font-weight: bold; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; text-align: center; }
            th, td { border: 1px solid #000; padding: 4px; }
            th { background-color: #f1f5f9; font-size: 10px; font-weight: bold; }
            td { font-weight: bold; font-size: 12px; }
            .section-title { font-weight: 800; margin: 10px 0 4px 0; font-size: 10.5px; text-transform: uppercase; color: #000; }
            .grid-opciones { display: flex; align-items: flex-start; margin-bottom: 6px; gap: 10px; }
            .grid-opciones .section-title { width: 140px; margin: 0; shrink-0; }
            .box-group { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
            .tag-item { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; font-weight: bold; font-size: 11px; }
            .obs-box { border: 1px solid #000; min-height: 40px; width: 100%; margin-top: 4px; padding: 6px; font-family: monospace; font-weight: bold; font-size: 12px; }
            .footer-contacto { text-align: center; font-size: 10.5px; color: #000; margin-top: 25px; border-top: 1px solid #000; padding-top: 6px; font-weight: 900; }
          </style>
        </head>
        <body>
          <div class="header">
            <div><h1>VER+ ÓPTICA</h1><p>ORDEN DE LABORATORIO</p></div>
          </div>
          <div class="row">
            <div class="field" style="flex:2;"><span class="label">Paciente:</span> <span class="value">${txt(item?.nombre || '-')}</span></div>
            <div class="field"><span class="label">Fecha:</span> <span class="value">${txt(item?.fecha || '-')}</span></div>
          </div>
          <table>
            <tr><th style="background: #fff; border: none; width: 10%;"></th><th>Esfera</th><th>Cilindro</th><th>Eje</th><th>DNP</th><th>Adición</th><th>Altura</th></tr>
            <tr><td style="font-weight: bold; border-left: 1px solid #000;">O.D.</td><td>${txt(item?.esfera_od) || '-'}</td><td>${txt(item?.cilindro_od) || '-'}</td><td>${txt(item?.eje_od) || '-'}</td><td>${txt(item?.dnp_od) || '-'}</td><td>${txt(item?.adicion_od) || '-'}</td><td>${txt(item?.altura_od) || '-'}</td></tr>
            <tr><td style="font-weight: bold; border-left: 1px solid #000;">O.I.</td><td>${txt(item?.esfera_oi) || '-'}</td><td>${txt(item?.cilindro_oi) || '-'}</td><td>${txt(item?.eje_oi) || '-'}</td><td>${txt(item?.dnp_oi) || '-'}</td><td>${txt(item?.adicion_oi) || '-'}</td><td>${txt(item?.altura_oi) || '-'}</td></tr>
          </table>
          
          <div class="grid-opciones">
            <div class="section-title">Lente / Material:</div>
            <div class="box-group">
               <div><span class="label">Tipo:</span> <span class="value">${txt(item?.tipo_lente) || '_________________'}</span></div>
               <div><span class="label">Material/Luna:</span> <span class="value">${item?.material_lente === 'Otros' ? txt(item?.material_nota || '') : (txt(item?.material_lente) || '_________________')}</span></div>
            </div>
          </div>

          <div class="grid-opciones">
            <div class="section-title">Tratamientos:</div>
            <div class="box-group">
              ${tratHTML}
            </div>
          </div>

          <div class="grid-opciones">
            <div class="section-title">Armazón:</div>
            <div class="box-group">
               <div><span class="label">Cod:</span> <span class="value">${item?.codigo_armazon === '2905' ? 'DEL PACIENTE' : (txt(item?.codigo_armazon) || '_______')}</span></div>
               <div><span class="label">Tipo:</span> <span class="value">${txt(item?.tipo_armazon) || '_______'}</span></div>
            </div>
          </div>

          <div class="section-title">Medidas del Armazón:</div>
          <table>
            <tr><th>Horizontal</th><th>Puente</th><th>Vertical</th><th>Diám. Diagonal</th></tr>
            <tr><td style="height:22px;">${txt(item?.param_horizontal) || '-'}</td><td>${txt(item?.param_puente) || '-'}</td><td>${txt(item?.param_vertical) || '-'}</td><td>${txt(item?.param_diagonal) || '-'}</td></tr>
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
      <!DOCTYPE html>
      <html translate="no">
        <head>
          <meta charset="utf-8">
          <title>Nota de Venta - ${txt(item?.nombre || 'Paciente')}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            * { box-sizing: border-box; }
            body { 
              font-family: 'Courier New', Courier, monospace; 
              padding: 0; 
              margin: 0 auto; 
              color: #000; 
              max-width: 76mm; 
              font-size: 12px; 
              line-height: 1.35;
            }
            .text-center { text-align: center; }
            .bold { font-weight: bold; }
            .border-b { border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 6px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
            .title { font-size: 16px; margin: 2px 0; }
            .footer { font-size: 10px; text-align: center; margin-top: 10px; border-top: 1px dashed #000; padding-top: 6px; }
            ul { margin: 0; padding-left: 12px; font-size: 11px; }
          </style>
        </head>
        <body>
          <div class="text-center border-b">
            <div class="title bold">VER+ ÓPTICA</div>
            <div>Darwin Xavier Celi</div>
            <div>📱 0999911209 / 0988503206</div>
            <div style="margin-top:4px; font-size: 13px;" class="bold">NOTA DE VENTA</div>
            <div style="font-size:9px;">(Control Interno)</div>
          </div>

          <div class="border-b">
            <div class="row"><span>Fecha:</span> <span>${txt(item?.fecha)}</span></div>
            <div class="row"><span>Paciente:</span> <span class="bold" style="text-align:right;">${txt(item?.nombre)}</span></div>
            <div class="row"><span>Cédula:</span> <span>${txt(item?.cedula)}</span></div>
          </div>

          <div class="border-b">
            <div class="bold" style="margin-bottom: 3px;">Detalle:</div>
            <ul>
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
            ${item?.notas ? `<div style="font-size: 10px; margin-top: 4px;"><strong>Notas:</strong> ${txt(item?.notas)}</div>` : ''}
          </div>

          <div class="border-b">
            <div class="row"><span>Subtotal:</span> <span>$${pvpFixed(pVenta)}</span></div>
            ${pDesc > 0 ? `<div class="row"><span>Descuento (${pDesc}\%):</span> <span>-$${pvpFixed(descAmount)}</span></div>` : ''}
            <div class="row bold" style="font-size: 14px; margin-top: 4px;"><span>TOTAL A PAGAR:</span> <span>$${pvpFixed(pFinal)}</span></div>
          </div>

          <div class="border-b">
            <div class="row"><span>Forma de Pago:</span> <span>${txt(item?.forma_pago)}</span></div>
            <div class="row"><span>Abono:</span> <span>$${pvpFixed(pAbono)}</span></div>
            <div class="row bold" style="margin-top: 4px;"><span>Saldo Pendiente:</span> <span>$${pvpFixed(pSaldo)}</span></div>
          </div>

          <div class="footer">
            ¡Gracias por confiar en VER+ ÓPTICA para el cuidado de tu salud visual!<br>
            Revisa tus productos al momento de la entrega.
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