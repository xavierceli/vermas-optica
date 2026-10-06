// ---------------------------------------------------------------------------
// CONSULTAS CLINICAS Y ARCHIVADO
// ---------------------------------------------------------------------------
// El expediente clinico del paciente y su archivo. El archivado tiene sus propias
// reglas (marca la cedula como eliminada para que no vuelva a aparecer en ningun
// equipo) y por eso vive aparte de las ventas.
// ---------------------------------------------------------------------------
import { localDb, createUuid, nowIso, pendingRecord, createOutboxOperation, getMeta, setMeta } from '../localDb.js';
import { safeString, archivada, normalizeCedula, fechaHoraActual, patientPayload, consultationPayload, findPatient } from './base.js';

export const guardarConsultaLocalImpl = async ({ patient, consultation }) => {
  const consultationId = consultation.id || createUuid();
  const cedula = normalizeCedula(patient.cedula);

  // 1. Priorizamos buscar paciente existente por cedula normalizada para evitar bifurcaciones de IDs
  let existingPatient = null;
  if (cedula) {
    existingPatient = await findPatient(null, cedula);
  }
  if (!existingPatient && (patient.patient_id || patient.id)) {
    existingPatient = await findPatient(patient.patient_id || patient.id, null);
  }

  // Si ya existia un paciente con esa cedula, adoptamos su ID para mantener la integridad
  const patientId = existingPatient?.id || patient.patient_id || patient.id || createUuid();
  const normalizedPatient = pendingRecord({
    ...patientPayload({ ...patient, id: patientId, cedula })
  });

  // Preservamos la fecha con hora si viene dada, o asignamos fecha y hora completa actual
  const fechaCompleta = consultation.fecha && consultation.fecha.includes(':') 
    ? consultation.fecha 
    : (consultation.fecha ? `${consultation.fecha.slice(0, 10)} ${fechaHoraActual().split(' ')[1]}` : fechaHoraActual());

  const normalizedConsultation = pendingRecord({
    ...consultation,
    id: consultationId,
    patientId,
    fecha: fechaCompleta
  });

  const operation = createOutboxOperation({
    type: 'GUARDAR_CONSULTA',
    entityId: consultationId,
    baseVersion: existingPatient?.version || 0,
    payload: {
      p_consulta_id: consultationId,
      p_payload: { 
        paciente: patientPayload(normalizedPatient), 
        consulta: consultationPayload(normalizedConsultation) 
      }
    }
  });

  await localDb.transaction('rw', localDb.patients, localDb.consultations, localDb.outbox, async () => {
    await localDb.patients.put(normalizedPatient);
    await localDb.consultations.put(normalizedConsultation);
    await localDb.outbox.put(operation);
  });

  return { patientId, consultationId, operationId: operation.id };
};

export const archivarConsultaLocalImpl = async consultationId => {
  const idConsulta = String(consultationId || '').replace(/^remote:/, '');
  const actual = await localDb.consultations.get(idConsulta);
  const enCache = await localDb.cache.get(`remote:${idConsulta}`);
  const fila = actual || enCache;
  if (!fila) return { yaArchivada: true, motivo: 'La consulta ya no existe en este dispositivo.' };
  if (archivada(fila)) return { yaArchivada: true, motivo: 'La consulta ya estaba archivada.' };

  const idPaciente = fila.patientId ?? fila.paciente_id;
  let cedula = safeString(fila.cedula);
  if (!cedula && idPaciente) {
    const paciente = await localDb.patients.get(idPaciente);
    cedula = safeString(paciente?.cedula);
  }
  const cedulaNormalizada = normalizeCedula(cedula);

  const borrados = new Set(await getMeta('cedulasArchivadas', []));
  const borradosServidor = new Set(await getMeta('cedulasArchivadasServidor', []));
  if (cedulaNormalizada) {
    borrados.add(cedulaNormalizada);
    borradosServidor.add(cedulaNormalizada);
  }
  await setMeta('cedulasArchivadas', [...borrados]);
  await setMeta('cedulasArchivadasServidor', [...borradosServidor]);

  await localDb.transaction('rw', localDb.consultations, localDb.patients, localDb.outbox, localDb.cache, async () => {
    const idPacienteArchivo = idPaciente || fila.patientId || fila.paciente_id || null;

    const idsAArchivar = new Set([idConsulta]);
    if (cedulaNormalizada) {
      const locales = await localDb.consultations.toArray();
      for (const c of locales) {
        if (archivada(c)) continue;
        const mismaCedula = normalizeCedula(c.cedula) === cedulaNormalizada;
        const mismoPaciente = idPacienteArchivo && String(c.patientId ?? c.paciente_id ?? '') === String(idPacienteArchivo);
        if (mismaCedula || mismoPaciente) idsAArchivar.add(String(c.id));
      }
      const remotas = await localDb.cache.toArray();
      for (const row of remotas) {
        if (row.kind !== 'historial' || archivada(row)) continue;
        if (normalizeCedula(row.cedula) === cedulaNormalizada) {
          idsAArchivar.add(String(row.id).replace(/^remote:/, ''));
        }
      }
    }

    for (const id of idsAArchivar) {
      const consultation = await localDb.consultations.get(id);
      const enCacheFila = await localDb.cache.get(`remote:${id}`);
      if (consultation) {
        await localDb.consultations.put({ 
          ...consultation, 
          archivedAt: nowIso(), 
          archived_at: nowIso(), 
          syncStatus: 'pending' 
        });
      }

      await localDb.cache.delete(`remote:${id}`);

      if (consultation?.syncStatus === 'synced' || enCacheFila) {
        await localDb.outbox.put(createOutboxOperation({
          type: 'ARCHIVAR_CONSULTA', entityId: id,
          payload: { p_consulta_id: id }
        }));
      }
    }

    if (idPacienteArchivo) {
      const p = await localDb.patients.get(idPacienteArchivo);
      if (p) {
        await localDb.patients.put({ 
          ...p, 
          archivedAt: nowIso(), 
          archived_at: nowIso(), 
          syncStatus: 'synced' 
        });
      }
    }
  });

  return { yaArchivada: false };
};

export const archivarConsultaIndividualLocalImpl = async consultationId => {
  const idConsulta = String(consultationId || '').replace(/^remote:/, '');
  const actual = await localDb.consultations.get(idConsulta);
  const enCache = await localDb.cache.get(`remote:${idConsulta}`);
  const fila = actual || enCache;
  if (!fila) return { yaArchivada: true, motivo: 'La consulta ya no existe en este dispositivo.' };
  if (archivada(fila)) return { yaArchivada: true, motivo: 'La consulta ya estaba archivada.' };

  const ahora = nowIso();
  const consultaLocal = actual || {
    ...enCache,
    id: idConsulta,
    patientId: enCache.patientId ?? enCache.paciente_id ?? enCache.patient_id ?? null
  };
  const operation = createOutboxOperation({
    type: 'ARCHIVAR_CONSULTA',
    entityId: idConsulta,
    payload: { p_consulta_id: idConsulta }
  });
  const operacionesAnteriores = await localDb.outbox.where('entityId').equals(idConsulta).toArray();
  const ultimaCreacion = operacionesAnteriores
    .filter(row => row.type === 'GUARDAR_CONSULTA')
    .reduce((ultima, row) => Math.max(ultima, Date.parse(row.createdAt) || 0), 0);
  if (ultimaCreacion >= Date.parse(operation.createdAt)) {
    operation.createdAt = new Date(ultimaCreacion + 1).toISOString();
    operation.updatedAt = operation.createdAt;
  }

  await localDb.transaction('rw', localDb.consultations, localDb.outbox, localDb.cache, async () => {
    await localDb.consultations.put({
      ...consultaLocal,
      archivedAt: ahora,
      archived_at: ahora,
      syncStatus: 'pending',
      updatedAt: ahora
    });
    await localDb.cache.delete(`remote:${idConsulta}`);
    await localDb.outbox.put(operation);
  });

  return { yaArchivada: false };
};