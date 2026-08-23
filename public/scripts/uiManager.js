/**
 * ================================================================================
 * GESTORE DELL'INTERFACCIA UTENTE E SCHEDE DI SESSIONE (uiManager.js)
 * ================================================================================
 */

const dashboard = document.getElementById('dashboard');
let sortThrottleTimeout = null;

// ================================================================================
// PASSO 1: BUFFERING DEI PACCHETTI IN INGRESSO
// ================================================================================
const packetBuffer = [];
const FLUSH_INTERVAL_MS = 100; // Processa i pacchetti ogni 100ms

/**
 * Funzione invocata all'arrivo di ogni pacchetto WebSocket.
 * Gestisce sia pacchetti singoli che array (batch) srotolandoli nel buffer.
 */
function renderPacketCard(data) {
    if (!data) return;
    if (Array.isArray(data)) {
        packetBuffer.push(...data);
    } else {
        packetBuffer.push(data);
    }
}

// Avvio il loop periodico di flush del buffer
setInterval(flushPacketBuffer, FLUSH_INTERVAL_MS);

/**
 * Elabora tutti i pacchetti accumulati nel buffer in un unico blocco.
 */
function flushPacketBuffer() {
    if (packetBuffer.length === 0) return;

    const targetDashboard = dashboard || document.getElementById('dashboard');
    if (!targetDashboard) return;

    // Svuota il buffer e prende tutti gli elementi accumulati
    const rawPackets = packetBuffer.splice(0, packetBuffer.length);

    // Garantisce che tutti gli elementi siano pacchetti singoli validi
    const packetsToProcess = [];
    for (const item of rawPackets) {
        if (Array.isArray(item)) {
            packetsToProcess.push(...item);
        } else if (item && typeof item === 'object') {
            packetsToProcess.push(item);
        }
    }

    // Raggruppa i pacchetti per sessionId per minimizzare le operazioni DOM per ogni card
    const groupedPackets = new Map();
    for (const packet of packetsToProcess) {
        if (!packet || !packet.sessionId) continue;

        if (!groupedPackets.has(packet.sessionId)) {
            groupedPackets.set(packet.sessionId, []);
        }
        groupedPackets.get(packet.sessionId).push(packet);
    }

    if (groupedPackets.size === 0) return;

    const newCardsFragment = document.createDocumentFragment();

    groupedPackets.forEach((packets, sessionId) => {
        const lastPacket = packets[packets.length - 1];
        let sessionDiv = document.getElementById(sessionId);

        // --- CREAZIONE CARD (se non esiste) ---
        if (!sessionDiv) {
            sessionDiv = createCardNode(lastPacket);
            newCardsFragment.appendChild(sessionDiv);
        } else {
            sessionDiv.classList.remove('closed-card', 'idle-card');
        }

        // --- AGGIORNAMENTO TESTATA E BANDA ---
        updateCardHeader(sessionDiv, lastPacket);

        // --- INSERIMENTO RIGHE PACCHETTI IN BATCH ---
        const container = sessionDiv._containerEl;
        const linesFragment = document.createDocumentFragment();

        for (const pData of packets) {
            const p = document.createElement('div');
            p.className = 'packet-line';
            const directionCol = pData.direction === "-->" ? "#ef4444" : "#22c55e";
            const serviceDisplay = (pData.service || '').startsWith('Port:') 
                ? pData.service 
                : `Port: ${pData.remotePort} - ${pData.service || 'Unknown'}`;

            p.innerHTML = `
                <span style="color:#64748b; font-size: 0.85em;">${pData.time || ''}</span>
                <span style="color:${directionCol}; font-weight: bold; margin: 0 5px;">${pData.direction || '-->'}</span>
                <span class="flags" style="color:#94a3b8; font-size: 0.8em; margin-right: 5px;">[${pData.flags || ''}]</span>
                <span style="color:#38bdf8; font-weight:bold;">${serviceDisplay}</span>
            `;
            linesFragment.appendChild(p);

            // --- AGGIORNAMENTO MAPPA E GRAFICI PER SINGOLO PACCHETTO ---
            if (window.MapManager && typeof window.MapManager.addConnection === 'function') {
                window.MapManager.addConnection(pData);
            } else if (window.mapManager && typeof window.mapManager.addConnection === 'function') {
                window.mapManager.addConnection(pData);
            }

            if (window.ChartManager && typeof window.ChartManager.update === 'function') {
                window.ChartManager.update(pData);
            } else if (window.chartManager && typeof window.chartManager.update === 'function') {
                window.chartManager.update(pData);
            }
        }

        container.appendChild(linesFragment);

        // Mantieni massimo 100 righe per contenitore
        while (container.children.length > 100) {
            container.removeChild(container.firstChild);
        }
        container.scrollTop = container.scrollHeight;

        // --- AGGIORNAMENTO DATASET PER FILTRI ---
        sessionDiv.dataset.domain = (lastPacket.resourceName || '').toLowerCase();
        sessionDiv.dataset.ip = (lastPacket.remoteIp || '').toLowerCase();
        sessionDiv.dataset.country = (lastPacket.country || '').toLowerCase();
        sessionDiv.dataset.provider = (lastPacket.provider || '').toLowerCase();
        sessionDiv.dataset.service = (lastPacket.service || '').toUpperCase();

        const isClosedOrIdle = sessionDiv.classList.contains('closed-card') || sessionDiv.classList.contains('idle-card');
        sessionDiv.dataset.closed = isClosedOrIdle ? 'true' : 'false';

        if (window.FilterManager) {
            window.FilterManager.evaluateNewCard(sessionDiv);
        }
    });

    // Se ci sono nuove card create nel ciclo, vengono appese in un unico colpo al DOM
    if (newCardsFragment.children.length > 0) {
        targetDashboard.appendChild(newCardsFragment);
    }

    sortCardsByUsage();
}

// ================================================================================
// HELPER PER CREAZIONE ED AGGIORNAMENTO NODO CARD
// ================================================================================
function createCardNode(data) {
    const sessionDiv = document.createElement('div');
    sessionDiv.id = data.sessionId;
    sessionDiv.className = 'session-card live-card';

    if (typeof currentlyHighlightedSessionId !== 'undefined' && currentlyHighlightedSessionId && currentlyHighlightedSessionId !== data.sessionId) {
        sessionDiv.classList.add('dimmed-card');
    }

    const countryBadge = `<span style="background:#334155; padding:2px 6px; border-radius:4px; font-size:0.7em; margin-left:8px;">${data.country || 'N/A'}</span>`;

    sessionDiv.innerHTML = `
        <div class="session-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div class="res-title" 
                    style="color: #38bdf8; font-size: 1.1em; font-weight: bold; word-break: break-all;"
                    title="Clicca sulla card per evidenziare la rotta sulla mappa">
                    ${data.resourceName || data.remoteIp}
                </div>
                <div class="subtitle-container"></div>
                <div style="color: #64748b; font-size: 0.75em; font-family: monospace;">
                    IP: ${data.remoteIp} ${countryBadge}
                </div>
            </div>
            <div class="bandwidth-meter" style="text-align: right; color: #10b981; font-weight: bold; font-family: monospace; font-size: 0.9em; min-width: 110px;">
                ${data.totalKB || 0} KB Tot.
            </div>
        </div>
        <div class="packets-container" style="height: 150px; overflow-y: auto; margin: 10px 0; border-top: 1px solid #334155; padding-top: 5px; font-size: 0.85em;"></div>
    `;

    // Caching riferimenti
    sessionDiv._titleDiv = sessionDiv.querySelector('.res-title');
    sessionDiv._subContainer = sessionDiv.querySelector('.subtitle-container');
    sessionDiv._meterEl = sessionDiv.querySelector('.bandwidth-meter');
    sessionDiv._containerEl = sessionDiv.querySelector('.packets-container');

    return sessionDiv;
}

function updateCardHeader(sessionDiv, data) {
    const titleDiv = sessionDiv._titleDiv;
    const subContainer = sessionDiv._subContainer;

    const isGeneric = (name) => {
        if (!name) return true;
        const n = name.toLowerCase();
        return n.includes('googleusercontent') || n.includes('akamai') || 
               n.includes('amazonaws') || n.includes('1e100.net') || 
               n.includes('risorsa web') || n === data.remoteIp;
    };

    if (titleDiv) {
        const currentTitle = titleDiv.textContent.trim();
        const needsImprovement = isGeneric(currentTitle) || currentTitle === data.technicalSubtitle;
        const incomingIsBetter = !isGeneric(data.resourceName);

        if (needsImprovement && incomingIsBetter) {
            titleDiv.textContent = data.resourceName;
        }
    }

    if (subContainer) {
        const currentTitle = titleDiv ? titleDiv.textContent.trim() : '';
        const getBaseDomain = (dom) => {
            if (!dom) return '';
            const parts = dom.toLowerCase().split('.');
            return parts.length >= 2 ? parts.slice(-2).join('.') : dom;
        };

        const titleBase = getBaseDomain(currentTitle);
        const subBase = getBaseDomain(data.technicalSubtitle);

        if (data.technicalSubtitle && data.technicalSubtitle !== currentTitle && (titleBase === subBase || titleBase === '')) {
            subContainer.innerHTML = `<div class="technical-subtitle" style="color: #94a3b8; font-size: 0.85em; font-family: monospace; border-left: 2px solid #38bdf8; padding-left: 8px; margin-bottom: 4px;">${data.technicalSubtitle}</div>`;
        } else {
            subContainer.innerHTML = '';
        }
    }

    sessionDiv.setAttribute('data-kb', data.totalKB || 0);
    if (sessionDiv._meterEl) {
        sessionDiv._meterEl.innerText = `${data.totalKB || 0} KB Tot.`;
    }
}

// ================================================================================
// ORDINAMENTO CARD ED ELIMINAZIONE
// ================================================================================
function sortCardsByUsage() {
    if (sortThrottleTimeout) return;

    sortThrottleTimeout = setTimeout(() => {
        const targetDashboard = dashboard || document.getElementById('dashboard');
        if (!targetDashboard) {
            sortThrottleTimeout = null;
            return;
        }

        const cards = Array.from(targetDashboard.querySelectorAll('.session-card'));
        if (cards.length < 2) {
            sortThrottleTimeout = null;
            return;
        }

        let needsReorder = false;
        for (let i = 0; i < cards.length - 1; i++) {
            const kbA = parseFloat(cards[i].getAttribute('data-kb') || 0);
            const kbB = parseFloat(cards[i + 1].getAttribute('data-kb') || 0);
            if (kbA < kbB) {
                needsReorder = true;
                break;
            }
        }

        if (needsReorder) {
            cards.sort((a, b) => parseFloat(b.getAttribute('data-kb') || 0) - parseFloat(a.getAttribute('data-kb') || 0));
            cards.forEach(card => targetDashboard.appendChild(card));
        }

        sortThrottleTimeout = null;
    }, 1000);
}

function removeSessionCard(sessionId) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) sessionDiv.remove();
}

function markSessionClosed(sessionId, reason) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) {
        if (reason === 'Idle Timeout') {
            sessionDiv.classList.add('dimmed-card');
        } else {
            sessionDiv.classList.add('closed-card');
        }
        sessionDiv.dataset.closed = 'true';
        if (window.FilterManager) window.FilterManager.evaluateNewCard(sessionDiv);
    }
}

// ================================================================================
// GESTIONE PAUSA / RIPRESA CARD LIVE E RENDERING CARD DA DB IMPORTATO
// ================================================================================
// Le card live NON vengono mai distrutte durante la pausa: si applica una classe CSS
// (vedi style.css, .paused-hidden) che le nasconde con !important, indipendentemente
// dallo stato del display inline già gestito dai filtri. In questo modo, al ritorno da
// un DB importato, le card riappaiono esattamente come erano prima della pausa —
// compreso lo stato dei filtri attivi — senza bisogno di ricostruire nulla.

/**
 * Nasconde tutte le card del traffico live (senza rimuoverle dal DOM)
 */
function pauseLiveCards() {
    document.querySelectorAll('.session-card.live-card').forEach(card => {
        card.classList.add('paused-hidden');
    });
}

/**
 * Rimuove la pausa dalle card live: tornano visibili con lo stato (filtri, bordi) di prima
 */
function resumeLiveCards() {
    document.querySelectorAll('.session-card.live-card').forEach(card => {
        card.classList.remove('paused-hidden');
    });
}

/**
 * Costruisce una card "compatta" per una sessione proveniente da un DB importato
 * (niente log pacchetti in tempo reale: quel dato semplicemente non esiste per una sessione storica)
 */
function createImportedCardNode(session) {
    const sessionDiv = document.createElement('div');
    sessionDiv.id = `imported-${session.session_id || session.remote_ip}`;
    sessionDiv.className = 'session-card imported-card';

    const countryBadge = `<span style="background:#334155; padding:2px 6px; border-radius:4px; font-size:0.7em; margin-left:8px;">${session.country || 'N/A'}</span>`;
    const importedBadge = `<span style="background:#f59e0b; color:#1e293b; padding:2px 6px; border-radius:4px; font-size:0.7em; margin-left:6px; font-weight:bold;">📁 IMPORTATA</span>`;

    const totalBytes = Number(session.total_bytes) || 0;
    const totalKB = (totalBytes / 1024).toFixed(2);
    const hopsCount = Array.isArray(session.hops) ? session.hops.length : 0;
    const statusLabel = session.status === 'active' ? 'Attiva' : (session.status === 'idle' ? 'Inattiva' : 'Chiusa');

    sessionDiv.innerHTML = `
        <div class="session-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div class="res-title"
                    style="color: #facc15; font-size: 1.1em; font-weight: bold; word-break: break-all;"
                    title="Clicca per centrare la mappa su questa destinazione">
                    ${session.resource_name || session.host_name || session.remote_ip}
                </div>
                <div style="color: #64748b; font-size: 0.75em; font-family: monospace;">
                    IP: ${session.remote_ip} ${countryBadge} ${importedBadge}
                </div>
            </div>
            <div class="bandwidth-meter" style="text-align: right; color: #10b981; font-weight: bold; font-family: monospace; font-size: 0.9em; min-width: 110px;">
                ${totalKB} KB Tot.
            </div>
        </div>
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #334155; font-size: 0.85em; color: #94a3b8; display: flex; flex-direction: column; gap: 4px;">
            <span>🔌 Servizio: <b style="color:#cbd5e1;">${session.service || 'N/A'}</b></span>
            <span>🏢 Provider: <b style="color:#cbd5e1;">${session.provider || 'N/A'}</b></span>
            <span>🛰️ Nodi traceroute salvati: <b style="color:#cbd5e1;">${hopsCount}</b></span>
            <span>📶 Stato: <b style="color:#cbd5e1;">${statusLabel}</b></span>
            <span>🕒 Ultima attività: <b style="color:#cbd5e1;">${session.last_seen || 'N/A'}</b></span>
        </div>
    `;

    // Click sulla card: centra la mappa sulla destinazione (se ha coordinate)
    if (session.lat !== null && session.lat !== undefined && session.lon !== null && session.lon !== undefined) {
        sessionDiv.style.cursor = 'pointer';
        sessionDiv.addEventListener('click', () => {
            if (window.map && typeof window.map.setView === 'function') {
                window.map.setView([session.lat, session.lon], 6, { animate: true, duration: 0.8 });
            }
        });
    }

    return sessionDiv;
}

/**
 * Svuota tutte le card precedentemente renderizzate da un DB importato
 */
function clearImportedCards() {
    document.querySelectorAll('.session-card.imported-card').forEach(card => card.remove());
}

/**
 * Ricostruisce nell'area "Comunicazioni Attive" le card di tutte le sessioni del DB importato
 */
function renderImportedCards(sessions) {
    const targetDashboard = dashboard || document.getElementById('dashboard');
    if (!targetDashboard) return;

    clearImportedCards();

    if (!Array.isArray(sessions) || sessions.length === 0) return;

    // Stesso criterio delle card live (sortCardsByUsage): connessione "più pesante" prima
    const sortedSessions = [...sessions].sort((a, b) => (Number(b.total_bytes) || 0) - (Number(a.total_bytes) || 0));

    const fragment = document.createDocumentFragment();
    sortedSessions.forEach(session => {
        fragment.appendChild(createImportedCardNode(session));
    });
    targetDashboard.appendChild(fragment);
}

window.UIManager = window.UIManager || {};
window.UIManager.pauseLiveCards = pauseLiveCards;
window.UIManager.resumeLiveCards = resumeLiveCards;
window.UIManager.renderImportedCards = renderImportedCards;
window.UIManager.clearImportedCards = clearImportedCards;

// Event Listeners DOM
document.addEventListener('DOMContentLoaded', () => {
    const toggleDashboardBtn = document.getElementById('toggle-dashboard-btn');
    const dashboardContainer = document.getElementById('dashboard');

    if (toggleDashboardBtn && dashboardContainer) {
        const btnText = toggleDashboardBtn.querySelector('.btn-text');
        const btnIcon = toggleDashboardBtn.querySelector('.btn-icon');

        toggleDashboardBtn.addEventListener('click', () => {
            const isCollapsed = dashboardContainer.classList.toggle('collapsed');
            if (btnText) btnText.textContent = isCollapsed ? 'Mostra' : 'Nascondi';
            if (btnIcon) btnIcon.textContent = isCollapsed ? '▼' : '▲';
        });
    }

    if (dashboardContainer) {
        dashboardContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.session-card');
            if (!card || window.getSelection().toString().length > 0) return;
            if (typeof window.focusLastHop === 'function') {
                window.focusLastHop(card.id);
            }
        });
    }
});