/**
 * ====================================================================================
 * GENERAZIONE HTML DEI POPUP MAPPA (dashboard/mapPopup.js)
 * ====================================================================================
 * Costruisce il markup dei popup Leaflet mostrati cliccando un nodo/hop sulla mappa
 * live: nome risorsa, IP, provider, descrizione contestuale del datacenter/servizio
 * noto, e i pulsanti di navigazione tra gli hop di una stessa rotta.
 * Nessuna dipendenza da mapCore.js/mapRoutes.js/mapHighlight.js: funzione pura che
 * genera solo stringhe HTML a partire dagli argomenti ricevuti.
 * ====================================================================================
 */

/**
 * Dizionario delle descrizioni contestuali per Datacenter/Provider noti e Servizi
 */
const PROVIDER_DESCRIPTIONS = {
    'Amazon AWS': 'Infrastruttura Cloud globale (AWS) utilizzata per l\'hosting di siti web, CDN, database e microservizi.',
    'Google Cloud': 'Datacenter e server di rete Google (GCP / 1e100) dedicati a servizi Web, streaming (YouTube) e API.',
    'Microsoft Azure': 'Infrastruttura Cloud Enterprise Microsoft per hosting aziendale, servizi Office 365, Windows Update e Copilot.',
    'Cloudflare': 'Rete di distribuzione dei contenuti (CDN) globale, sicurezza di rete e protezione anti-DDoS.'
};

const SERVICE_DESCRIPTIONS = {
    '443': 'Traffico cifrato HTTPS (SSL/TLS) per la trasmissione sicura di dati web.',
    '80': 'Traffico HTTP standard non cifrato per la navigazione web.',
    '53': 'Servizio DNS per la risoluzione dei nomi di dominio in indirizzi IP.',
    '22': 'Connessione di amministrazione remota sicura tramite protocollo SSH.'
};

/**
 * Colore per livello di sicurezza stimato (services/securityService.js), duplicato qui
 * volutamente per mantenere il modulo indipendente (stessa logica di dashboard/
 * uiCardHelpers.js e dbview/mapImportManager.js, ciascuno col proprio markup di badge).
 */
const SECURITY_LEVEL_COLORS = {
    insecure: '#f87171',
    weak: '#fbbf24',
    adequate: '#60a5fa',
    secure: '#4ade80'
};

/**
 * ================================================================================
 * GENERAZIONE HTML DEL POPUP DI UN SINGOLO HOP
 * ================================================================================
 * Costruisce titolo, nome/link, sottotitolo DNS, badge provider, box di descrizione
 * contestuale (datacenter noto, origine locale, o servizio noto sulla porta) e i
 * pulsanti Prec/Succ per navigare gli altri hop della stessa rotta.
 *
 * @param {string} sessionId - Identificativo sessione (remoteIp:remotePort) della rotta
 * @param {number} currentIndex - Indice di questo hop nella rotta (0 = sorgente)
 * @param {number} totalHops - Numero totale di hop nella rotta
 * @param {string} currentIp - IP di questo hop
 * @param {string} currentCity - Nome/città risolti per questo hop (o IP/placeholder)
 * @param {number|string} remotePort - Porta remota della connessione (solo per l'ultimo hop)
 * @param {string} technicalSubtitle - Sottotitolo tecnico (es. hostname reverse-DNS)
 * @param {string|null} providerName - Provider/hosting riconosciuto per questo hop, se noto
 * @param {string|null} [securityLevel] - Livello di sicurezza stimato per la sessione
 *   ('insecure'|'weak'|'adequate'|'secure'), mostrato solo sull'ultimo hop (destinazione)
 * @param {string|null} [securityLabel] - Etichetta leggibile del livello di sicurezza
 * @returns {string} Markup HTML del popup, pronto per Leaflet `bindPopup`/`setPopupContent`
 */
function getHopPopupHTML(sessionId, currentIndex, totalHops, currentIp, currentCity, remotePort, technicalSubtitle, providerName, securityLevel, securityLabel) {
    const isFirst = currentIndex === 0;
    const isLast = currentIndex === totalHops - 1;

    let nodeType = isFirst ? "Sorgente" : (isLast ? "Destinatario" : "Intermedio");
    let hopTitle = isFirst ? "Sorgente (Inizio)" : (isLast ? `Hop #${currentIndex} (Fine)` : `Hop #${currentIndex}`);

    let nameDisplay = currentCity;
    if (!nameDisplay || nameDisplay.toLowerCase() === "risorsa web" || nameDisplay === currentIp || nameDisplay === "Nodo di Rete") {
        nameDisplay = isFirst ? "Mio PC" : currentIp;
    }

    const subtitleRow = (technicalSubtitle && technicalSubtitle !== nameDisplay)
        ? `<span style="color: #94a3b8; font-size: 0.85em; display:block; margin-top: 2px;">DNS: ${technicalSubtitle}</span>`
        : "";

    // Riga Datacenter / Provider
    const providerRow = providerName
        ? `<span style="color: #f59e0b; font-size: 0.9em; font-weight: bold; display:block; margin-top: 4px;">🏢 Provider: ${providerName}</span>`
        : "";

    // Riga Sicurezza (solo sull'ultimo hop, la destinazione reale della connessione)
    const securityRow = securityLabel
        ? `<span style="color: ${SECURITY_LEVEL_COLORS[securityLevel] || '#94a3b8'}; font-size: 0.9em; font-weight: bold; display:block; margin-top: 4px;">🔐 ${securityLabel}</span>`
        : "";

    // --- BOX DESCRIZIONE CONTESTUALE ---
    let contextBox = '';
    if (providerName && PROVIDER_DESCRIPTIONS[providerName]) {
        contextBox = `
            <div style="color: #cbd5e1; font-size: 0.8em; line-height: 1.35; background: #0f172a; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #f59e0b; margin-top: 8px;">
                💡 <b>Info Datacenter:</b><br>${PROVIDER_DESCRIPTIONS[providerName]}
            </div>`;
    } else if (isFirst) {
        contextBox = `
            <div style="color: #cbd5e1; font-size: 0.8em; line-height: 1.35; background: #0f172a; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #10b981; margin-top: 8px;">
                💻 <b>Origine Locale:</b> Il tuo dispositivo da cui origina la sessione di rete.
            </div>`;
    } else if (remotePort && SERVICE_DESCRIPTIONS[remotePort]) {
        contextBox = `
            <div style="color: #cbd5e1; font-size: 0.8em; line-height: 1.35; background: #0f172a; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #38bdf8; margin-top: 8px;">
                ℹ️ <b>Info Servizio:</b><br>${SERVICE_DESCRIPTIONS[remotePort]}
            </div>`;
    }

    const portRow = (!isFirst && remotePort)
        ? `<span style="color: #38bdf8;">Porta: ${remotePort}</span><br>`
        : "";

    let nameRow = '';
    if (isFirst) {
        nameRow = `<span style="color: #cbd5e1;">Nome: ${nameDisplay}</span>`;
    } else {
        /**
         * Un IP privato mostrato come "nome" (identificazione fallita per un hop sulla
         * propria LAN) non va reso come link cliccabile "Apri sito web": non esiste un
         * sito pubblico raggiungibile su quell'indirizzo. Copre tutte le classi RFC1918,
         * non solo 192.168.x.x.
         */
        const isPrivateHostIp = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|127\.)/.test(nameDisplay);
        const isDomain = nameDisplay.includes('.') && nameDisplay !== currentIp && !isPrivateHostIp;

        if (isDomain) {
            nameRow = `<span style="color: #cbd5e1;">Nome: <a href="https://${nameDisplay}" target="_blank" style="color: #38bdf8; text-decoration: underline;" title="Apri sito web">🌐 ${nameDisplay}</a></span>`;
        } else {
            const searchQuery = nameDisplay;
            nameRow = `<span style="color: #cbd5e1;">Nome: ${nameDisplay}</span> <a href="https://www.google.com/search?q=${encodeURIComponent(searchQuery)}" target="_blank" style="color: #38bdf8; font-size: 0.85em; text-decoration: none;" title="Cerca risorsa">🔍 [Cerca]</a>`;
        }
    }

    return `
        <div style="font-family: monospace; min-width: 220px; color: #f1f5f9; padding: 5px;">
            <b style="color: #38bdf8; display: block; margin-bottom: 8px; font-size: 1.1em; border-bottom: 1px solid #334155; padding-bottom: 4px;">
                ${hopTitle}
            </b>
            <span style="color: #10b981; font-weight: bold;">Nodo: ${nodeType}</span><br>
            ${nameRow}
            ${subtitleRow}
            ${providerRow}
            ${securityRow}<br>
            <span style="color: #94a3b8; font-size: 0.95em;">IP: ${currentIp}</span><br>
            ${portRow}
            ${contextBox}

            <div style="display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px solid #334155; padding-top: 8px;">
                <button ${isFirst ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}
                    onclick="window.navigateHop('${sessionId}', ${currentIndex - 1})"
                    style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    ◀ Prec
                </button>
                <span style="color: #38bdf8; font-weight: bold; align-self: center;">${currentIndex}/${totalHops - 1}</span>
                <button ${isLast ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}
                    onclick="window.navigateHop('${sessionId}', ${currentIndex + 1})"
                    style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    Succ ▶
                </button>
            </div>
        </div>
    `;
}
