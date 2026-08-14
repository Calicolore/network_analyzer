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

    // PASSO 2: API REST per il recupero di tutte le sessioni dal database
    app.get('/api/sessions', (req, res) => {
        const query = 'SELECT * FROM sessions ORDER BY last_seen DESC';
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('[DATABASE] Errore durante la query:', err.message);
                return res.status(500).json({ error: 'Errore interno del database' });
            }
            res.json(rows);
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