/**
 * ====================================================================================
 * CARD DA DB IMPORTATO E PAUSA/RIPRESA CARD LIVE (dashboard/uiImportedCards.js)
 * ====================================================================================
 * Le card live NON vengono mai distrutte durante la pausa: si applica una classe CSS
 * (vedi dashboard.css, .paused-hidden) che le nasconde con !important, indipendentemente
 * dallo stato del display inline già gestito dai filtri. In questo modo, al ritorno da
 * un DB importato, le card riappaiono esattamente come erano prima della pausa —
 * compreso lo stato dei filtri attivi — senza bisogno di ricostruire nulla.
 * Dipende da: mapCore.js (window.map, per il click-to-center sulla card importata),
 * uiCardHelpers.js (applyProviderUpdate, aggregata qui nell'export finale).
 * ====================================================================================
 */

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
 * (niente log pacchetti in tempo reale: quel dato semplicemente non esiste per una
 * sessione storica).
 *
 * @param {object} session - Riga sessione dal DB importato (schema snake_case)
 * @returns {HTMLDivElement} Il nodo card creato (non ancora inserito nel DOM)
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
 * Ricostruisce nell'area "Comunicazioni Attive" le card di tutte le sessioni del DB importato.
 *
 * @param {object[]} sessions - Sessioni del DB importato (schema snake_case)
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
window.UIManager.applyProviderUpdate = applyProviderUpdate;
