// Preparación común de los tests de render (Vitest + jsdom).
// IndexedDB en memoria: varios componentes tocan la base local vía Dexie al
// montarse, y jsdom no trae IndexedDB.
import 'fake-indexeddb/auto';
