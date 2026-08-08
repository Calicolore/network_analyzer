/**
 * ====================================================================================
 * SERVIZIO WEB SERVER E WEBSOCKET (server/webServer.js)
 * ====================================================================================
 * 
 * SCOPO DEL MODULO:
 * Creare e gestire il server HTTP Express e il canale WebSocket Socket.io per erogare 
 * l'interfaccia grafica utente (dashboard) e trasmettere gli aggiornamenti di rete in real-time.
 * 
 * FUNZIONAMENTO GENERALE:
 * 1. Hosting Statico: Espone i file del client (HTML, CSS, JS) contenuti nella cartella `public/`.
 * 2. Inizializzazione WebSocket: Abilita il server Socket.io per la comunicazione bidirezionale a bassa latenza.
 * 3. Geolocalizzazione Dinamica del Client: All'atto della connessione di un client web, interroga 
 *    i servizi esterni (`ipapi.co` e fallback `ip-api.com`) per identificare le coordinate geografiche (lat/lon)
 *    dell'IP pubblico locale e centrare la mappa della dashboard sulla posizione dell'utente.
 * ====================================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const geoip = require('geoip-lite'); // Usato come eventuale fallback locale per la geolocalizzazione

/**
 * Configura e avvia il server HTTP Express con supporto Socket.io
 * 
 * @param {number} port - Porta di ascolto del server Web (es. 3000)
 * @returns {Server} Istanza del server Socket.io per l'emissione degli eventi verso il frontend
 */
function startServer(port) {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    // PASSO 1: Configurazione del middleware per la fruizione dei file statici del frontend
    app.use(express.static(path.join(__dirname, '../public')));

    // PASSO 2: Gestione dell'evento di connessione del client Web alla dashboard
    io.on('connection', async (socket) => {
        console.log('[DASHBOARD] Client connesso via Socket.io');

        let dynamicHomeCoords = null; 
        
        // PASSO 3A: Tentativo 1 via ipapi.co
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

        // PASSO 3B: Tentativo 2 via ip-api.com (Fallback)
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

        // PASSO 3C: Coordinate predefinite di estremo fallback (es. Urbino)
        if (!dynamicHomeCoords) {
            dynamicHomeCoords = [43.7257, 12.6357];
        }

        // PASSO 4: Invia le coordinate iniziali di centratura al client appena connesso
        socket.emit('home_location', { coords: dynamicHomeCoords });
    });

    // PASSO 5: Avvio dell'ascolto HTTP sulla porta specificata
    server.listen(port, () => {
        console.log(`[DASHBOARD] Disponibile su http://localhost:${port}`);
    });

    return io;
}

module.exports = { startServer };