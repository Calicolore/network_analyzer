/**
 * ====================================================================================
 * SERVIZIO STIMA SICUREZZA CONNESSIONE (services/securityService.js)
 * ====================================================================================
 * Stima un livello di sicurezza per una sessione a partire da segnali osservabili SENZA
 * decifrare alcun traffico: porta in chiaro (HTTP/80) e, per le connessioni TLS, la
 * versione del protocollo negoziata (letta dal ClientHello: legacy_version, o
 * l'estensione supported_versions se presente — l'unico modo per rilevare TLS 1.3, dato
 * che il legacy_version resta sempre fissato a 0x0303 per compatibilità all'indietro).
 *
 * NOTA: la stima si basa solo sul ClientHello (ciò che il CLIENT è disposto a offrire),
 * non sul ServerHello (ciò che viene realmente negoziato tra client e server): è
 * un'approssimazione ragionevole, non la cifratura reale della sessione — leggere anche
 * il ServerHello richiederebbe un secondo punto di parsing, fuori scope per questa prima
 * versione.
 * ====================================================================================
 */

const securityCache = new Map(); // sessionId -> { level, label }, risolto una sola volta

const TLS_VERSION_LABELS = {
    0x0300: 'SSL 3.0',
    0x0301: 'TLS 1.0',
    0x0302: 'TLS 1.1',
    0x0303: 'TLS 1.2',
    0x0304: 'TLS 1.3'
};

/**
 * Classifica una versione TLS/SSL numerica in un livello di sicurezza.
 *
 * @param {number} version - Versione a 16 bit (es. 0x0303 per TLS 1.2)
 * @returns {{level: string, label: string}} Livello ('secure'|'adequate'|'weak') ed
 *   etichetta leggibile per l'interfaccia
 */
function classifyTlsVersion(version) {
    const versionLabel = TLS_VERSION_LABELS[version] || `0x${version.toString(16)}`;
    if (version >= 0x0304) return { level: 'secure', label: `Sicura (${versionLabel})` };
    if (version === 0x0303) return { level: 'adequate', label: `Adeguata (${versionLabel})` };
    return { level: 'weak', label: `Debole (${versionLabel})` };
}

/**
 * ====================================================================================
 * PARSING DELLA VERSIONE TLS DAL CLIENTHELLO (parsing manuale byte-a-byte)
 * ====================================================================================
 * Stessa struttura attraversata da dnsService.js/extractSNIFromTLS (duplicata qui
 * volutamente per mantenere il modulo indipendente): legge il legacy_version fisso,
 * poi scandisce le extension cercando supported_versions (tipo 43), l'unico modo per
 * scoprire se il client ha negoziato realmente TLS 1.3.
 *
 * @param {Buffer} buffer - Payload TCP grezzo catturato, atteso un ClientHello TLS
 * @returns {{level: string, label: string}|null} Livello di sicurezza stimato, o null
 *   per qualunque payload che non sia un ClientHello riconoscibile
 */
function parseClientHelloVersion(buffer) {
    try {
        if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 43) return null;
        if (buffer[0] !== 0x16) return null;

        let offset = 5;
        if (buffer[offset] !== 0x01) return null;

        const legacyVersion = buffer.readUInt16BE(9);
        offset += 38;
        if (offset >= buffer.length) return null;

        const sessionIDLength = buffer[offset];
        offset += 1 + sessionIDLength;

        if (offset + 2 > buffer.length) return null;
        const cipherSuitesLength = buffer.readUInt16BE(offset);
        offset += 2 + cipherSuitesLength;

        if (offset >= buffer.length) return null;
        const compressionMethodsLength = buffer[offset];
        offset += 1 + compressionMethodsLength;

        if (offset + 2 > buffer.length) return null;
        const extensionsLength = buffer.readUInt16BE(offset);
        offset += 2;

        let negotiatedVersion = legacyVersion;
        const extEnd = offset + extensionsLength;

        while (offset + 4 < extEnd && offset + 4 < buffer.length) {
            const extType = buffer.readUInt16BE(offset);
            const extLen = buffer.readUInt16BE(offset + 2);
            offset += 4;

            // Estensione supported_versions: unico modo per rilevare TLS 1.3 reale
            if (extType === 43 && offset < buffer.length) {
                const listLength = buffer[offset];
                for (let i = 0; i + 2 <= listLength && offset + 1 + i + 2 <= buffer.length; i += 2) {
                    const candidate = buffer.readUInt16BE(offset + 1 + i);
                    if (candidate > negotiatedVersion) negotiatedVersion = candidate;
                }
            }
            offset += extLen;
        }

        return classifyTlsVersion(negotiatedVersion);
    } catch (e) {
        return null;
    }
}

/**
 * ====================================================================================
 * STIMA DEL LIVELLO DI SICUREZZA DI UNA SESSIONE (con cache per sessione)
 * ====================================================================================
 * Restituisce un livello di sicurezza stimato per la sessione, senza decifrare alcun
 * traffico: la porta 80 (HTTP in chiaro) è sempre "insecure"; per le altre porte, se è
 * disponibile il payload del ClientHello TLS, ne classifica la versione negoziata.
 * Il risultato è cachato per sessionId (non per IP remoto, a differenza
 * dell'identificazione risorsa in dnsService.js): la stessa destinazione può offrire sia
 * HTTP (porta 80) sia HTTPS (porta 443), con un livello di sicurezza diverso per ciascuna
 * porta/sessione.
 *
 * @param {string} sessionId - Identificativo sessione (remoteIp:remotePort)
 * @param {number} remotePort - Porta remota della connessione
 * @param {Buffer|null} packetPayload - Payload applicativo catturato per questo
 *   pacchetto (ClientHello TLS), se disponibile
 * @returns {{level: string, label: string}|null} Livello stimato, o null se non ci sono
 *   ancora abbastanza dati per stimarlo (es. nessun ClientHello ancora osservato)
 */
function assessConnectionSecurity(sessionId, remotePort, packetPayload) {
    if (securityCache.has(sessionId)) return securityCache.get(sessionId);

    let result = null;
    if (remotePort === 80) {
        result = { level: 'insecure', label: 'Non cifrata (HTTP)' };
    } else if (packetPayload) {
        result = parseClientHelloVersion(packetPayload);
    }

    if (result) securityCache.set(sessionId, result);
    return result;
}

module.exports = {
    assessConnectionSecurity
};
