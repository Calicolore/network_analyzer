/**
 * ====================================================================================
 * SERVIZIO SNIFFER DI RETE (network/sniffer.js)
 * ====================================================================================
 * Cattura a basso livello (libreria `cap`, binding di libpcap/Npcap) tutto il traffico
 * Ethernet/IPv4 sull'interfaccia di rete indicata, decodifica gli header TCP/UDP/DNS e
 * invoca `onPacketCaptured(packet)` (app.js) per ciascun pacchetto con i soli dati
 * rilevanti (IP/porte sorgente-destinazione, dimensione, paese, flag TCP, ed
 * eventualmente il payload applicativo per SNI/DNS). Nessuna logica di identificazione
 * risorsa/servizio/provider vive qui: è solo il livello di cattura/decodifica.
 * ====================================================================================
 */

const { Cap, decoders } = require('cap');
const geoip = require('geoip-lite');
const PROTOCOL = decoders.PROTOCOL;

/**
 * Nota: l'identificazione del nome servizio a partire dalla porta è demandata interamente
 * a services/portService.js (già invocato in app.js per ogni pacchetto tramite
 * getServiceName(remotePort, ...)). Non va duplicata qui: una mappa porta->servizio locale
 * in questo file "vincerebbe" sempre come fallback passato a portService.js, rendendo di
 * fatto irraggiungibile la tabella più completa (e l'unica fonte di verità) di quel modulo.
 */

/**
 * Avvia la cattura sulla scheda di rete con l'IP indicato e registra il callback che
 * riceve ogni pacchetto TCP/UDP/DNS decodificato.
 *
 * @param {string} deviceIp - IP locale della scheda di rete da cui catturare
 * @param {(packet: object) => void} onPacketCaptured - invocata per ogni pacchetto
 */
function initSniffer(deviceIp, onPacketCaptured) {
    const c = new Cap();
    const list = Cap.deviceList();

    const device = list.find(d => d.addresses.some(addr => addr.addr === deviceIp));

    if (!device) {
        console.error("ERRORE: Impossibile trovare la scheda di rete con IP:", deviceIp);
        return;
    }

    const filter = '';
    const bufSize = 10 * 1024 * 1024;
    /**
     * Snaplen: 65535 byte, ben oltre l'MTU Ethernet reale (~1500-9000 con jumbo frame),
     * quindi un pacchetto legittimo non risulta mai troncato.
     */
    const buffer = Buffer.alloc(65535);

    c.open(device.name, filter, bufSize, buffer);

    /**
     * Nota: l'evento 'packet' della libreria `cap` passa anche (nbytes, trunc) — quanti byte
     * sono stati effettivamente catturati e se il pacchetto è stato troncato dal driver.
     * Non li usiamo: col buffer di cattura sovradimensionato sopra, per il traffico reale di
     * rete non si verifica mai un troncamento, quindi decodificare sempre da `buffer` (che
     * contiene esattamente i byte dell'ultimo pacchetto ricevuto) è sicuro.
     */
    c.on('packet', () => {
        let ret = decoders.Ethernet(buffer);

        if (ret.info.type === PROTOCOL.ETHERNET.IPV4) {
            ret = decoders.IPV4(buffer, ret.offset);
            const srcIp = ret.info.srcaddr;
            const dstIp = ret.info.dstaddr;
            const packetSize = ret.info.totallen;
            /** Va letto ORA: il prossimo decode (TCP/UDP) sovrascrive `ret`. */
            const ipHeaderLen = ret.hdrlen;

            // --- GESTIONE TCP ---
            if (ret.info.protocol === PROTOCOL.IP.TCP) {
                ret = decoders.TCP(buffer, ret.offset);
                const remoteIp = (srcIp === deviceIp) ? dstIp : srcIp;
                const geo = geoip.lookup(remoteIp);
                const srcPort = ret.info.srcport;
                const dstPort = ret.info.dstport;

                /**
                 * Cattura selettiva del payload applicativo: serve solo per estrarre l'SNI
                 * dal ClientHello TLS (porta 443/8443) o l'header Host: da richieste HTTP in
                 * chiaro (porta 80). Copiata SEMPRE con Buffer.from(...) perché `buffer` è un
                 * unico Buffer riutilizzato per ogni pacchetto catturato (vedi riga ~40).
                 */
                let capturedPayload = null;
                const payloadOffset = ret.offset;
                /**
                 * packetSize (IP totallen) è relativo al livello IP e NON include l'header
                 * Ethernet, mentre payloadOffset è un offset assoluto nel buffer (che invece
                 * lo include): sottrarli direttamente sottostimerebbe la lunghezza reale del
                 * payload di 14+ byte. Va invece calcolato per sottrazione di header IP/TCP,
                 * rimanendo sempre nello stesso "livello" (pattern raccomandato dalla libreria
                 * `cap`, vedi il suo stesso README).
                 */
                const payloadLen = packetSize - ipHeaderLen - ret.hdrlen;

                if (payloadLen > 0) {
                    const isTlsPort = dstPort === 443 || dstPort === 8443 || srcPort === 443 || srcPort === 8443;
                    const isHttpPort = dstPort === 80 || srcPort === 80;

                    if (isTlsPort || isHttpPort) {
                        const MAX_CAPTURE = 4096;
                        const end = Math.min(buffer.length, payloadOffset + Math.min(payloadLen, MAX_CAPTURE));
                        const firstByte = buffer[payloadOffset];

                        /**
                         * TLS Handshake (ClientHello) inizia sempre con 0x16: scarta a costo
                         * zero i pacchetti successivi di una connessione TLS già stabilita.
                         */
                        if ((isTlsPort && firstByte === 0x16) || isHttpPort) {
                            capturedPayload = Buffer.from(buffer.slice(payloadOffset, end));
                        }
                    }
                }

                onPacketCaptured({
                    type: 'TCP',
                    src: srcIp,
                    dst: dstIp,
                    srcPort,
                    dstPort,
                    country: geo ? geo.country : '??',
                    flags: ret.info.flags,
                    size: packetSize,
                    payload: capturedPayload,
                    timestamp: new Date().toLocaleTimeString('it-IT')
                });
            }
            // --- GESTIONE UDP (Include DNS e QUIC/YouTube) ---
            else if (ret.info.protocol === PROTOCOL.IP.UDP) {
                ret = decoders.UDP(buffer, ret.offset);
                
                // Query DNS
                if (ret.info.srcport === 53 || ret.info.dstport === 53) {
                    onPacketCaptured({
                        type: 'DNS',
                        src: srcIp,
                        dst: dstIp,
                        payload: Buffer.from(buffer.slice(ret.offset, ret.offset + ret.info.length)),
                        timestamp: new Date().toLocaleTimeString('it-IT')
                    });
                } 
                // Traffico UDP generico (Streaming YouTube/QUIC, WebRTC, ecc.)
                else {
                    const remoteIp = (srcIp === deviceIp) ? dstIp : srcIp;
                    const geo = geoip.lookup(remoteIp);

                    onPacketCaptured({
                        type: 'UDP',
                        src: srcIp,
                        dst: dstIp,
                        srcPort: ret.info.srcport,
                        dstPort: ret.info.dstport,
                        country: geo ? geo.country : '??',
                        flags: [],
                        size: packetSize, 
                        timestamp: new Date().toLocaleTimeString('it-IT')
                    });
                }
            }
        }
    });
}

module.exports = { initSniffer };