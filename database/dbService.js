/**
 * ================================================================================
 * MODULO GESTIONE DATABASE SQLITE CON BUFFERING (database/dbService.js)
 * ================================================================================
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'network_analyzer.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// CREAZIONE TABELLA SESSIONS (include lat/lon per la ricostruzione della mappa da DB importato)
const initQuery = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    remote_ip TEXT NOT NULL,
    remote_port INTEGER,
    host_name TEXT,
    resource_name TEXT,
    technical_subtitle TEXT,
    provider TEXT,
    country TEXT,
    service TEXT,
    total_bytes INTEGER DEFAULT 0,
    lat REAL,
    lon REAL,
    first_seen TEXT,
    last_seen TEXT,
    status TEXT DEFAULT 'active'
);
`;

db.exec(initQuery);

// CREAZIONE TABELLA HOPS (nodi intermedi di traceroute, uno-a-molti per IP di destinazione)
// Chiave logica su target_ip (non su session_id): il traceroute è deduplicato per IP,
// quindi sessioni diverse verso lo stesso IP condividono lo stesso percorso di hop.
const initHopsQuery = `
CREATE TABLE IF NOT EXISTS hops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_ip TEXT NOT NULL,
    hop_number INTEGER NOT NULL,
    ip TEXT NOT NULL,
    lat REAL,
    lon REAL,
    country TEXT,
    city TEXT,
    provider TEXT,
    UNIQUE(target_ip, hop_number)
);
CREATE INDEX IF NOT EXISTS idx_hops_target_ip ON hops(target_ip);
`;

db.exec(initHopsQuery);

/**
 * Aggiunge una colonna a una tabella esistente solo se non è già presente.
 * Necessario per i DB creati con lo schema precedente (privo di lat/lon),
 * dato che "CREATE TABLE IF NOT EXISTS" non altera tabelle già esistenti.
 */
function safeAddColumn(table, columnDef) {
    try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
        console.log(`[DATABASE] Migrazione applicata: ${table}.${columnDef}`);
    } catch (err) {
        if (!/duplicate column name/i.test(err.message)) {
            console.error(`[DATABASE] Errore migrazione colonna (${table}.${columnDef}):`, err.message);
        }
    }
}

safeAddColumn('sessions', 'lat REAL');
safeAddColumn('sessions', 'lon REAL');

// === RIPRISTINO STATO ALL'AVVIO ===
const resetStmt = db.prepare("UPDATE sessions SET status = 'closed' WHERE status IN ('active', 'idle')");
const result = resetStmt.run();
if (result.changes > 0) {
    console.log(`[DATABASE] Ripristinato stato 'closed' per ${result.changes} vecchie sessioni (active/idle).`);
}

console.log('[DATABASE] SQLite connesso e tabella "sessions" verificata.');

// === BUFFER DI SCRITTURA ED ESECUZIONE BATCH ===
const upsertBuffer = new Map();
const statusBuffer = new Map();

// Prepared Statements compilati una sola volta
const upsertStmt = db.prepare(`
    INSERT INTO sessions (
        session_id, remote_ip, remote_port, host_name, resource_name,
        technical_subtitle, provider, country, service, total_bytes,
        lat, lon, first_seen, last_seen, status
    ) VALUES (
        @sessionId, @remoteIp, @remotePort, @hostName, @resourceName,
        @technicalSubtitle, @provider, @country, @service, @totalBytes,
        @lat, @lon, @formattedTime, @formattedTime, 'active'
    )
    ON CONFLICT(session_id) DO UPDATE SET
        total_bytes = @totalBytes,
        last_seen = @formattedTime,
        resource_name = CASE 
            WHEN excluded.resource_name != 'Risorsa Web' AND excluded.resource_name != '' 
            THEN excluded.resource_name 
            ELSE sessions.resource_name 
        END,
        technical_subtitle = COALESCE(excluded.technical_subtitle, sessions.technical_subtitle),
        provider = COALESCE(excluded.provider, sessions.provider),
        lat = COALESCE(excluded.lat, sessions.lat),
        lon = COALESCE(excluded.lon, sessions.lon),
        status = 'active';
`);

const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE session_id = ?');

// Prepared statement per l'inserimento/aggiornamento dei nodi di traceroute (scrittura diretta, bassa frequenza)
const upsertHopStmt = db.prepare(`
    INSERT INTO hops (target_ip, hop_number, ip, lat, lon, country, city, provider)
    VALUES (@targetIp, @hopNumber, @ip, @lat, @lon, @country, @city, @provider)
    ON CONFLICT(target_ip, hop_number) DO UPDATE SET
        ip = excluded.ip,
        lat = excluded.lat,
        lon = excluded.lon,
        country = excluded.country,
        city = excluded.city,
        provider = excluded.provider;
`);

const getHopsByTargetIpStmt = db.prepare('SELECT hop_number, ip, lat, lon, country, city, provider FROM hops WHERE target_ip = ? ORDER BY hop_number ASC');

// Transazione batch atomica
const executeBatchTransaction = db.transaction((upserts, statuses) => {
    for (const sessionData of upserts) {
        upsertStmt.run(sessionData);
    }
    for (const [sessionId, status] of statuses) {
        statusStmt.run(status, sessionId);
    }
});

/**
 * Scrive l'accumulo in memoria su disco in un'unica transazione
 */
function flushBuffer() {
    if (upsertBuffer.size === 0 && statusBuffer.size === 0) return;

    const upsertsToFlush = Array.from(upsertBuffer.values());
    const statusesToFlush = Array.from(statusBuffer.entries());

    upsertBuffer.clear();
    statusBuffer.clear();

    try {
        executeBatchTransaction(upsertsToFlush, statusesToFlush);
    } catch (err) {
        console.error('[DATABASE] Errore durante il flush del buffer nel DB:', err);
    }
}

// Flush automatico ogni 2 secondi
const FLUSH_INTERVAL_MS = 2000;
const flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);

/**
 * Accumula o aggiorna una sessione nel buffer in RAM
 */
function upsertSession(sessionData) {
    upsertBuffer.set(sessionData.sessionId, sessionData);
}

/**
 * Mette in coda il cambio stato di una sessione
 */
function updateSessionStatus(sessionId, status) {
    if (upsertBuffer.has(sessionId)) {
        upsertBuffer.get(sessionId).status = status;
    }
    statusBuffer.set(sessionId, status);
}

/**
 * Chiude le sessioni ed esegue prima il flush dei dati pendenti
 */
function closeAllActiveSessions() {
    flushBuffer(); // Esegue il flush di ciò che c'era in memoria prima della chiusura
    clearInterval(flushTimer);

    const stmt = db.prepare("UPDATE sessions SET status = 'closed' WHERE status IN ('active', 'idle')");
    const res = stmt.run();
    console.log(`[DATABASE] Tutte le sessioni attive e idle sono state segnate come "closed" (${res.changes} sessioni aggiornate).`);
}

/**
 * Salva o aggiorna un singolo hop di traceroute per un IP di destinazione.
 * Scrittura diretta (non bufferizzata): il volume di hop è molto più basso di quello dei pacchetti.
 */
function upsertHop(hopData) {
    try {
        upsertHopStmt.run(hopData);
    } catch (err) {
        console.error('[DATABASE] Errore durante il salvataggio dell\'hop di traceroute:', err.message);
    }
}

/**
 * Recupera, in ordine, tutti gli hop di traceroute registrati per un IP di destinazione
 */
function getHopsByTargetIp(targetIp) {
    try {
        return getHopsByTargetIpStmt.all(targetIp);
    } catch (err) {
        console.error('[DATABASE] Errore durante il recupero degli hop:', err.message);
        return [];
    }
}

module.exports = {
    db,
    upsertSession,
    updateSessionStatus,
    closeAllActiveSessions,
    flushBuffer,
    upsertHop,
    getHopsByTargetIp
};