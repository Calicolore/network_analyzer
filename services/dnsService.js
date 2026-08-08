/**
 * ====================================================================================
 * SERVIZIO RISOLUZIONE PROCEDURALE DEGLI HOSTNAME (dnsService.js)
 * ====================================================================================
 */

const dns = require('dns').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Cache e tabelle di stato
const hostCache = new Map();         // Cache Reverse DNS
const ipToDomainMap = new Map();     // Mappa IP -> Dominio da DNS/SNI
const systemDnsCache = new Map();    // Mappa IP -> Dominio estratto da Windows DNS Cache

// Normalizzazione CDN e Servizi Noti
const CDN_MAPPING = [
    { pattern: 'twimg.com', target: 'x.com' },
    { pattern: 't.co', target: 'x.com' },
    { pattern: 'twitter.com', target: 'x.com' },
    { pattern: 'ytimg.com', target: 'youtube.com' },
    { pattern: 'googlevideo.com', target: 'youtube.com' },
    { pattern: 'ggpht.com', target: 'youtube.com' },
    { pattern: 'youtube.com', target: 'youtube.com' }
];

/**
 * Normalizza un nome dominio se appartiene a una CDN nota
 */
function normalizeDomain(domain) {
    if (!domain) return null;
    const d = domain.toLowerCase().trim();

    for (const map of CDN_MAPPING) {
        if (d.includes(map.pattern)) {
            return map.target;
        }
    }
    return d;
}

/**
 * Verifica se un nome è valido o se è un'infrastruttura generica.
 */
function isValidHostname(name, ip) {
    if (!name) return false;
    const n = name.toLowerCase().trim();

    if (n === "" || n === "risorsa web" || n === ip) return false;
    if (n.endsWith('.in-addr.arpa') || n.endsWith('.ip6.arpa')) return false;

    // Se contiene host di infrastruttura cloud generica non è un nome finale valido
    const genericPatterns = ['1e100.net', 'googleusercontent.com', 'cloudfront.net', 'amazonaws.com'];
    for (const pattern of genericPatterns) {
        if (n.includes(pattern)) return false;
    }

    return true;
}

/**
 * Sincronizza periodica in background la Cache DNS di Windows in memoria.
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
    } catch (e) {
        // Ignora eventuali errori di parsing/esecuzione
    }
}

// Avvia il sync della Cache OS ogni 4 secondi in background
setInterval(syncSystemDnsCache, 4000);
syncSystemDnsCache();

/**
 * ESTRAZIONE TLS SNI (Server Name Indication)
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
 * Parsing delle risposte DNS intercettate dallo sniffer
 */
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

/**
 * Reverse DNS Lookup con Cache
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
 * Registra le query/risposte DNS catturate dallo sniffer
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
 * Mantiene aggiornata la mappa DNS
 */
function associateIpWithDomain(ip, domain) {
    if (!ip || !domain) return;
    const normalized = normalizeDomain(domain);
    
    if (isValidHostname(normalized, ip)) {
        ipToDomainMap.set(ip, normalized);
    }
}

/**
 * Riconosce automaticamente il Datacenter o Provider dall'IP, hostname o sottotitolo
 */
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
 * PIPELINE PROCEDURALE PRINCIPALE
 */
async function resolveResourceDetails(remoteIp, packetPayload = null) {
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

    // 1. Query DNS Intercettata in Mappa
    const directDomain = ipToDomainMap.get(remoteIp);
    if (isValidHostname(directDomain, remoteIp)) {
        resolvedDetails = {
            hostName: directDomain,
            resourceName: directDomain,
            technicalSubtitle: sanitizeSubtitle(directDomain, rawHostName)
        };
    }
    // 2. Ispezione SNI TLS
    else if (packetPayload) {
        const sniDomain = extractSNIFromTLS(packetPayload);
        if (sniDomain) {
            const cleanedSNI = normalizeDomain(sniDomain);
            if (isValidHostname(cleanedSNI, remoteIp)) {
                ipToDomainMap.set(remoteIp, cleanedSNI);
                resolvedDetails = {
                    hostName: cleanedSNI,
                    resourceName: cleanedSNI,
                    technicalSubtitle: sanitizeSubtitle(cleanedSNI, rawHostName)
                };
            }
        }
    }
    // 3. Reverse DNS
    else if (isValidHostname(rawHostName, remoteIp)) {
        resolvedDetails = {
            hostName: rawHostName,
            resourceName: rawHostName,
            technicalSubtitle: getRootDomain(rawHostName)
        };
    }
    // 4. Cache DNS OS
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

    // Aggiunge l'identificazione automatica del Provider / Datacenter
    resolvedDetails.provider = detectProvider(remoteIp, resolvedDetails.hostName, resolvedDetails.technicalSubtitle);

    return resolvedDetails;
}

module.exports = {
    resolveResourceDetails,
    recordDnsQuery
};