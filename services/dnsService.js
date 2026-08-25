/**
 * ====================================================================================
 * SERVIZIO RISOLUZIONE PROCEDURALE DEGLI HOSTNAME (dnsService.js)
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
 * Se il dominio è una CDN pura senza brand associato (target: null), o non
 * compare in tabella, viene restituito invariato.
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
 */
function getDomainFamily(domain) {
    if (!domain) return null;
    const entry = findFamilyEntry(domain.toLowerCase().trim());
    return entry ? entry.family : null;
}

function isValidHostname(name, ip) {
    if (!name) return false;
    const n = name.toLowerCase().trim();

    if (n === "" || n === "risorsa web" || n === ip) return false;
    if (n.endsWith('.in-addr.arpa') || n.endsWith('.ip6.arpa')) return false;

    return true;
}

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

function parseDNSResponse(buffer) {
    try {
        if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) return null;

        let dnsOffset = 0;
        if (buffer.length > 42 && (buffer[12] === 0x08 && buffer[13] === 0x00)) {
            dnsOffset = 14 + (buffer[14] & 0x0F) * 4 + 8;
        }

        if (dnsOffset + 12 > buffer.length) dnsOffset = 0;

        const qdcount = buffer.readUInt16BE(dnsOffset + 4);
        const ancount = buffer.readUInt16BE(dnsOffset + 6);

        if (qdcount === 0) return null;

        let offset = dnsOffset + 12;
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

function recordDnsQuery(packetPayload) {
    const result = parseDNSResponse(packetPayload);
    if (result && result.domain && result.ips && result.ips.length > 0) {
        for (const ip of result.ips) {
            associateIpWithDomain(ip, result.domain);
        }
    }
}

function associateIpWithDomain(ip, domain) {
    if (!ip || !domain) return;
    const normalized = normalizeDomain(domain);
    
    if (isValidHostname(normalized, ip)) {
        ipToDomainMap.set(ip, normalized);
    }
}

function detectProvider(ip, hostName, subtitle) {
    const combined = `${ip} ${hostName || ''} ${subtitle || ''}`.toLowerCase();
    
    if (combined.includes('amazonaws') || combined.includes('cloudfront') || combined.includes('aws')) {
        return 'Amazon AWS';
    }
    if (combined.includes('cloudflare') || combined.includes('cf-')) {
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
 * PIPELINE PROCEDURALE CON CACHE RISULTATI
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

    if (isValidHostname(ipToDomainMap.get(remoteIp), remoteIp)) {
        const directDomain = ipToDomainMap.get(remoteIp);
        resolvedDetails = {
            hostName: directDomain,
            resourceName: directDomain,
            technicalSubtitle: sanitizeSubtitle(directDomain, rawHostName)
        };
    }
    else if (packetPayload) {
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
            }
        }
    }
    else if (isValidHostname(rawHostName, remoteIp)) {
        resolvedDetails = {
            hostName: rawHostName,
            resourceName: rawHostName,
            technicalSubtitle: getRootDomain(rawHostName)
        };
    }
    else {
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