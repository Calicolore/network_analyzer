/**
 * ================================================================================
 * ENTRY POINT PRINCIPALE E ORCHESTRATORE APPLICATIVO (app.js)
 * ================================================================================
 * Questo modulo costituisce il core dell'applicazione backend. Gestisce l'inizializzazione
 * delle variabili d'ambiente, avvia il server Web e Socket.IO, configura lo sniffer di rete,
 * elabora i pacchetti catturati e distribuisce i dati al client via WebSocket in tempo reale.
 * ================================================================================
 */

// ================================================================================
// PASSO 1: IMPORTAZIONE DIPENDENZE E MODULI INTERNI
// ================================================================================
require('dotenv').config();
const geoip = require('geoip-lite');

const { initSniffer } = require('./network/sniffer');
const { startServer } = require('./server/webServer');
const { generateRandomColor, getNetworkDeviceIP, translateFlags } = require('./utils/networkUtils');
const { resolveResourceDetails, recordDnsQuery } = require('./services/dnsService');
const { getServiceName } = require('./services/portService');
const { runNativeTraceroute } = require('./services/traceroute');

// ================================================================================
// PASSO 2: CONFIGURAZIONE INIZIALE ED AVVIO SERVER WEB / SOCKET.IO
// ================================================================================
const myIp = getNetworkDeviceIP();
const webPort = 3000; 

const io = startServer(webPort);

console.log(`[SISTEMA] IP Monitorato: ${myIp}`);

// ================================================================================
// PASSO 3: INIZIALIZZAZIONE MAPPE DI STATO E SESSIONI
// ================================================================================
const sessionColors = new Map();     // Traccia il colore univoco associato a ciascuna sessione (IP:Porta)
const sessionTotalBytes = new Map(); // Traccia il volume di traffico accumulato in byte per ciascuna sessione

// ================================================================================
// PASSO 4: INIZIALIZZAZIONE DELLO SNIFFER DI RETE ED ELABORAZIONE PACCHETTI
// ================================================================================
initSniffer(myIp, async (packet) => {

    // ================================================================================
    // FASE 1: GESTIONE PRIORITARIA PACCHETTI DNS
    // ================================================================================
    if (packet.type === 'DNS') {
        recordDnsQuery(packet.payload);
        return;
    }

    // ================================================================================
    // FASE 2: FILTRO TRAFFICO GENERATO DALLA DASHBOARD
    // ================================================================================
    if (packet.srcPort === webPort || packet.dstPort === webPort) return;

    // ================================================================================
    // FASE 3: CALCOLO DIREZIONE E IDENTIFICATIVO SESSIONE
    // ================================================================================
    const isOutbound = packet.src === myIp;
    const remoteIp = isOutbound ? packet.dst : packet.src;
    const remotePort = isOutbound ? packet.dstPort : packet.srcPort;
    const sessionId = `${remoteIp}:${remotePort}`;

    // ================================================================================
    // FASE 4: REGISTRAZIONE SESSIONE, COLORE ED ESECUZIONE TRACEROUTE
    // ================================================================================
    if (!sessionColors.has(sessionId)) {
        sessionColors.set(sessionId, generateRandomColor());
        
        // Esegue il traceroute solo per indirizzi pubblici (escludendo reti locali e loopback)
        if (!remoteIp.startsWith('192.168.') && !remoteIp.startsWith('127.')) {
            runNativeTraceroute(remoteIp, io);
        }
    }
    const sessionColor = sessionColors.get(sessionId);

    // ================================================================================
    // FASE 5: ACCUMULO E CALCOLO VOLUME DI TRAFFICO (KB)
    // ================================================================================
    let totalBytes = (sessionTotalBytes.get(sessionId) || 0) + (packet.size || 0);
    sessionTotalBytes.set(sessionId, totalBytes);
    const totalKB = (totalBytes / 1024).toFixed(2);

    // ================================================================================
    // FASE 6: RISOLUZIONE DETTAGLI RISORSA (DNS, SNI TLS, PROVIDER)
    // ================================================================================
    const { hostName, resourceName, technicalSubtitle, provider } = await resolveResourceDetails(remoteIp, packet.payload);
    
    // ================================================================================
    // FASE 7: IDENTIFICAZIONE SERVIZIO / PROTOCOLLO APPLICATIVO
    // ================================================================================
    const serviceName = getServiceName(remotePort, packet.service);

    // ================================================================================
    // FASE 8: GEOLOCALIZZAZIONE IP REMOTO
    // ================================================================================
    const geo = geoip.lookup(remoteIp);
    const lat = geo ? geo.ll[0] : null;
    const lon = geo ? geo.ll[1] : null;

    // ================================================================================
    // FASE 9: TRADUZIONE FLAG TCP E DIMENSIONE PACCHETTO
    // ================================================================================
    const readableFlags = translateFlags(packet.flags);
    const packetSizeBytes = packet.size || packet.length || packet.len || (packet.pcap_header ? packet.pcap_header.len : 0) || 0;

    // ================================================================================
    // FASE 10: COSTRUZIONE DTO METADATI PACCHETTO
    // ================================================================================
    const packetData = {
        sessionId,
        remoteIp,
        hostName,
        resourceName,
        technicalSubtitle,
        provider,
        totalKB,
        size: packetSizeBytes, 
        isOutbound, 
        remotePort,
        sessionColor,
        service: serviceName,
        country: packet.country,
        lat, 
        lon,
        direction: isOutbound ? "-->" : "<--",
        flags: readableFlags,
        time: packet.timestamp
    };

    // ================================================================================
    // FASE 11: EMISSIONE WEBSOCKET IMMEDIATA AL FRONTEND (IN TEMPO REALE)
    // ================================================================================
    io.emit('new_packet', packetData);

    // ================================================================================
    // FASE 12: GESTIONE CHIUSURA SESSIONE (FLAG FIN O RST)
    // ================================================================================
    if (readableFlags.includes('FIN') || readableFlags.includes('RST')) {
        io.emit('session_closed', {
            sessionId,
            reason: readableFlags.includes('RST') ? 'Reset' : 'Finished'
        });

        // Pulizia delle mappe in memoria per liberare risorse
        sessionColors.delete(sessionId);
        sessionTotalBytes.delete(sessionId);
    }
});