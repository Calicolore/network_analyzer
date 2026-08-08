/**
 * ====================================================================================
 * ENTRY POINT PRINCIPALE E ORCHESTRATORE APPLICATIVO (app.js)
 * ====================================================================================
 * 
 * SCOPO DEL MODULO:
 * Inizializzare l'infrastruttura di backend, integrare i server web e gli sniffer di rete,
 * e orchestrare i vari servizi dedicati (DNS, porte, traceroute) per elaborare i pacchetti
 * in tempo reale e trasmetterli al frontend via WebSocket.
 * 
 * FUNZIONAMENTO GENERALE:
 * 1. Avvio Server e Network: Rileva l'IP locale del dispositivo e avvia il server Web / Socket.io.
 * 2. Sniffing dei Pacchetti: Attiva l'ascolto della scheda di rete per intercettare i pacchetti in transito.
 * 3. Gestione DNS Intercettati: Invia il payload dei pacchetti DNS al servizio di tracciamento nomi (`dnsService`).
 * 4. Elaborazione Sessione: Esclude il traffico locale/web-app, calcola le metriche di traffico (byte/KB)
 *    e assegna un colore univoco a ciascuna sessione.
 * 5. Rilevamento Chiusura Connessione: Monitora i flag TCP (FIN / RST) per identificare la fine di una sessione.
 * 6. Arricchimento Dati: Risolve il nome del servizio/dominio e recupera la geolocalizzazione dell'IP remoto.
 * 7. Invio Real-Time: Emette gli eventi `new_packet` o `session_closed` verso la dashboard per l'aggiornamento dinamico.
 * ====================================================================================
 */

require('dotenv').config();
const geoip = require('geoip-lite');

// Moduli di rete e server web
const { initSniffer } = require('./network/sniffer');
const { startServer } = require('./server/webServer');

// Utility di rete e supporto
const { generateRandomColor, getNetworkDeviceIP, translateFlags } = require('./utils/networkUtils');

// Servizi specializzati
const { resolveResourceDetails, recordDnsQuery } = require('./services/dnsService');
const { getServiceName } = require('./services/portService');
const { runNativeTraceroute } = require('./services/traceroute');

// ====================================================================================
// PASSO 1: INIZIALIZZAZIONE SERVER E RETE
// ====================================================================================

// Rileva l'indirizzo IP dell'interfaccia di rete attiva nel sistema
const myIp = getNetworkDeviceIP();
const webPort = 3000; 

// Avvia il server HTTP Express e Socket.io
const io = startServer(webPort);

console.log(`[SISTEMA] IP Monitorato: ${myIp}`);

// Registri di stato in memoria per la gestione delle sessioni attive
const sessionColors = new Map();     // Mappa sessionId -> Colore HEX unico
const sessionTotalBytes = new Map(); // Mappa sessionId -> Totale Byte accumulati

// ====================================================================================
// PASSO 2: AVVIO DELLO SNIFFER E CATTURA PACCHETTI
// ====================================================================================

initSniffer(myIp, async (packet) => {

    // A) Intercettazione e registrazione delle query DNS
    if (packet.type === 'DNS') {
        recordDnsQuery(packet.payload);
        return;
    }

    // B) Filtro di sicurezza: Ignoriamo il traffico WebSocket generato dalla dashboard stessa
    if (packet.srcPort === webPort || packet.dstPort === webPort) return;

    // C) Determinazione della direzione della comunicazione (Inbound / Outbound)
    const isOutbound = packet.src === myIp;
    const remoteIp = isOutbound ? packet.dst : packet.src;
    const remotePort = isOutbound ? packet.dstPort : packet.srcPort;
    const sessionId = `${remoteIp}:${remotePort}`;

    // ================================================================================
    // PASSO 3: GESTIONE SESSIONI, COLORI E TRACEROUTE
    // ================================================================================

    // Assegnazione colore univoco alla sessione e avvio del traceroute se la sessione è nuova
    if (!sessionColors.has(sessionId)) {
        sessionColors.set(sessionId, generateRandomColor());
        
        // Avvia il traceroute solo per indirizzi IP pubblici (non locali/loopback)
        if (!remoteIp.startsWith('192.168.') && !remoteIp.startsWith('127.')) {
            runNativeTraceroute(remoteIp, io);
        }
    }
    const sessionColor = sessionColors.get(sessionId);
    
    // ================================================================================
    // PASSO 4: CALCOLO DEL TRAFFICO DATI
    // ================================================================================

    // Aggiornamento del contatore cumulativo dei byte trasferiti nella sessione
    let totalBytes = (sessionTotalBytes.get(sessionId) || 0) + (packet.size || 0);
    sessionTotalBytes.set(sessionId, totalBytes);
    const totalKB = (totalBytes / 1024).toFixed(2);

    // ================================================================================
    // PASSO 5: ARRICCHIMENTO DATI (DNS, NOME SERVIZIO, GEOLOCALIZZAZIONE)
    // ================================================================================

    // Risoluzione dei dettagli DNS procedurale (Titolo risorsa e Sottotitolo tecnico)
    // Passiamo packet.payload per permettere anche il controllo TLS SNI
    const { hostName, resourceName, technicalSubtitle, provider } = await resolveResourceDetails(remoteIp, packet.payload);
    
    // Identificazione del nome del servizio/protocollo
    const serviceName = getServiceName(remotePort, packet.service);

    // Recupero delle coordinate geografiche dell'IP remoto per la mappa
    const geo = geoip.lookup(remoteIp);
    const lat = geo ? geo.ll[0] : null;
    const lon = geo ? geo.ll[1] : null;

    // Traduzione e analisi dei flag TCP per la gestione dello stato della connessione
    const readableFlags = translateFlags(packet.flags);

    // ================================================================================
    // PASSO 6: EMISSIONE WEBSOCKET AL FRONTEND
    // ================================================================================

    // Estrazione della dimensione del pacchetto (supporta vari formati di pcap/raw-socket)
    const packetSizeBytes = packet.size || packet.length || packet.len || (packet.pcap_header ? packet.pcap_header.len : 0) || 0;

    io.emit('new_packet', {
        sessionId,
        remoteIp,
        hostName,
        resourceName,
        technicalSubtitle,
        provider: provider,
        totalKB,
        size: packetSizeBytes, 
        isOutbound: isOutbound, 
        remotePort,
        sessionColor,
        service: serviceName,
        country: packet.country,
        lat, 
        lon,
        direction: isOutbound ? "-->" : "<--",
        flags: readableFlags,
        time: packet.timestamp
    });

    // ================================================================================
    // PASSO 7: RILEVAMENTO E NOTIFICA CHIUSURA CONNESSIONE (TCP FIN / RST)
    // ================================================================================

    // Se i flag indicano la chiusura del socket (FIN o RST), notifichiamo il client
    if (readableFlags.includes('FIN') || readableFlags.includes('RST')) {
        io.emit('session_closed', {
            sessionId,
            reason: readableFlags.includes('RST') ? 'Reset' : 'Finished'
        });

        // Pulizia dello stato in memoria della sessione terminata
        sessionColors.delete(sessionId);
        sessionTotalBytes.delete(sessionId);
    }
});