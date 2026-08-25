/**
 * ====================================================================================
 * SERVIZIO SNIFFER DI RETE (network/sniffer.js)
 * ====================================================================================
 */

const { Cap, decoders } = require('cap');
const geoip = require('geoip-lite');
const PROTOCOL = decoders.PROTOCOL;

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

function getServiceName(port) {
    return SERVICE_MAP[port] || `Port: ${port}`;
}

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
    const buffer = Buffer.alloc(65535);

    c.open(device.name, filter, bufSize, buffer);

    c.on('packet', () => {
        let ret = decoders.Ethernet(buffer);

        if (ret.info.type === PROTOCOL.ETHERNET.IPV4) {
            ret = decoders.IPV4(buffer, ret.offset);
            const srcIp = ret.info.srcaddr;
            const dstIp = ret.info.dstaddr;
            const packetSize = ret.info.totallen;

            // --- GESTIONE TCP ---
            if (ret.info.protocol === PROTOCOL.IP.TCP) {
                ret = decoders.TCP(buffer, ret.offset);
                const remoteIp = (srcIp === deviceIp) ? dstIp : srcIp;
                const geo = geoip.lookup(remoteIp);
                const srcPort = ret.info.srcport;
                const dstPort = ret.info.dstport;

                // Cattura selettiva del payload applicativo: serve solo per estrarre l'SNI
                // dal ClientHello TLS (porta 443/8443) o l'header Host: da richieste HTTP in
                // chiaro (porta 80). Copiata SEMPRE con Buffer.from(...) perché `buffer` è un
                // unico Buffer riutilizzato per ogni pacchetto catturato (vedi riga ~40).
                let capturedPayload = null;
                const payloadOffset = ret.offset;
                const payloadLen = packetSize - payloadOffset;

                if (payloadLen > 0) {
                    const isTlsPort = dstPort === 443 || dstPort === 8443 || srcPort === 443 || srcPort === 8443;
                    const isHttpPort = dstPort === 80 || srcPort === 80;

                    if (isTlsPort || isHttpPort) {
                        const MAX_CAPTURE = 4096;
                        const end = Math.min(buffer.length, payloadOffset + Math.min(payloadLen, MAX_CAPTURE));
                        const firstByte = buffer[payloadOffset];

                        // TLS Handshake (ClientHello) inizia sempre con 0x16: scarta a costo
                        // zero i pacchetti successivi di una connessione TLS già stabilita.
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
                    service: getServiceName(dstPort),
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
                        service: getServiceName(ret.info.dstport),
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