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

// CREAZIONE TABELLA SESSIONS
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
    first_seen TEXT,
    last_seen TEXT,
    status TEXT DEFAULT 'active'
);
`;

db.exec(initQuery);

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
        first_seen, last_seen, status
    ) VALUES (
        @sessionId, @remoteIp, @remotePort, @hostName, @resourceName,
        @technicalSubtitle, @provider, @country, @service, @totalBytes,
        @formattedTime, @formattedTime, 'active'
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
        status = 'active';
`);

const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE session_id = ?');

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

module.exports = {
    db,
    upsertSession,
    updateSessionStatus,
    closeAllActiveSessions,
    flushBuffer
};