/**
 * ================================================================================
 * ENTRY POINT PRINCIPALE E ORCHESTRATORE APPLICATIVO (app.js)
 * ================================================================================
 * Questo modulo costituisce il core dell'applicazione backend. Gestisce l'inizializzazione
 * delle variabili d'ambiente, avvia il server Web e Socket.IO, configura lo sniffer di rete,
 * elabora i pacchetti catturati, li accumula in un buffer e distribuisce i dati al client
 * via WebSocket a intervalli regolari (batch).
 * ================================================================================
 */

// ================================================================================
// PASSO 1: IMPORTAZIONE DIPENDENZE E MODULI INTERNI
// ================================================================================
require('dotenv').config();
const geoip = require('geoip-lite');

const { initSniffer } = require('./network/sniffer');
const { startServer } = require('./server/webServer');
const { generateRandomColor, getNetworkDeviceIP, translateFlags, isPrivateIp } = require('./utils/networkUtils');
const { resolveResourceDetails, recordDnsQuery } = require('./services/dnsService');
const { getServiceName } = require('./services/portService');
const { runNativeTraceroute } = require('./services/traceroute');
const { enqueueProviderLookup, getCachedProvider } = require('./services/providerService');
const { upsertSession, updateSessionStatus, closeAllActiveSessions, updateSessionProvider } = require('./database/dbService');

// ================================================================================
// PASSO 2: CONFIGURAZIONE INIZIALE ED AVVIO SERVER WEB / SOCKET.IO
// ================================================================================
const myIp = getNetworkDeviceIP();
const webPort = 3000; 

const io = startServer(webPort);

console.log(`[SISTEMA] IP Monitorato: ${myIp}`);

// Helper per formattare data e ora complete (GG/MM/AAAA, HH:mm:ss)
function getFullFormattedDateTime(rawTime) {
    const dateObj = rawTime ? new Date(rawTime) : new Date();
    const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;
    
    return validDate.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// ================================================================================
// PASSO 3: INIZIALIZZAZIONE MAPPE DI STATO, SESSIONI E BUFFER WEBSOCKET
// ================================================================================
const sessionColors = new Map();        // Traccia il colore univoco associato a ciascuna sessione (IP:Porta)
const sessionTotalBytes = new Map();    // Traccia il volume di traffico accumulato in byte per ciascuna sessione
const sessionLastSeen = new Map();      // Traccia l'ultimo timestamp (ms) di attività della sessione
const sessionResourceNames = new Map(); // Traccia il nome della risorsa assegnata alla sessione

// Buffer backend per l'emissione in batch verso il client
const packetBuffer = [];
const FLUSH_INTERVAL_MS = 100; // Invia i pacchetti accumulati ogni 100ms

setInterval(() => {
    if (packetBuffer.length > 0) {
        const batch = packetBuffer.splice(0, packetBuffer.length);
        // Nome evento allineato al listener 'packet_batch' lato client (dashboard.js)
        io.emit('packet_batch', batch);
        // Retrocompatibilità per eventuali listener client che ascoltano eventi singoli
        batch.forEach(pkt => io.emit('new_packet', pkt));
    }
}, FLUSH_INTERVAL_MS);

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

        // Esegue il traceroute e la risoluzione provider solo per indirizzi pubblici
        if (!isPrivateIp(remoteIp)) {
            runNativeTraceroute(remoteIp, io);

            // Arricchimento provider asincrono, non bloccante (fire-and-forget)
            enqueueProviderLookup(remoteIp, (ip, result) => {
                updateSessionProvider(ip, result.providerLabel);
                io.emit('provider_resolved', {
                    remoteIp: ip,
                    provider: result.providerLabel,
                    isp: result.isp,
                    asn: result.asn
                });
            });
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
    const { hostName, resourceName, technicalSubtitle, provider: detectedProvider, flow } = await resolveResourceDetails(remoteIp, packet.payload);

    // Se ip-api.com ha già risolto questo IP, il suo risultato ha priorità sull'euristica hardcoded
    const cachedProviderInfo = getCachedProvider(remoteIp);
    const provider = cachedProviderInfo ? cachedProviderInfo.providerLabel : detectedProvider;

    sessionLastSeen.set(sessionId, Date.now());
    sessionResourceNames.set(sessionId, resourceName);
    
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
    const formattedTime = getFullFormattedDateTime(packet.timestamp);

    const packetData = {
        sessionId,
        remoteIp,
        hostName,
        resourceName,
        technicalSubtitle,
        provider,
        flow,
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
        time: formattedTime
    };

    // ================================================================================
    // FASE 11: INSERIMENTO NEL BUFFER WEBSOCKET E SALVATAGGIO DATABASE
    // ================================================================================
    packetBuffer.push(packetData);

    // Salvataggio / Aggiornamento in tempo reale nel Database SQLite
    upsertSession({
        sessionId,
        remoteIp,
        remotePort,
        hostName,
        resourceName,
        technicalSubtitle,
        provider,
        country: packet.country || 'N/A',
        service: serviceName,
        totalBytes,
        lat,
        lon,
        flow: flow || null,
        formattedTime
    });

    // ================================================================================
    // FASE 12: GESTIONE CHIUSURA SESSIONE (FLAG FIN O RST)
    // ================================================================================
    if (readableFlags.includes('FIN') || readableFlags.includes('RST')) {
        io.emit('session_closed', {
            sessionId,
            reason: readableFlags.includes('RST') ? 'Reset' : 'Finished'
        });

        // Aggiorna lo stato nel database
        updateSessionStatus(sessionId, 'closed');

        // Pulizia delle mappe in memoria per liberare risorse
        sessionColors.delete(sessionId);
        sessionTotalBytes.delete(sessionId);
        sessionLastSeen.delete(sessionId);
        sessionResourceNames.delete(sessionId);
    }
});

// ================================================================================
// PASSO 5: PULIZIA AUTOMATICA CONNESSIONI INATTIVE ("Risorsa Web")
// ================================================================================
const IDLE_TIMEOUT_MS = 20 * 1000;    // Tempo max di inattività (20 secondi)
const CLEANUP_CHECK_MS = 5 * 1000;    // Controllo ogni 5 secondi

setInterval(() => {
    const now = Date.now();

    for (const [sessionId, lastSeen] of sessionLastSeen.entries()) {
        const resourceName = sessionResourceNames.get(sessionId) || '';
        
        // Individua risorse anonime/generiche
        const isAnonymous = resourceName === 'Risorsa Web' || resourceName === '' || resourceName.includes('1e100.net');
        const isIdle = (now - lastSeen) >= IDLE_TIMEOUT_MS;

        if (isAnonymous && isIdle) {
            console.log(`[CLEANUP] Chiusa risorsa inattiva per timeout: ${sessionId} (${resourceName})`);

            // Notifica il Frontend via Socket per aggiornare o ingrigire la card
            io.emit('session_closed', {
                sessionId,
                reason: 'Idle Timeout'
            });

            // Aggiorna lo stato nel database
            updateSessionStatus(sessionId, 'idle');

            // Rimuovi le informazioni dalla memoria backend
            sessionColors.delete(sessionId);
            sessionTotalBytes.delete(sessionId);
            sessionLastSeen.delete(sessionId);
            sessionResourceNames.delete(sessionId);
        }
    }
}, CLEANUP_CHECK_MS);

// ================================================================================
// PASSO 6: GESTIONE CHIUSURA PULITA DEL PROCESSO
// ================================================================================
function handleShutdown() {
    console.log('\n[SISTEMA] Chiusura applicazione in corso...');
    closeAllActiveSessions();
    process.exit(0);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);