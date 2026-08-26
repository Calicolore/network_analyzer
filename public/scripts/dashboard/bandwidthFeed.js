/**
 * ====================================================================================
 * ALIMENTAZIONE DATI DEL GRAFICO BANDA (dashboard/bandwidthFeed.js)
 * ====================================================================================
 * Ascolta il traffico live via Socket.IO e accumula i dati per il grafico banda:
 * buffer storico "Temporale" (line) e mappe di traffico per connessione (bar), sia
 * per il traffico live sia per un eventuale DB importato.
 *
 * NOTA SULLA MODALITÀ "DB IMPORTATO":
 * Quando è attivo un DB importato (window.analyticsExport.isImportedMode === true),
 * il traffico live è in pausa generale (vedi dashboard.js). Coerentemente:
 * - Il grafico "Temporale" resta piatto a zero (nessun pacchetto live in arrivo).
 * - Il grafico "Per Connessione" mostra i totali del DB importato, non l'accumulo live.
 * - Le statistiche Download/Upload restano a 0.0 KB/s.
 * L'accumulo live NON viene mai azzerato durante la pausa: viene solo "congelato" in una
 * mappa separata, così tornando a Real Time il grafico riprende esattamente da dove
 * si era fermato, senza perdere nulla.
 *
 * Dipende da: bandwidthEngine.js (bandwidthChart, currentChartMode, renderLineView,
 * renderBarView), consumato da esso per aggiornare i dati alla ricezione.
 * ====================================================================================
 */

const MAX_DATA_POINTS = 30;

// Accumulatori di Byte per il secondo corrente (Grafico Temporale, solo traffico live)
let currentDownloadBytes = 0;
let currentUploadBytes = 0;

// Buffer storico per il grafico a linee
let lineLabels = Array(MAX_DATA_POINTS).fill('');
let lineDownloadData = Array(MAX_DATA_POINTS).fill(0);
let lineUploadData = Array(MAX_DATA_POINTS).fill(0);

// Mappe per il traffico delle singole connessioni LIVE (grafico "Per Connessione")
const liveConnectionTrafficMap = new Map();
const liveConnectionColorMap = new Map();

// Mappe per il traffico delle singole connessioni del DB IMPORTATO
const importedConnectionTrafficMap = new Map();
const importedConnectionColorMap = new Map();

/**
 * Vero quando è attivo un DB importato (traffico live in pausa generale).
 *
 * @returns {boolean} true se è attiva la modalità DB importato
 */
function isImportedModeActive() {
    return !!(window.analyticsExport && window.analyticsExport.isImportedMode);
}

/**
 * Restituisce la mappa di traffico (byte totali per connessione) attiva in base alla
 * modalità corrente.
 *
 * @returns {Map<string, number>} Mappa nome-connessione -> byte totali
 */
function getActiveTrafficMap() {
    return isImportedModeActive() ? importedConnectionTrafficMap : liveConnectionTrafficMap;
}

/**
 * Restituisce la mappa colori (per connessione) attiva in base alla modalità corrente.
 *
 * @returns {Map<string, string>} Mappa nome-connessione -> colore
 */
function getActiveColorMap() {
    return isImportedModeActive() ? importedConnectionColorMap : liveConnectionColorMap;
}

/**
 * Genera colori ad alta luminosità per lo sfondo scuro della dashboard.
 *
 * @returns {string} Colore in formato esadecimale, es. "#A2C3F1"
 */
function generateRandomColor() {
    const letters = '89ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * letters.length)];
    }
    return color;
}

/**
 * Estrae il nome reale dal pacchetto live usando le proprietà trasmesse dal backend.
 *
 * @param {object} packet - Pacchetto live ricevuto dal server
 * @returns {string} Nome della connessione da usare come etichetta nel grafico a barre
 */
function extractConnectionName(packet) {
    if (!packet) return 'Connessione Sconosciuta';

    let name = packet.resourceName ||
               packet.hostName ||
               packet.provider;

    if (!name || name === 'Sconosciuto' || name === 'unknown') {
        name = packet.domain ||
               packet.hostname ||
               packet.host ||
               packet.site ||
               packet.service;
    }

    if (!name || name === 'Sconosciuto' || name === 'unknown') {
        name = packet.remoteIp ||
               packet.dst_ip ||
               packet.destination ||
               packet.ip ||
               packet.src_ip;
    }

    if (!name || name === 'Sconosciuto' || name === 'unknown') {
        name = 'Traffico Locale';
    }

    name = String(name).trim();

    name = name.replace(/^https?:\/\//, '');
    if (name.includes(':') && !name.includes('[')) {
        name = name.split(':')[0];
    }

    return name;
}

/**
 * Estrae il nome reale da una sessione del DB importato (schema snake_case).
 *
 * @param {object} session - Riga sessione dal DB importato
 * @returns {string} Nome della connessione da usare come etichetta nel grafico a barre
 */
function extractConnectionNameFromSession(session) {
    if (!session) return 'Connessione Sconosciuta';

    let name = session.resource_name || session.host_name || session.provider || session.remote_ip || 'Traffico Sconosciuto';

    name = String(name).trim();
    name = name.replace(/^https?:\/\//, '');
    if (name.includes(':') && !name.includes('[')) {
        name = name.split(':')[0];
    }

    return name;
}

/**
 * Avvia l'ascolto Socket.IO per il grafico banda: accumula i byte del pacchetto per il
 * grafico "Temporale" e per la connessione nel grafico "Per Connessione", poi ogni
 * secondo invia l'accumulo del grafico temporale a `updateBandwidthData`. Riusa
 * `window.socket` se già presente (impostata da dashboard.js) invece di aprire una
 * seconda connessione Socket.IO.
 */
function initSocketListener() {
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return;
    window.socket = socket;

    socket.on('new_packet', (packet) => {
        // Pausa generale: mentre un DB è importato, il traffico live non viene elaborato
        if (isImportedModeActive()) return;

        const bytes = packet.size || packet.length || packet.len || packet.bytes || 0;
        const isUpload = packet.direction === '-->' || packet.isOutbound === true;

        // 1. Dati grafico temporale
        if (isUpload) {
            currentUploadBytes += bytes;
        } else {
            currentDownloadBytes += bytes;
        }

        // 2. Dati grafico a barre (accumulo LIVE)
        const connName = extractConnectionName(packet);
        const prevTotal = liveConnectionTrafficMap.get(connName) || 0;
        liveConnectionTrafficMap.set(connName, prevTotal + bytes);

        // Associa il colore della sessione
        if (!liveConnectionColorMap.has(connName)) {
            const color = packet.sessionColor || generateRandomColor();
            liveConnectionColorMap.set(connName, color);
        }
    });

    setInterval(() => {
        if (isImportedModeActive()) {
            /**
             * Nessun traffico live in arrivo: grafico temporale piatto a zero,
             * statistiche Download/Upload a 0.0 KB/s. L'accumulo live resta congelato
             * (non azzerato) in liveConnectionTrafficMap, pronto per il ripristino.
             */
            updateBandwidthData(0, 0, true);
            currentDownloadBytes = 0;
            currentUploadBytes = 0;
            return;
        }

        const downloadKB = currentDownloadBytes / 1024;
        const uploadKB = currentUploadBytes / 1024;

        updateBandwidthData(downloadKB, uploadKB, false);

        currentDownloadBytes = 0;
        currentUploadBytes = 0;
    }, 1000);
}

/**
 * Aggiunge un campione al buffer storico del grafico "Temporale", aggiorna il testo
 * delle statistiche Download/Upload, e ridisegna il grafico nella modalità corrente.
 *
 * @param {number} downloadKB - KB scaricati nell'ultimo secondo
 * @param {number} uploadKB - KB caricati nell'ultimo secondo
 * @param {boolean} [isPaused] - true se in modalità DB importato (traffico live in pausa)
 */
function updateBandwidthData(downloadKB, uploadKB, isPaused = false) {
    const nowLabel = new Date().toLocaleTimeString();
    lineLabels.push(nowLabel);
    lineDownloadData.push(downloadKB);
    lineUploadData.push(uploadKB);

    if (lineLabels.length > MAX_DATA_POINTS) {
        lineLabels.shift();
        lineDownloadData.shift();
        lineUploadData.shift();
    }

    // Aggiornamento costante per TUTTE le modalità (Line e Bar)
    const statsTextEl = document.getElementById('bandwidth-stats-text');
    if (statsTextEl) {
        const suffix = isPaused ? ' — ⏸ DB importato (traffico live in pausa)' : '';
        statsTextEl.textContent = `Download: ${downloadKB.toFixed(1)} KB/s | Upload: ${uploadKB.toFixed(1)} KB/s${suffix}`;
    }

    if (!bandwidthChart) return;

    if (currentChartMode === 'line') {
        renderLineView();
    } else if (currentChartMode === 'bar') {
        renderBarView();
    }
}

/**
 * Carica nel grafico "Per Connessione" i totali del DB importato.
 * Chiamata da dbview/analyticsImport.js all'importazione di un nuovo DB.
 *
 * @param {object[]} sessions - Sessioni del DB importato (schema snake_case)
 */
function loadImportedBandwidthData(sessions) {
    importedConnectionTrafficMap.clear();
    importedConnectionColorMap.clear();

    if (Array.isArray(sessions)) {
        sessions.forEach(session => {
            const bytes = Number(session.total_bytes) || 0;
            if (bytes <= 0) return;

            const connName = extractConnectionNameFromSession(session);
            const prevTotal = importedConnectionTrafficMap.get(connName) || 0;
            importedConnectionTrafficMap.set(connName, prevTotal + bytes);

            if (!importedConnectionColorMap.has(connName)) {
                importedConnectionColorMap.set(connName, generateRandomColor());
            }
        });
    }

    // Se il grafico "Per Connessione" è già visibile, aggiorna subito senza aspettare il prossimo tick
    if (bandwidthChart && currentChartMode === 'bar') {
        renderBarView();
    }
}

/**
 * Svuota i dati del DB importato dal grafico "Per Connessione".
 * Chiamata da dbview/analyticsImport.js al ritorno in modalità Real Time.
 */
function clearImportedBandwidthData() {
    importedConnectionTrafficMap.clear();
    importedConnectionColorMap.clear();

    if (bandwidthChart && currentChartMode === 'bar') {
        renderBarView();
    }
}

window.bandwidthChartManager = {
    update: updateBandwidthData,
    setMode: (mode) => {
        currentChartMode = mode;
        if (bandwidthChart) {
            if (mode === 'bar') renderBarView();
            else renderLineView();
        }
    },
    loadImportedData: loadImportedBandwidthData,
    clearImportedData: clearImportedBandwidthData
};
