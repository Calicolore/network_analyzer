/**
 * ====================================================================================
 * SERVIZIO RISOLUZIONE PROCEDURALE DEGLI HOSTNAME (services/dnsService.js)
 * ====================================================================================
 * Identifica il nome della risorsa/sito dietro un IP remoto, combinando più fonti in
 * ordine di priorità (vedi resolveResourceDetails): DNS passivo sniffato, SNI del
 * ClientHello TLS o header Host: HTTP, reverse DNS, cache DNS di sistema Windows.
 * Fornisce anche l'euristica hardcoded di riconoscimento provider (detectProvider,
 * fallback sincrono di services/providerService.js) e il raggruppamento per famiglia
 * di dominio (getDomainFamily, tabella in services/domainFamilies.js).
 * ====================================================================================
 */

const dns = require('dns').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { findFamilyEntry } = require('./domainFamilies');

// Cache e tabelle di stato
const hostCache = new Map();         // Cache Reverse DNS
const ipToDomainMap = new Map();     // Mappa IP -> Dominio da DNS/SNI
const systemDnsCache = new Map();    // Mappa IP -> Dominio estratto da Windows DNS Cache
const resolvedResourceCache = new Map(); // Cache finale dei dettagli per IP

/**
 * Normalizza un dominio al brand/sito principale a cui appartiene, se noto
 * (es. twimg.com -> x.com), tramite la tabella curata in domainFamilies.js.
 *
 * @param {string} domain - Dominio da normalizzare
 * @returns {string|null} Il dominio "brand" principale, il dominio invariato se è
 *   una CDN pura senza brand associato o non compare in tabella, o null se `domain`
 *   è vuoto
 */
function normalizeDomain(domain) {
    if (!domain) return null;
    const d = domain.toLowerCase().trim();

    const entry = findFamilyEntry(d);
    if (entry && entry.target) return entry.target;
    return d;
}

/**
 * Restituisce l'identificativo di "famiglia" (flow) a cui appartiene un dominio,
 * usato per raggruppare in UI le connessioni correlate allo stesso sito/servizio.
 *
 * @param {string} domain - Dominio di cui determinare la famiglia
 * @returns {string|null} Identificativo di famiglia (es. "google", "x"), o null se
 *   il dominio non compare in tabella
 */
function getDomainFamily(domain) {
    if (!domain) return null;
    const entry = findFamilyEntry(domain.toLowerCase().trim());
    return entry ? entry.family : null;
}

/**
 * Scarta i nomi che non sono utilizzabili come risultato: vuoti, uguali all'IP
 * stesso, o record PTR reverse-DNS grezzi (.in-addr.arpa/.ip6.arpa).
 *
 * @param {string} name - Nome/dominio da validare
 * @param {string} ip - IP remoto associato, per il confronto "nome === ip"
 * @returns {boolean} true se il nome è utilizzabile come risultato
 */
function isValidHostname(name, ip) {
    if (!name) return false;
    const n = name.toLowerCase().trim();

    if (n === "" || n === "risorsa web" || n === ip) return false;
    if (n.endsWith('.in-addr.arpa') || n.endsWith('.ip6.arpa')) return false;

    return true;
}

/**
 * Interroga periodicamente la cache DNS del resolver di Windows (Get-DnsClientCache)
 * per recuperare passivamente associazioni IP->dominio già risolte dal sistema operativo
 * (utile per traffico la cui query DNS non è stata vista dallo sniffer, es. DNS gestito
 * da altri processi). Funzionalità Windows-only: fallisce silenziosamente su altri OS.
 */
async function syncSystemDnsCache() {
    try {
        const command = `powershell -NoProfile -Command "Get-DnsClientCache | Select-Object Entry, Data | ConvertTo-Json"`;
        const { stdout } = await execPromise(command, { maxBuffer: 1024 * 1024 * 5 });
        
        if (stdout && stdout.trim()) {
            const entries = JSON.parse(stdout.trim());
            const list = Array.isArray(entries) ? entries : [entries];

            for (const item of list) {
                if (item.Entry && item.Data) {
                    const domain = normalizeDomain(item.Entry);
                    const ip = item.Data;
                    if (isValidHostname(domain, ip)) {
                        systemDnsCache.set(ip, domain);
                    }
                }
            }
        }
    } catch (e) { }
}

setInterval(syncSystemDnsCache, 4000);
syncSystemDnsCache();

/**
 * ====================================================================================
 * ESTRAZIONE SNI DA CLIENTHELLO TLS (parsing manuale byte-a-byte)
 * ====================================================================================
 * Attraversa la struttura del record TLS (handshake type, random, session id, cipher
 * suites, compression methods, poi l'estensione server_name tra le extension) per
 * estrarne l'hostname richiesto. Nessuna libreria TLS coinvolta: è un parser minimale
 * scritto a mano, sufficiente perché il ClientHello non è cifrato.
 *
 * @param {Buffer} buffer - Payload TCP grezzo catturato, atteso un ClientHello TLS
 * @returns {string|null} Hostname SNI estratto, o null (senza eccezioni) per qualunque
 *   payload che non sia un ClientHello riconoscibile
 */
function extractSNIFromTLS(buffer) {
    try {
        if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 43) return null;
        if (buffer[0] !== 0x16) return null;

        let offset = 5;
        if (buffer[offset] !== 0x01) return null;

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

        const extEnd = offset + extensionsLength;
        while (offset + 4 < extEnd && offset + 4 < buffer.length) {
            const extType = buffer.readUInt16BE(offset);
            const extLen = buffer.readUInt16BE(offset + 2);
            offset += 4;

            if (extType === 0) {
                if (offset + 5 < buffer.length) {
                    const sniLen = buffer.readUInt16BE(offset + 3);
                    if (offset + 5 + sniLen <= buffer.length) {
                        return buffer.toString('utf8', offset + 5, offset + 5 + sniLen);
                    }
                }
            }
            offset += extLen;
        }
    } catch (e) {
        return null;
    }
    return null;
}

/**
 * Estrae il dominio dall'header "Host:" di una richiesta HTTP in chiaro (porta 80).
 * Fallback usato quando il payload catturato non è un ClientHello TLS.
 *
 * @param {Buffer} buffer - Payload TCP grezzo catturato, atteso l'inizio di una richiesta HTTP
 * @returns {string|null} Valore dell'header Host, o null se non è una richiesta HTTP
 *   riconoscibile o non ha un header Host
 */
function extractHostFromHTTP(buffer) {
    try {
        if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 16) return null;

        const text = buffer.toString('latin1', 0, Math.min(buffer.length, 2048));
        if (!/^(GET|POST|HEAD|PUT|DELETE|OPTIONS|CONNECT|PATCH)\s/.test(text)) return null;

        const match = /\r?\nHost:\s*([^\r\n]+)/i.exec(text);
        return match ? match[1].trim() : null;
    } catch (e) {
        return null;
    }
}

/**
 * ====================================================================================
 * PARSING DI UN MESSAGGIO DNS GREZZO (formato wire RFC 1035)
 * ====================================================================================
 * `buffer` è già il solo messaggio DNS (nessun header Ethernet/IP/UDP davanti): lo
 * sniffer (network/sniffer.js) passa qui esattamente i byte a partire dal payload UDP,
 * quindi il messaggio DNS inizia sempre a offset 0 — il Transaction ID nei primi 2 byte.
 * Legge la sezione Question (il dominio richiesto) e, se presenti, i record di
 * risposta di tipo A (indirizzi IPv4 risolti), seguendo puntatori di compressione
 * DNS (0xC0) dove necessario.
 *
 * @param {Buffer} buffer - Messaggio DNS grezzo (payload UDP della porta 53)
 * @returns {{domain: string, ips: string[]}|null} Dominio richiesto e IP risolti, o
 *   null se il messaggio non è un DNS valido o non contiene una domanda
 */
function parseDNSResponse(buffer) {
    try {
        if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) return null;

        const qdcount = buffer.readUInt16BE(4);
        const ancount = buffer.readUInt16BE(6);

        if (qdcount === 0) return null;

        let offset = 12;
        let parts = [];
        while (offset < buffer.length) {
            let len = buffer[offset];
            if (len === 0) { offset += 1; break; }
            if ((len & 0xC0) === 0xC0) { offset += 2; break; }
            if (offset + 1 + len > buffer.length) break;

            parts.push(buffer.toString('utf8', offset + 1, offset + 1 + len));
            offset += len + 1;
        }
        
        offset += 4;

        const requestedDomain = parts.join('.');
        if (!requestedDomain || requestedDomain.length <= 3 || requestedDomain.endsWith('.in-addr.arpa') || requestedDomain.endsWith('.ip6.arpa')) {
            return null;
        }

        const domain = normalizeDomain(requestedDomain);
        const ips = [];

        if (ancount > 0 && offset < buffer.length) {
            for (let i = 0; i < ancount && offset < buffer.length; i++) {
                if ((buffer[offset] & 0xC0) === 0xC0) {
                    offset += 2;
                } else {
                    while (offset < buffer.length && buffer[offset] !== 0) {
                        offset += buffer[offset] + 1;
                    }
                    offset += 1;
                }

                if (offset + 10 > buffer.length) break;

                const type = buffer.readUInt16BE(offset);
                const rdlength = buffer.readUInt16BE(offset + 8);
                offset += 10;

                if (type === 1 && rdlength === 4 && (offset + 4 <= buffer.length)) {
                    const ip = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
                    ips.push(ip);
                }

                offset += rdlength;
            }
        }

        return { domain, ips };
    } catch (e) {
        return null;
    }
}

/**
 * Reverse DNS (PTR) di un IP, con cache permanente per evitare lookup ripetuti verso
 * lo stesso indirizzo. In caso di fallimento (nessun PTR, timeout, IP privato senza
 * risposta) la cache memorizza l'IP stesso come risultato, così i tentativi falliti
 * non vengono ripetuti ad ogni pacchetto.
 *
 * @param {string} ip - IP remoto di cui risolvere l'hostname
 * @returns {Promise<string>} Hostname risolto (normalizzato), o l'IP stesso se il
 *   PTR non esiste/fallisce
 */
async function getHostName(ip) {
    if (hostCache.has(ip)) return hostCache.get(ip);
    
    try {
        const names = await dns.reverse(ip);
        if (names && names.length > 0) {
            const rawName = names[0];
            const normalized = normalizeDomain(rawName);
            hostCache.set(ip, normalized);
            return normalized;
        }
    } catch (err) { }

    hostCache.set(ip, ip);
    return ip;
}

/**
 * Punto di ingresso chiamato da app.js per ogni pacchetto UDP/53 catturato: se la
 * risposta DNS contiene record A validi, associa ciascun IP risolto al dominio
 * richiesto (identificazione passiva "gratuita", non richiede alcuna richiesta
 * aggiuntiva: sfrutta le query DNS che il sistema fa comunque per conto proprio).
 *
 * @param {Buffer} packetPayload - Messaggio DNS grezzo (payload UDP della porta 53)
 */
function recordDnsQuery(packetPayload) {
    const result = parseDNSResponse(packetPayload);
    if (result && result.domain && result.ips && result.ips.length > 0) {
        for (const ip of result.ips) {
            associateIpWithDomain(ip, result.domain);
        }
    }
}

/**
 * Registra in ipToDomainMap l'associazione IP->dominio, solo se il dominio è
 * effettivamente utilizzabile (vedi isValidHostname).
 *
 * @param {string} ip - IP a cui associare il dominio
 * @param {string} domain - Dominio risolto per quell'IP
 */
function associateIpWithDomain(ip, domain) {
    if (!ip || !domain) return;
    const normalized = normalizeDomain(domain);
    
    if (isValidHostname(normalized, ip)) {
        ipToDomainMap.set(ip, normalized);
    }
}

/**
 * ====================================================================================
 * EURISTICA HARDCODED DI RICONOSCIMENTO PROVIDER/HOSTING
 * ====================================================================================
 * Usata come fallback sincrono immediato finché non arriva (in modo asincrono) il
 * risultato più accurato di services/providerService.js (ip-api.com) per lo stesso IP.
 * I pattern sono deliberatamente specifici (es. "amazonaws" non il generico "aws"):
 * sottostringhe troppo corte/generiche produrrebbero falsi positivi su hostname
 * qualunque che le contengano per puro caso.
 *
 * @param {string} ip - IP remoto (usato solo per l'euristica sul prefisso Azure "20.")
 * @param {string} hostName - Hostname/dominio risolto per l'IP
 * @param {string} subtitle - Sottotitolo tecnico (es. hostname reverse-DNS grezzo)
 * @returns {string|null} Nome del provider riconosciuto, o null se nessun pattern combacia
 */
function detectProvider(ip, hostName, subtitle) {
    const combined = `${hostName || ''} ${subtitle || ''}`.toLowerCase();

    if (combined.includes('amazonaws') || combined.includes('cloudfront')) {
        return 'Amazon AWS';
    }
    if (combined.includes('cloudflare')) {
        return 'Cloudflare';
    }
    if (combined.includes('google') || combined.includes('1e100.net') || combined.includes('googleusercontent') || combined.includes('gcp')) {
        return 'Google Cloud';
    }
    if (combined.includes('microsoft') || combined.includes('azure') || combined.includes('githubusercontent') || combined.includes('copilot') || ip.startsWith('20.')) {
        return 'Microsoft Azure';
    }
    return null;
}

/**
 * ====================================================================================
 * PIPELINE DI IDENTIFICAZIONE RISORSA (con cache dei risultati per IP)
 * ====================================================================================
 * Prova in sequenza le fonti disponibili (dominio già noto, SNI/HTTP, reverse DNS,
 * cache di sistema) e si ferma alla prima che produce un nome valido — se una fonte
 * fallisce si passa alla successiva invece di arrendersi subito su "Risorsa Web".
 *
 * @param {string} remoteIp - IP remoto della connessione da identificare
 * @param {Buffer|null} [packetPayload] - Payload applicativo catturato (ClientHello TLS
 *   o richiesta HTTP), se disponibile per questo pacchetto
 * @returns {Promise<{hostName:string, resourceName:string, technicalSubtitle:string,
 *   provider:?string, flow:?string}>}
 */
async function resolveResourceDetails(remoteIp, packetPayload = null) {
    // Controllo immediato in cache per evitare rilavorazioni
    if (resolvedResourceCache.has(remoteIp)) {
        return resolvedResourceCache.get(remoteIp);
    }

    const rawHostName = await getHostName(remoteIp);

    const getRootDomain = (domain) => {
        if (!domain || domain === remoteIp) return '';
        const parts = domain.split('.');
        if (parts.length >= 2) {
            return parts.slice(-2).join('.');
        }
        return domain;
    };

    const sanitizeSubtitle = (mainDomain, subtitle) => {
        if (!subtitle || subtitle === mainDomain || subtitle === remoteIp) return '';
        const mainRoot = getRootDomain(mainDomain);
        const subRoot = getRootDomain(subtitle);
        
        if (mainRoot && subRoot && mainRoot !== subRoot) {
            return mainRoot;
        }
        return subtitle;
    };

    let resolvedDetails = {
        hostName: remoteIp,
        resourceName: "Risorsa Web",
        technicalSubtitle: rawHostName !== remoteIp ? rawHostName : ""
    };
    let resolved = false;

    // 1. Dominio già associato a questo IP tramite DNS/SNI osservato in precedenza
    if (isValidHostname(ipToDomainMap.get(remoteIp), remoteIp)) {
        const directDomain = ipToDomainMap.get(remoteIp);
        resolvedDetails = {
            hostName: directDomain,
            resourceName: directDomain,
            technicalSubtitle: sanitizeSubtitle(directDomain, rawHostName)
        };
        resolved = true;
    }

    // 2. SNI del ClientHello TLS, o header Host: di una richiesta HTTP in chiaro.
    // Se il payload non produce un dominio valido (frammentazione TLS, pacchetto senza
    // SNI, ecc.) NON ci si ferma qui: si prosegue con i passi successivi invece di
    // arrendersi subito su "Risorsa Web", perché reverse DNS o cache di sistema
    // potrebbero comunque avere un nome buono.
    if (!resolved && packetPayload) {
        const extractedDomain = extractSNIFromTLS(packetPayload) || extractHostFromHTTP(packetPayload);
        if (extractedDomain) {
            const cleanedDomain = normalizeDomain(extractedDomain);
            if (isValidHostname(cleanedDomain, remoteIp)) {
                ipToDomainMap.set(remoteIp, cleanedDomain);
                resolvedDetails = {
                    hostName: cleanedDomain,
                    resourceName: cleanedDomain,
                    technicalSubtitle: sanitizeSubtitle(cleanedDomain, rawHostName)
                };
                resolved = true;
            }
        }
    }

    // 3. Reverse DNS (PTR) dell'IP remoto
    if (!resolved && isValidHostname(rawHostName, remoteIp)) {
        resolvedDetails = {
            hostName: rawHostName,
            resourceName: rawHostName,
            technicalSubtitle: getRootDomain(rawHostName)
        };
        resolved = true;
    }

    // 4. Cache DNS di sistema Windows, o euristica hardcoded per i blocchi IP noti di Google/YouTube
    if (!resolved) {
        const sysDomain = systemDnsCache.get(remoteIp);
        if (isValidHostname(sysDomain, remoteIp)) {
            ipToDomainMap.set(remoteIp, sysDomain);
            resolvedDetails = {
                hostName: sysDomain,
                resourceName: sysDomain,
                technicalSubtitle: getRootDomain(sysDomain)
            };
        } else if (
            remoteIp.startsWith('142.251.') ||
            remoteIp.startsWith('172.217.') ||
            remoteIp.startsWith('142.250.') ||
            (rawHostName && rawHostName.includes('1e100.net'))
        ) {
            resolvedDetails = {
                hostName: "youtube.com",
                resourceName: "youtube.com",
                technicalSubtitle: "Google Infrastructure"
            };
        }
    }

    resolvedDetails.provider = detectProvider(remoteIp, resolvedDetails.hostName, resolvedDetails.technicalSubtitle);
    resolvedDetails.flow = getDomainFamily(resolvedDetails.hostName);

    // Salva in cache se la risoluzione ha fornito un nome valido
    if (resolvedDetails.resourceName !== "Risorsa Web" || resolvedDetails.hostName !== remoteIp) {
        resolvedResourceCache.set(remoteIp, resolvedDetails);
    }

    return resolvedDetails;
}

module.exports = {
    resolveResourceDetails,
    recordDnsQuery
};