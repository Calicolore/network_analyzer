/**
 * ====================================================================================
 * BUFFERING E FLUSH DEI PACCHETTI IN INGRESSO (dashboard/uiPacketBuffer.js)
 * ====================================================================================
 * Accumula i pacchetti ricevuti via WebSocket in un buffer e li processa a raffica
 * ogni 100ms: crea le card di sessione mancanti, aggiorna intestazione/banda, appende
 * le righe di log pacchetto, e aggiorna i dataset usati dai filtri.
 * Dipende da: uiCardHelpers.js (createCardNode, updateCardHeader, sortCardsByUsage).
 * ====================================================================================
 */

const dashboard = document.getElementById('dashboard');

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
        sessionDiv.dataset.flow = (lastPacket.flow || '').toLowerCase();
    });

    // Se ci sono nuove card create nel ciclo, vengono appese in un unico colpo al DOM
    if (newCardsFragment.children.length > 0) {
        targetDashboard.appendChild(newCardsFragment);
    }

    sortCardsByUsage();
}
