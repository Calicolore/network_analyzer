/**
 * ====================================================================================
 * SERVIZIO IDENTIFICAZIONE PROVIDER / ASN TRAMITE ip-api.com (services/providerService.js)
 * ====================================================================================
 * Arricchisce in modo asincrono (fire-and-forget) il provider/ISP di un IP remoto
 * tramite l'API gratuita ip-api.com, con cache in memoria + persistita su SQLite
 * (per non richiamare l'API per IP già risolti in run precedenti) e una coda con
 * rate-limit per restare sotto il limite gratuito di 45 richieste/minuto.
 * ====================================================================================
 */

const { isPrivateIp } = require('../utils/networkUtils');
const { upsertProviderCache, getAllProviderCache } = require('../database/dbService');

const providerCache = new Map();     // ip -> { isp, org, asn, providerLabel }
const pendingLookups = new Set();    // IP attualmente in coda o in corso di risoluzione
const cooldownUntil = new Map();     // ip -> timestamp ms fino a cui non ritentare dopo un fallimento

const RATE_LIMIT_MS = 1500;          // ~40 richieste/minuto, sotto il limite gratuito di ip-api.com
const REQUEST_TIMEOUT_MS = 3000;
const FAILURE_COOLDOWN_MS = 60 * 1000;

const requestQueue = [];
let queueRunning = false;

// Precarica in memoria la cache persistita all'avvio, per evitare lookup ripetuti tra riavvii
for (const row of getAllProviderCache()) {
    providerCache.set(row.ip, {
        isp: row.isp,
        org: row.org,
        asn: row.asn,
        providerLabel: row.provider_label
    });
}

/**
 * Restituisce il risultato già cachato (memoria o DB precaricato) per un IP, se presente.
 *
 * @param {string} ip - IP di cui recuperare il provider dalla cache
 * @returns {{isp: string, org: string, asn: string, providerLabel: string}|null} Il
 *   risultato cachato, o null se l'IP non è mai stato risolto
 */
function getCachedProvider(ip) {
    return providerCache.get(ip) || null;
}

/**
 * Interroga ip-api.com per un singolo IP con timeout esplicito.
 *
 * @param {string} ip - IP pubblico da geolocalizzare/identificare
 * @returns {Promise<{isp: string|null, org: string|null, asn: string|null,
 *   providerLabel: string|null}|null>} Dati del provider, o null in caso di errore,
 *   timeout o rate-limit lato servizio
 */
async function fetchProviderFromApi(ip) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,isp,org,as,query`, {
            signal: controller.signal
        });
        if (!response.ok) return null;

        const data = await response.json();
        if (data.status !== 'success') return null;

        const asn = data.as || null;
        const providerLabel = data.isp || data.org || (asn ? asn.split(' ').slice(1).join(' ') : null);

        return {
            isp: data.isp || null,
            org: data.org || null,
            asn,
            providerLabel: providerLabel || null
        };
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Processa la coda di lookup rispettando il rate-limit, uno alla volta.
 */
async function processQueue() {
    if (queueRunning) return;
    queueRunning = true;

    while (requestQueue.length > 0) {
        const { ip, onResolved } = requestQueue.shift();

        const result = await fetchProviderFromApi(ip);
        pendingLookups.delete(ip);

        if (result && result.providerLabel) {
            providerCache.set(ip, result);
            upsertProviderCache({
                ip,
                isp: result.isp,
                org: result.org,
                asn: result.asn,
                providerLabel: result.providerLabel,
                fetchedAt: new Date().toISOString()
            });
            if (typeof onResolved === 'function') onResolved(ip, result);
        } else {
            cooldownUntil.set(ip, Date.now() + FAILURE_COOLDOWN_MS);
        }

        if (requestQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
        }
    }

    queueRunning = false;
}

/**
 * ================================================================================
 * ACCODAMENTO RISOLUZIONE PROVIDER (fire-and-forget, con dedup e cooldown)
 * ================================================================================
 * Mette in coda la risoluzione del provider per un IP pubblico, deduplicando le
 * richieste concorrenti sullo stesso IP (già in cache o già in coda) e rispettando
 * un cooldown dopo un fallimento recente, per non intasare la coda ritentando subito
 * lo stesso IP che ha appena fallito.
 *
 * @param {string} ip - IP pubblico di cui risolvere il provider
 * @param {(ip: string, result: {isp: string, org: string, asn: string,
 *   providerLabel: string}) => void} onResolved - Chiamata solo in caso di successo
 */
function enqueueProviderLookup(ip, onResolved) {
    if (isPrivateIp(ip)) return;
    if (providerCache.has(ip) || pendingLookups.has(ip)) return;

    const cooldown = cooldownUntil.get(ip);
    if (cooldown && Date.now() < cooldown) return;

    pendingLookups.add(ip);
    requestQueue.push({ ip, onResolved });
    processQueue();
}

module.exports = {
    enqueueProviderLookup,
    getCachedProvider
};
