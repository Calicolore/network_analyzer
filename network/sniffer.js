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