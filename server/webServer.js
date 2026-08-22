/**
 * ====================================================================================
 * SERVIZIO WEB SERVER E WEBSOCKET (server/webServer.js)
 * ====================================================================================
 * 
 * SCOPO DEL MODULO:
 * Creare e gestire il server HTTP Express e il canale WebSocket Socket.io per erogare 
 * l'interfaccia grafica utente (dashboard) e trasmettere gli aggiornamenti di rete in real-time.
 * Inserito endpoint API per la consultazione del database SQLite.
 * ====================================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const geoip = require('geoip-lite'); // Usato come eventuale fallback locale per la geolocalizzazione

/**
 * Configura e avvia il server HTTP Express con supporto Socket.io e API SQLite
 * 
 * @param {number} port - Porta di ascolto del server Web (es. 3000)
 * @returns {Server} Istanza del server Socket.io per l'emissione degli eventi verso il frontend
 */
function startServer(port) {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    // Connessione al Database SQLite
    const dbPath = path.join(__dirname, '../database/network_analyzer.db');
    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('[DATABASE] Errore di connessione a SQLite:', err.message);
        } else {
            console.log('[DATABASE] Connesso con successo a SQLite (network_analyzer.db)');
        }
    });

    // PASSO 1: Configurazione del middleware per la fruizione dei file statici del frontend
    app.use(express.static(path.join(__dirname, '../public')));

    // PASSO 2: API REST con Paginazione SQL, Filtri Temporali e Statistiche Globali
    app.get('/api/sessions', (req, res) => {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const offset = (page - 1) * limit;
        const timePreset = req.query.timePreset || 'all';
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const exportAll = req.query.exportAll === 'true';

        let whereClauses = [];
        let params = [];

        // Filtri temporali in SQL
        if (timePreset === '1h') {
            whereClauses.push("last_seen >= datetime('now', '-1 hour')");
        } else if (timePreset === 'today') {
            whereClauses.push("last_seen >= datetime('now', 'start of day')");
        } else if (timePreset === '7d') {
            whereClauses.push("last_seen >= datetime('now', '-7 days')");
        } else if (timePreset === 'custom' && startDate && endDate) {
            whereClauses.push("last_seen BETWEEN ? AND ?");
            params.push(startDate, endDate);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Query 1: Calcolo metriche globali sull'intero DB (o sull'intervallo temporale selezionato)
        const statsQuery = `
            SELECT 
                COUNT(*) AS totalConnections,
                COALESCE(SUM(total_bytes), 0) AS totalBytes,
                COUNT(DISTINCT country) AS totalCountries
            FROM sessions ${whereSql}
        `;

        db.get(statsQuery, params, (err, statsRow) => {
            if (err) {
                console.error('[DATABASE] Errore calcolo KPI:', err.message);
                return res.status(500).json({ error: 'Errore interno del database' });
            }

            // Query 2: Recupero dei record paginati per la tabella
            let dataQuery = `SELECT * FROM sessions ${whereSql} ORDER BY last_seen DESC`;
            let dataParams = [...params];

            if (!exportAll) {
                dataQuery += ` LIMIT ? OFFSET ?`;
                dataParams.push(limit, offset);
            }

            db.all(dataQuery, dataParams, (err, rows) => {
                if (err) {
                    console.error('[DATABASE] Errore durante la query dati:', err.message);
                    return res.status(500).json({ error: 'Errore interno del database' });
                }

                const total = statsRow ? statsRow.totalConnections : 0;
                const totalPages = Math.ceil(total / limit) || 1;

                const respond = (rowsWithHops) => {
                    res.json({
                        data: rowsWithHops,
                        pagination: {
                            total: total,
                            page: page,
                            limit: limit,
                            totalPages: totalPages
                        },
                        stats: {
                            totalConnections: total,
                            totalBytes: statsRow ? statsRow.totalBytes : 0,
                            totalCountries: statsRow ? statsRow.totalCountries : 0
                        }
                    });
                };

                if (rows.length === 0) {
                    return respond(rows);
                }

                // Query 3: Recupero degli hop di traceroute per gli IP presenti nella pagina corrente.
                // Necessario per ricostruire l'intero percorso sulla mappa quando il DB viene esportato/importato.
                const distinctIps = [...new Set(rows.map(r => r.remote_ip))];
                const placeholders = distinctIps.map(() => '?').join(',');
                const hopsQuery = `SELECT * FROM hops WHERE target_ip IN (${placeholders}) ORDER BY target_ip, hop_number ASC`;

                db.all(hopsQuery, distinctIps, (hopsErr, hopRows) => {
                    if (hopsErr) {
                        console.error('[DATABASE] Errore durante il recupero degli hop:', hopsErr.message);
                        // Non blocchiamo la risposta principale per un errore sugli hop: sessioni senza percorso completo
                        return respond(rows.map(r => ({ ...r, hops: [] })));
                    }

                    const hopsByIp = {};
                    for (const hop of hopRows) {
                        if (!hopsByIp[hop.target_ip]) hopsByIp[hop.target_ip] = [];
                        hopsByIp[hop.target_ip].push(hop);
                    }

                    const rowsWithHops = rows.map(r => ({ ...r, hops: hopsByIp[r.remote_ip] || [] }));
                    respond(rowsWithHops);
                });
            });
        });
    });

    // PASSO 3: Gestione dell'evento di connessione del client Web alla dashboard
    io.on('connection', async (socket) => {
        console.log('[DASHBOARD] Client connesso via Socket.io');

        let dynamicHomeCoords = null; 
        
        // Tentativo 1 via ipapi.co
        try {
            const response = await fetch('https://ipapi.co/json/');
            const geoData = await response.json();
            
            if (geoData.latitude && geoData.longitude) {
                dynamicHomeCoords = [geoData.latitude, geoData.longitude];
                console.log(`[GEOLOC] Posizione rilevata dinamicamente (ipapi): ${geoData.city} [${dynamicHomeCoords}]`);
            }
        } catch (err) {
            console.log("[GEOLOC] ipapi.co fallito, provo fallback su ip-api.com...");
        }

        // Tentativo 2 via ip-api.com (Fallback)
        if (!dynamicHomeCoords) {
            try {
                const response = await fetch('http://ip-api.com/json/');
                const geoData = await response.json();
                if (geoData.lat && geoData.lon) {
                    dynamicHomeCoords = [geoData.lat, geoData.lon];
                    console.log(`[GEOLOC] Posizione rilevata dinamicamente (ip-api): ${geoData.city} [${dynamicHomeCoords}]`);
                }
            } catch (err) {
                console.log("[GEOLOC] Impossibile recuperare l'IP pubblico locale da server.");
            }
        }

        // Coordinate predefinite di estremo fallback
        if (!dynamicHomeCoords) {
            dynamicHomeCoords = [43.7257, 12.6357];
        }

        // Invia le coordinate iniziali di centratura al client appena connesso
        socket.emit('home_location', { coords: dynamicHomeCoords });
    });

    // PASSO 4: Avvio dell'ascolto HTTP sulla porta specificata
    server.listen(port, () => {
        console.log(`[DASHBOARD] Disponibile su http://localhost:${port}`);
    });

    return io;
}

module.exports = { startServer };