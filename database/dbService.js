/**
 * ================================================================================
 * MODULO GESTIONE DATABASE SQLITE (database/dbService.js)
 * ================================================================================
 * Gestisce l'inizializzazione del database SQLite locale e le query per la 
 * persistenza dello storico delle sessioni di rete e i dati analitici.
 * ================================================================================
 */

const Database = require('better-sqlite3');
const path = require('path');

// Percorso del file SQLite all'interno della cartella database
const dbPath = path.join(__dirname, 'network_analyzer.db');
const db = new Database(dbPath);

// Abilita la modalità WAL (Write-Ahead Logging) per prestazioni di scrittura elevate
db.pragma('journal_mode = WAL');

// ================================================================================
// CREAZIONE TABELLA SESSIONS (Se non esiste)
// ================================================================================
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

console.log('[DATABASE] SQLite connesso e tabella "sessions" verificata.');

/**
 * Salva o aggiorna una sessione nel Database
 */
function upsertSession(sessionData) {
    const query = `
        INSERT INTO sessions (
            session_id, remote_ip, remote_port, host_name, resource_name,
            technical_subtitle, provider, country, service, total_bytes,
            first_seen, last_seen, status
        ) VALUES (
            @sessionId, @remoteIp, @remotePort, @hostName, @resourceName,
            @technicalSubtitle, @provider, @country, @service, @totalBytes,
            @time, @time, 'active'
        )
        ON CONFLICT(session_id) DO UPDATE SET
            total_bytes = @totalBytes,
            last_seen = @time,
            resource_name = CASE 
                WHEN excluded.resource_name != 'Risorsa Web' AND excluded.resource_name != '' 
                THEN excluded.resource_name 
                ELSE sessions.resource_name 
            END,
            technical_subtitle = COALESCE(excluded.technical_subtitle, sessions.technical_subtitle),
            provider = COALESCE(excluded.provider, sessions.provider),
            status = 'active';
    `;

    const stmt = db.prepare(query);
    stmt.run(sessionData);
}

/**
 * Aggiorna lo stato di una sessione (es. 'closed' o 'idle')
 */
function updateSessionStatus(sessionId, status) {
    const stmt = db.prepare('UPDATE sessions SET status = ? WHERE session_id = ?');
    stmt.run(status, sessionId);
}

module.exports = {
    db,
    upsertSession,
    updateSessionStatus
};