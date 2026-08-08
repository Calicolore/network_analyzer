/**
 * Controller Principale - Connessione WebSocket e Orchestrazione
 */

const socket = io();

// 1. Posizione iniziale PC
socket.on('home_location', (data) => {
    setHomeLocation(data.coords);
});

// 2. Ricezione nuovi pacchetti
socket.on('new_packet', (data) => {
    renderPacketCard(data);
    updateMapPacket(data);
    
    // Salva il timestamp dell'ultimo pacchetto per il controllo inattivi
    const card = document.getElementById(data.sessionId);
    if (card) {
        card.setAttribute('data-last-active', Date.now());
    }
});

// 3. Ricezione hop del Traceroute
socket.on('traceroute_hop', (data) => {
    updateMapTraceroute(data);
});

// 4. Gestione chiusura sessione (Bordo Rosso)
socket.on('session_closed', (data) => {
    markSessionClosed(data.sessionId);
});

/**
 * Funzione globale per rimuovere completamente una sessione sia dalla Dashboard che dalla Mappa
 */
window.removeSession = function(sessionId) {
    removeSessionCard(sessionId);
    removeSessionFromMap(sessionId);
};

initSettingsUI();
