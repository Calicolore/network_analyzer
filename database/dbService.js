/**
 * ================================================================================
 * MODULO GESTIONE DATABASE SQLITE CON BUFFERING (database/dbService.js)
 * ================================================================================
 * Scrive su SQLite (via `better-sqlite3`, API sincrona) le sessioni/hop/cache
 * provider catturati dal resto del backend. Le sessioni non vengono scritte una per
 * una: si accumulano in mappe in RAM (upsertBuffer/statusBuffer) e vengono
 * riversate su disco in un'unica transazione ogni FLUSH_INTERVAL_MS (vedi
 * flushBuffer), per non fare un I/O sincrono su disco ad ogni singolo pacchetto.
 *
 * Nota: `server/webServer.js` apre una SECONDA connessione allo stesso file SQLite
 * con un driver diverso (`sqlite3`, asincrono) per le query di sola lettura
 * dell'API REST. Le due connessioni convivono correttamente perché qui sotto è
 * attiva la modalità WAL (consente letture concorrenti mentre questo modulo scrive).
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

/**
 * Tabella hops (nodi intermedi di traceroute, uno-a-molti per IP di destinazione).
 * Chiave logica su target_ip (non su session_id): il traceroute è deduplicato per IP,
 * quindi sessioni diverse verso lo stesso IP condividono lo stesso percorso di hop.
 */
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
 *
 * @param {string} table - Nome della tabella da modificare
 * @param {string} columnDef - Definizione SQL della colonna, es. "flow TEXT"
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
safeAddColumn('sessions', 'flow TEXT');

/**
 * Tabella cache provider/ASN: persiste i risultati di ip-api.com tra i riavvii,
 * per evitare di richiamare l'API per IP già arricchiti in precedenza.
 */
const initProviderCacheQuery = `
CREATE TABLE IF NOT EXISTS ip_provider_cache (
    ip TEXT PRIMARY KEY,
    isp TEXT,
    org TEXT,
    asn TEXT,
    provider_label TEXT,
    fetched_at TEXT
);
`;

db.exec(initProviderCacheQuery);

/**
 * ================================================================================
 * RIPRISTINO STATO ALL'AVVIO
 * ================================================================================
 * Riutilizzato anche in closeAllActiveSessions() più sotto, alla chiusura pulita del processo.
 */
const closeActiveOrIdleStmt = db.prepare("UPDATE sessions SET status = 'closed' WHERE status IN ('active', 'idle')");
const result = closeActiveOrIdleStmt.run();
if (result.changes > 0) {
    console.log(`[DATABASE] Ripristinato stato 'closed' per ${result.changes} vecchie sessioni (active/idle).`);
}

console.log('[DATABASE] SQLite connesso e tabella "sessions" verificata.');

// === BUFFER DI SCRITTURA ED ESECUZIONE BATCH ===
const upsertBuffer = new Map();
const statusBuffer = new Map();

/**
 * ================================================================================
 * PREPARED STATEMENT: UPSERT DI UNA SESSIONE
 * ================================================================================
 * Inserisce una nuova sessione, o aggiorna quella esistente con lo stesso session_id
 * (stesso remote_ip:remote_port). L'identificazione della risorsa
 * (services/dnsService.js) può migliorare nel corso della vita di una sessione (es.
 * una risposta DNS arriva dopo i primi pacchetti): per questo `resource_name` viene
 * sostituito solo se il nuovo valore non è il placeholder generico "Risorsa
 * Web"/vuoto (altrimenti si perderebbe un nome già buono), mentre `host_name` viene
 * semplicemente aggiornato al valore più recente (mai peggiore: una volta risolto un
 * nome valido per un IP, dnsService.js lo mette in cache permanente e lo restituisce
 * identico per tutta la vita del processo).
 */
const upsertStmt = db.prepare(`
    INSERT INTO sessions (
        session_id, remote_ip, remote_port, host_name, resource_name,
        technical_subtitle, provider, country, service, total_bytes,
        lat, lon, flow, first_seen, last_seen, status
    ) VALUES (
        @sessionId, @remoteIp, @remotePort, @hostName, @resourceName,
        @technicalSubtitle, @provider, @country, @service, @totalBytes,
        @lat, @lon, @flow, @formattedTime, @formattedTime, 'active'
    )
    ON CONFLICT(session_id) DO UPDATE SET
        total_bytes = @totalBytes,
        last_seen = @formattedTime,
        host_name = COALESCE(excluded.host_name, sessions.host_name),
        resource_name = CASE
            WHEN excluded.resource_name != 'Risorsa Web' AND excluded.resource_name != ''
            THEN excluded.resource_name
            ELSE sessions.resource_name
        END,
        technical_subtitle = COALESCE(excluded.technical_subtitle, sessions.technical_subtitle),
        provider = COALESCE(excluded.provider, sessions.provider),
        lat = COALESCE(excluded.lat, sessions.lat),
        lon = COALESCE(excluded.lon, sessions.lon),
        flow = COALESCE(excluded.flow, sessions.flow),
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

// Prepared statement per la cache persistita dei provider/ASN risolti via ip-api.com
const upsertProviderCacheStmt = db.prepare(`
    INSERT INTO ip_provider_cache (ip, isp, org, asn, provider_label, fetched_at)
    VALUES (@ip, @isp, @org, @asn, @providerLabel, @fetchedAt)
    ON CONFLICT(ip) DO UPDATE SET
        isp = excluded.isp,
        org = excluded.org,
        asn = excluded.asn,
        provider_label = excluded.provider_label,
        fetched_at = excluded.fetched_at;
`);

const updateSessionProviderStmt = db.prepare(`
    UPDATE sessions SET provider = ? WHERE remote_ip = ? AND status IN ('active', 'idle')
`);

/**
 * Applica in un'unica transazione atomica tutti gli upsert e i cambi di stato
 * accumulati dall'ultimo flush (o tutti insieme, o nessuno in caso di errore).
 *
 * @param {object[]} upserts - Righe sessione da inserire/aggiornare (upsertStmt)
 * @param {[string, string][]} statuses - Coppie [sessionId, status] da applicare
 *   dopo gli upsert (statusStmt)
 */
const executeBatchTransaction = db.transaction((upserts, statuses) => {
    for (const sessionData of upserts) {
        upsertStmt.run(sessionData);
    }
    for (const [sessionId, status] of statuses) {
        statusStmt.run(status, sessionId);
    }
});

/**
 * ================================================================================
 * FLUSH DEL BUFFER IN RAM VERSO SQLITE
 * ================================================================================
 * Scrive l'accumulo in memoria su disco in un'unica transazione. In caso di errore
 * i dati vengono rimessi nei buffer invece di essere scartati, così il prossimo
 * flush (o la chiusura pulita del processo) può ritentarli — nulla viene eseguito
 * in modo asincrono tra lo svuotamento e il catch, quindi non c'è rischio di
 * sovrascrivere dati più recenti aggiunti nel frattempo da altro codice.
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

        for (const item of upsertsToFlush) {
            if (!upsertBuffer.has(item.sessionId)) upsertBuffer.set(item.sessionId, item);
        }
        for (const [sessionId, status] of statusesToFlush) {
            if (!statusBuffer.has(sessionId)) statusBuffer.set(sessionId, status);
        }
    }
}

// Flush automatico ogni 2 secondi
const FLUSH_INTERVAL_MS = 2000;
const flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);

/**
 * Accumula o aggiorna una sessione nel buffer in RAM, in attesa del prossimo flush.
 *
 * @param {object} sessionData - Riga sessione da bufferizzare (chiave `sessionId`)
 */
function upsertSession(sessionData) {
    upsertBuffer.set(sessionData.sessionId, sessionData);
}

/**
 * ================================================================================
 * ACCODAMENTO CAMBIO STATO DI UNA SESSIONE
 * ================================================================================
 * Va sempre tramite statusBuffer/statusStmt, mai tramite l'INSERT/UPSERT: quest'ultimo
 * forza sempre status='active' (sia in inserimento sia in conflitto), perché una
 * sessione bufferizzata in upsertBuffer nello stesso ciclo di flush rappresenta
 * traffico appena arrivato quindi per definizione attivo — l'eventuale stato finale
 * 'closed'/'idle' viene applicato SUBITO DOPO, nella stessa transazione, da statusStmt
 * (vedi executeBatchTransaction), sovrascrivendo correttamente il valore.
 *
 * @param {string} sessionId - Identificativo sessione (remoteIp:remotePort)
 * @param {string} status - Nuovo stato, es. 'active', 'idle', 'closed'
 */
function updateSessionStatus(sessionId, status) {
    statusBuffer.set(sessionId, status);
}

/**
 * Esegue il flush dei dati pendenti, ferma il timer di flush automatico e marca come
 * 'closed' tutte le sessioni ancora 'active'/'idle' — usata alla chiusura pulita del processo.
 */
function closeAllActiveSessions() {
    flushBuffer(); // Esegue il flush di ciò che c'era in memoria prima della chiusura
    clearInterval(flushTimer);

    const res = closeActiveOrIdleStmt.run();
    console.log(`[DATABASE] Tutte le sessioni attive e idle sono state segnate come "closed" (${res.changes} sessioni aggiornate).`);
}

/**
 * Salva o aggiorna un singolo hop di traceroute per un IP di destinazione.
 * Scrittura diretta (non bufferizzata): il volume di hop è molto più basso di quello dei pacchetti.
 *
 * @param {object} hopData - Dati dell'hop (targetIp, hopNumber, ip, lat, lon, country, city, provider)
 */
function upsertHop(hopData) {
    try {
        upsertHopStmt.run(hopData);
    } catch (err) {
        console.error('[DATABASE] Errore durante il salvataggio dell\'hop di traceroute:', err.message);
    }
}

/**
 * Salva/aggiorna in modo permanente il risultato di un lookup provider/ASN (ip-api.com).
 * Scrittura diretta (non bufferizzata): un IP viene risolto una sola volta e mai più.
 *
 * @param {object} data - Risultato del lookup (ip, isp, org, asn, providerLabel, fetchedAt)
 */
function upsertProviderCache(data) {
    try {
        upsertProviderCacheStmt.run(data);
    } catch (err) {
        console.error('[DATABASE] Errore durante il salvataggio della cache provider:', err.message);
    }
}

/**
 * Carica in memoria l'intera cache provider persistita, da usare all'avvio per
 * evitare di richiamare l'API esterna per IP già risolti in run precedenti.
 *
 * @returns {object[]} Tutte le righe di ip_provider_cache (array vuoto in caso di errore)
 */
function getAllProviderCache() {
    try {
        return db.prepare('SELECT * FROM ip_provider_cache').all();
    } catch (err) {
        console.error('[DATABASE] Errore durante il caricamento della cache provider:', err.message);
        return [];
    }
}

/**
 * Aggiorna il campo provider delle sessioni attive/idle già create per un IP,
 * usato quando il risultato di ip-api.com arriva dopo la creazione della card.
 *
 * @param {string} remoteIp - IP remoto la cui sessione va aggiornata
 * @param {string} providerLabel - Nome del provider/ISP risolto
 */
function updateSessionProvider(remoteIp, providerLabel) {
    try {
        updateSessionProviderStmt.run(providerLabel, remoteIp);
    } catch (err) {
        console.error('[DATABASE] Errore durante l\'aggiornamento del provider di sessione:', err.message);
    }
}

module.exports = {
    upsertSession,
    updateSessionStatus,
    closeAllActiveSessions,
    flushBuffer,
    upsertHop,
    upsertProviderCache,
    getAllProviderCache,
    updateSessionProvider
};