/**
 * ====================================================================================
 * SERVIZIO SNIFFER DI RETE (network/sniffer.js)
 * ====================================================================================
 * 
 * SCOPO DEL MODULO:
 * Intercettare e decodificare a basso livello i pacchetti di rete (Ethernet/IPv4) in transito 
 * sulla scheda di rete locale selezionata utilizzando la libreria nativa `cap`.
 * 
 * FUNZIONAMENTO GENERALE:
 * 1. Selezione Interfaccia: Individua la scheda di rete attiva confrontando l'IP locale del dispositivo.
 * 2. Apertura Socket Raw: Configura un buffer circolare di cattura e apre l'interfaccia in modalità ascolto.
 * 3. Decodifica a Livelli (OSI Stack):
 *    - Livello 2 (Ethernet): Identifica se il pacchetto è di tipo IPv4.
 *    - Livello 3 (IP): Estrae indirizzi IP di origine/destinazione e la dimensione del pacchetto.
 *    - Livello 4 (TCP/UDP): Decodifica i numeri di porta e le flag per TCP, oppure cattura il payload grezzo per le query DNS su porta 53.
 * 4. Normalizzazione e Callback: Arricchisce i dati estratti con la geolocalizzazione dell'IP remoto 
 *    e notifica il gestore principale tramite la callback `onPacketCaptured`.
 * ====================================================================================
 */

const { Cap, decoders } = require('cap');
const geoip = require('geoip-lite');
const PROTOCOL = decoders.PROTOCOL;

/**
 * Tabella interna per la risoluzione immediata dei servizi basata sulla porta di destinazione
 */
const SERVICE_MAP = {
    80: 'HTTP',
    443: 'HTTPS',
    53: 'DNS',
    22: 'SSH',
    21: 'FTP',
    25: 'SMTP',
    3306: 'MySQL',
    5432: 'PostgreSQL',
    3000: 'Node.js'
};

/**
 * Mappa la porta di rete al nome del servizio corrispondente
 * 
 * @param {number} port - Porta di destinazione
 * @returns {string} Nome del servizio o etichetta con numero porta
 */
function getServiceName(port) {
    return SERVICE_MAP[port] || `Port: ${port}`;
}

/**
 * Inizializza lo sniffer sulla scheda di rete corrispondente all'IP fornito
 * 
 * @param {string} deviceIp - Indirizzo IP IPv4 dell'interfaccia da monitorare
 * @param {Function} onPacketCaptured - Callback invocata ad ogni pacchetto elaborato
 */
function initSniffer(deviceIp, onPacketCaptured) {
    const c = new Cap();
    const list = Cap.deviceList();
    
    // PASSO 1: Ricerca della scheda di rete fisica associata all'IP locale attivo
    const device = list.find(d => d.addresses.some(addr => addr.addr === deviceIp));

    if (!device) {
        console.error("ERRORE: Impossibile trovare la scheda di rete con IP:", deviceIp);
        return;
    }

    // Configurazione del buffer di cattura (10 MB per evitare perdita di pacchetti)
    const filter = ''; 
    const bufSize = 10 * 1024 * 1024;
    const buffer = Buffer.alloc(65535);

    // PASSO 2: Apertura dell'interfaccia di rete
    c.open(device.name, filter, bufSize, buffer);

    // PASSO 3: Evento di cattura pacchetto in streaming
    c.on('packet', () => {
        // Decodifica Livello 2 (Ethernet)
        let ret = decoders.Ethernet(buffer);

        // Verifica che il frame trasporti traffico IPv4
        if (ret.info.type === PROTOCOL.ETHERNET.IPV4) {
            // Decodifica Livello 3 (IP)
            ret = decoders.IPV4(buffer, ret.offset);
            const srcIp = ret.info.srcaddr;
            const dstIp = ret.info.dstaddr;
            const packetSize = ret.info.totallen; // Dimensione totale del pacchetto IP in byte

            // PASSO 4A: Gestione del protocollo TCP
            if (ret.info.protocol === PROTOCOL.IP.TCP) {
                ret = decoders.TCP(buffer, ret.offset);
                const remoteIp = (srcIp === deviceIp) ? dstIp : srcIp;
                const geo = geoip.lookup(remoteIp);

                onPacketCaptured({
                    type: 'TCP',
                    src: srcIp,
                    dst: dstIp,
                    srcPort: ret.info.srcport,
                    dstPort: ret.info.dstport,
                    service: getServiceName(ret.info.dstport),
                    country: geo ? geo.country : '??',
                    flags: ret.info.flags,
                    size: packetSize, 
                    timestamp: new Date().toLocaleTimeString('it-IT')
                });
            } 
            // PASSO 4B: Gestione del protocollo UDP (Filtro specifico per query/risposte DNS su porta 53)
            else if (ret.info.protocol === PROTOCOL.IP.UDP) {
                ret = decoders.UDP(buffer, ret.offset);
                if (ret.info.srcport === 53 || ret.info.dstport === 53) {
                    onPacketCaptured({
                        type: 'DNS',
                        src: srcIp,
                        dst: dstIp,
                        payload: Buffer.from(buffer.slice(ret.offset, ret.offset + ret.info.length)),
                        timestamp: new Date().toLocaleTimeString('it-IT')
                    });
                }
            }
        }
    });
}

module.exports = { initSniffer };