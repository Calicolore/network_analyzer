/**
 * Controller Principale - Connessione WebSocket e Orchestrazione (dashboard.js)
 */

const socket = io();

// Mappa in memoria per tracciare i dati aggiornati di ciascuna sessione
const sessionsMap = new Map();

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

socket.on('home_location', (data) => {
    if (typeof setHomeLocation === 'function') {
        setHomeLocation(data.coords);
    }
});

/**
 * Gestione dei pacchetti in batch a 20 FPS
 */
socket.on('packet_batch', (packets) => {
    if (!Array.isArray(packets) || packets.length === 0) return;

    // 1. Aggiornamento dati in memoria (sincrono e veloce)
    packets.forEach((data) => {
        if (!data || !data.sessionId) return;
        sessionsMap.set(data.sessionId, data);

        if (window.filterManager) {
            window.filterManager.updateAvailableFilters(data);
        }
    });

    // 2. Render UI nel primo frame utile del browser per evitare reflow lag
    requestAnimationFrame(() => {
        packets.forEach((data) => {
            if (typeof renderPacketCard === 'function') {
                renderPacketCard(data);
            }

            const card = document.getElementById(data.sessionId);
            if (card) {
                const matchesFilter = !window.filterManager || window.filterManager.isPacketMatchingFilters(data);
                card.style.display = matchesFilter ? '' : 'none';
                card.setAttribute('data-last-active', Date.now());
            }

            if (typeof updateMapPacket === 'function') {
                updateMapPacket(data);
            }
        });
    });
});

// Mantenuto per retrocompatibilità con eventi singoli isolati
socket.on('new_packet', (data) => {
    if (!data || !data.sessionId) return;

    sessionsMap.set(data.sessionId, data);

    if (window.filterManager) {
        window.filterManager.updateAvailableFilters(data);
    }

    requestAnimationFrame(() => {
        if (typeof renderPacketCard === 'function') {
            renderPacketCard(data);
        }

        const card = document.getElementById(data.sessionId);
        if (card) {
            const matchesFilter = !window.filterManager || window.filterManager.isPacketMatchingFilters(data);
            card.style.display = matchesFilter ? '' : 'none';
            card.setAttribute('data-last-active', Date.now());
        }

        if (typeof updateMapPacket === 'function') {
            updateMapPacket(data);
        }
    });
});

socket.on('traceroute_hop', (data) => {
    if (typeof updateMapTraceroute === 'function') {
        updateMapTraceroute(data);
    }
});

socket.on('session_closed', (data) => {
    if (typeof markSessionClosed === 'function') {
        // Passiamo sia l'ID che il motivo della chiusura
        markSessionClosed(data.sessionId, data.reason); 
    }
});

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