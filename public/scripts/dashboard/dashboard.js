/**
 * ====================================================================================
 * CONTROLLER PRINCIPALE — CONNESSIONE WEBSOCKET E ORCHESTRAZIONE (dashboard/dashboard.js)
 * ====================================================================================
 * Apre la connessione Socket.IO e smista ogni evento in arrivo verso i moduli
 * mappa/card/filtri/grafico banda già caricati. È l'ultimo file del gruppo
 * "dashboard" ad essere caricato, quindi può contare sull'esistenza di tutte le
 * funzioni/global che consuma.
 * ====================================================================================
 */

const socket = io();

// Mappa in memoria per tracciare i dati aggiornati di ciascuna sessione
const sessionsMap = new Map();

/**
 * Vero quando è attivo un DB importato: in questo stato il traffico live viene messo
 * in PAUSA GENERALE, non solo nascosto. Nessun evento socket viene elaborato (niente
 * aggiornamento di sessionsMap, niente DOM, niente mappa): lo sniffing lato server
 * continua a scrivere sul DB, ma il client smette letteralmente di occuparsene finché
 * non si preme "Torna a Real Time".
 */
function isLiveTrafficPaused() {
    return !!(window.analyticsExport && window.analyticsExport.isImportedMode);
}

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
    if (isLiveTrafficPaused()) return;
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
        if (isLiveTrafficPaused()) return; // Ricontrollo: potremmo essere passati a import nel frattempo

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
    if (isLiveTrafficPaused()) return;
    if (!data || !data.sessionId) return;

    sessionsMap.set(data.sessionId, data);

    if (window.filterManager) {
        window.filterManager.updateAvailableFilters(data);
    }

    requestAnimationFrame(() => {
        if (isLiveTrafficPaused()) return;

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
    if (isLiveTrafficPaused()) return;
    if (typeof updateMapTraceroute === 'function') {
        updateMapTraceroute(data);
    }
});

socket.on('provider_resolved', (data) => {
    if (isLiveTrafficPaused()) return;
    if (window.UIManager && typeof window.UIManager.applyProviderUpdate === 'function') {
        window.UIManager.applyProviderUpdate(data);
    }
});

socket.on('session_closed', (data) => {
    if (isLiveTrafficPaused()) return;
    if (typeof markSessionClosed === 'function') {
        // Passiamo sia l'ID che il motivo della chiusura
        markSessionClosed(data.sessionId, data.reason);
    }
});

function applyFiltersToDashboardUI() {
    if (isLiveTrafficPaused()) return;

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
if (typeof startAutoCleanupTask === 'function') {
    startAutoCleanupTask();
}
