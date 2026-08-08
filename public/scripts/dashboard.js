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
});

// ------------------------------------------------------------------
// WEBSOCKET EVENTS
// ------------------------------------------------------------------

// 1. Posizione iniziale PC
socket.on('home_location', (data) => {
    setHomeLocation(data.coords);
});

// 2. Ricezione nuovi pacchetti
socket.on('new_packet', (data) => {
    if (!data || !data.sessionId) return;

    // Mantiene aggiornati i dati dell'ultima attività per la sessione
    sessionsMap.set(data.sessionId, data);

    // Registra i valori unici (Nazione, Servizio) per aggiornare i menu a tendina
    if (window.filterManager) {
        window.filterManager.updateAvailableFilters(data);
    }

    // Renderizza SEMPRE la card (se non esiste la crea, se esiste la aggiorna)
    renderPacketCard(data);

    // Aggiorna la visibilità della card in base ai filtri correnti
    const card = document.getElementById(data.sessionId);
    if (card) {
        const matchesFilter = !window.filterManager || window.filterManager.isPacketMatchingFilters(data);
        card.style.display = matchesFilter ? '' : 'none';
        card.setAttribute('data-last-active', Date.now());
    }

    // Aggiorna la mappa
    updateMapPacket(data);
});

// 3. Ricezione hop del Traceroute
socket.on('traceroute_hop', (data) => {
    updateMapTraceroute(data);
});

// 4. Gestione chiusura sessione (Bordo Rosso)
socket.on('session_closed', (data) => {
    markSessionClosed(data.sessionId);
});

// ------------------------------------------------------------------
// FUNZIONI AUSILIARIE PER I FILTRI
// ------------------------------------------------------------------

/**
 * Applica i filtri a tutte le card presenti nella dashboard
 */
function applyFiltersToDashboardUI() {
    sessionsMap.forEach((packetData, sessionId) => {
        const card = document.getElementById(sessionId);
        if (card) {
            const matches = window.filterManager ? window.filterManager.isPacketMatchingFilters(packetData) : true;
            card.style.display = matches ? '' : 'none';
        }
    });
}

/**
 * Funzione globale per rimuovere completamente una sessione sia dalla Dashboard che dalla Mappa
 */
window.removeSession = function(sessionId) {
    sessionsMap.delete(sessionId);
    removeSessionCard(sessionId);
    removeSessionFromMap(sessionId);
};

initSettingsUI();