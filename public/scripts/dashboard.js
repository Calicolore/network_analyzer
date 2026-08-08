/**
 * Controller Principale - Connessione WebSocket e Orchestrazione (dashboard.js)
 */

const socket = io();

// Mappa in memoria per tracciare i dati aggiornati di ciascuna sessione
const sessionsMap = new Map();

// ------------------------------------------------------------------
// INIZIALIZZAZIONE FILTRI
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    if (window.filterManager) {
        window.filterManager.init(() => {
            applyFiltersToDashboardUI();
        });
    }
    // Nota: Il calcolo del grafico della banda è delegato interamente a bandwidthChart.js
    // per evitare conflitti e duplicazioni.
});

// ------------------------------------------------------------------
// WEBSOCKET EVENTS
// ------------------------------------------------------------------

// 1. Posizione iniziale PC
socket.on('home_location', (data) => {
    if (typeof setHomeLocation === 'function') {
        setHomeLocation(data.coords);
    }
});

// 2. Ricezione nuovi pacchetti
socket.on('new_packet', (data) => {
    if (!data || !data.sessionId) return;

    // Mantiene aggiornati i dati della sessione
    sessionsMap.set(data.sessionId, data);

    // Registra i valori unici nei filtri
    if (window.filterManager) {
        window.filterManager.updateAvailableFilters(data);
    }

    // Renderizza e aggiorna visibilità della card
    if (typeof renderPacketCard === 'function') {
        renderPacketCard(data);
    }

    const card = document.getElementById(data.sessionId);
    if (card) {
        const matchesFilter = !window.filterManager || window.filterManager.isPacketMatchingFilters(data);
        card.style.display = matchesFilter ? '' : 'none';
        card.setAttribute('data-last-active', Date.now());
    }

    // Aggiorna la mappa
    if (typeof updateMapPacket === 'function') {
        updateMapPacket(data);
    }
});

// 3. Ricezione hop del Traceroute
socket.on('traceroute_hop', (data) => {
    if (typeof updateMapTraceroute === 'function') {
        updateMapTraceroute(data);
    }
});

// 4. Gestione chiusura sessione
socket.on('session_closed', (data) => {
    if (typeof markSessionClosed === 'function') {
        markSessionClosed(data.sessionId);
    }
});

// ------------------------------------------------------------------
// FUNZIONI AUSILIARIE PER I FILTRI
// ------------------------------------------------------------------

function applyFiltersToDashboardUI() {
    sessionsMap.forEach((packetData, sessionId) => {
        const card = document.getElementById(sessionId);
        if (card) {
            const matches = window.filterManager ? window.filterManager.isPacketMatchingFilters(packetData) : true;
            card.style.display = matches ? '' : 'none';
        }
    });
}

window.removeSession = function(sessionId) {
    sessionsMap.delete(sessionId);
    if (typeof removeSessionCard === 'function') removeSessionCard(sessionId);
    if (typeof removeSessionFromMap === 'function') removeSessionFromMap(sessionId);
};

if (typeof initSettingsUI === 'function') {
    initSettingsUI();
}