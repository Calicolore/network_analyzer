/**
 * ====================================================================================
 * GESTORE GRAFICO BANDA IN TEMPO REALE (bandwidthChart.js)
 * ====================================================================================
 */

let bandwidthChart = null;
let currentChartMode = 'line'; // 'line' | 'bar'
const MAX_DATA_POINTS = 30;

// Accumulatori di Byte per il secondo corrente (Grafico Temporale)
let currentDownloadBytes = 0;
let currentUploadBytes = 0;

// Buffer storico per il grafico a linee
let lineLabels = Array(MAX_DATA_POINTS).fill('');
let lineDownloadData = Array(MAX_DATA_POINTS).fill(0);
let lineUploadData = Array(MAX_DATA_POINTS).fill(0);

// Mappa per il traffico delle singole connessioni attive
const connectionTrafficMap = new Map();

// Mappa per i colori univoci associati a ciascuna connessione
const connectionColorMap = new Map();

/**
 * Genera colori ad alta luminosità per lo sfondo scuro della dashboard.
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
 * Estrae il nome reale dal pacchetto usando le proprietà trasmesse dal backend
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

function initBandwidthChart() {
    const ctx = document.getElementById('bandwidthChart')?.getContext('2d');
    if (!ctx) return;

    bandwidthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: lineLabels,
            datasets: [
                {
                    label: 'Download (KB/s)',
                    data: lineDownloadData,
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'Upload (KB/s)',
                    data: lineUploadData,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }
            ]
        },
        options: getLineChartOptions()
    });

    initBandwidthAccordion();
    initModeSelector();
    initSocketListener();
}

/**
 * Opzioni Grafico Temporale
 */
function getLineChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
            legend: {
                display: true,
                labels: { color: '#94a3b8', font: { size: 11 } }
            },
            tooltip: {
                mode: 'index',
                intersect: false
            }
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { display: false }
            },
            y: {
                beginAtZero: true,
                grid: { color: '#334155' },
                ticks: {
                    color: '#94a3b8',
                    font: { size: 10 },
                    callback: (val) => `${val} KB/s`
                }
            }
        }
    };
}

/**
 * Opzioni Grafico a Barre
 */
function getBarChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                enabled: true,
                callbacks: {
                    title: (tooltipItems) => `Connessione: ${tooltipItems[0].label}`,
                    label: (context) => ` Banda richiesta: ${context.raw} KB`
                }
            }
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: {
                    color: '#f1f5f9',
                    font: { size: 11, weight: 'bold' },
                    maxRotation: 45,
                    minRotation: 0
                }
            },
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Connessioni (KB)',
                    color: '#94a3b8',
                    font: { size: 12, weight: 'bold' }
                },
                grid: { color: '#334155' },
                ticks: {
                    color: '#94a3b8',
                    font: { size: 10 },
                    callback: (val) => `${val} KB`
                }
            }
        }
    };
}

/**
 * Ascolto Socket.io
 */
function initSocketListener() {
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return;
    window.socket = socket;

    socket.on('new_packet', (packet) => {
        const bytes = packet.size || packet.length || packet.len || packet.bytes || 0;
        const isUpload = packet.direction === '-->' || packet.isOutbound === true;

        // 1. Dati grafico temporale
        if (isUpload) {
            currentUploadBytes += bytes;
        } else {
            currentDownloadBytes += bytes;
        }

        // 2. Dati grafico a barre
        const connName = extractConnectionName(packet);
        const prevTotal = connectionTrafficMap.get(connName) || 0;
        connectionTrafficMap.set(connName, prevTotal + bytes);

        // Associa il colore della sessione
        if (!connectionColorMap.has(connName)) {
            const color = packet.sessionColor || generateRandomColor();
            connectionColorMap.set(connName, color);
        }
    });

    setInterval(() => {
        const downloadKB = currentDownloadBytes / 1024;
        const uploadKB = currentUploadBytes / 1024;

        updateBandwidthData(downloadKB, uploadKB);

        currentDownloadBytes = 0;
        currentUploadBytes = 0;
    }, 1000);
}

function updateBandwidthData(downloadKB, uploadKB) {
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
        statsTextEl.textContent = `Download: ${downloadKB.toFixed(1)} KB/s | Upload: ${uploadKB.toFixed(1)} KB/s`;
    }

    if (!bandwidthChart) return;

    if (currentChartMode === 'line') {
        renderLineView();
    } else if (currentChartMode === 'bar') {
        renderBarView();
    }
}

function renderLineView() {
    bandwidthChart.config.type = 'line';
    bandwidthChart.options = getLineChartOptions();

    bandwidthChart.data.labels = lineLabels;
    bandwidthChart.data.datasets = [
        {
            label: 'Download (KB/s)',
            data: lineDownloadData,
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0
        },
        {
            label: 'Upload (KB/s)',
            data: lineUploadData,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0
        }
    ];

    bandwidthChart.update('none');
}

function renderBarView() {
    bandwidthChart.config.type = 'bar';
    bandwidthChart.options = getBarChartOptions();

    const sortedConnections = Array.from(connectionTrafficMap.entries())
        .sort((a, b) => b[1] - a[1]);

    const connectionLabels = sortedConnections.map(([connName]) => connName);
    const connectionDataKB = sortedConnections.map(([, bytes]) => (bytes / 1024).toFixed(1));
    const connectionColors = sortedConnections.map(([connName]) => connectionColorMap.get(connName) || '#38bdf8');

    bandwidthChart.data.labels = connectionLabels;
    bandwidthChart.data.datasets = [
        {
            label: 'Banda (KB)',
            data: connectionDataKB,
            backgroundColor: connectionColors,
            borderColor: connectionColors,
            borderWidth: 1.5,
            borderRadius: 4
        }
    ];

    bandwidthChart.update('none');
}

function initModeSelector() {
    const btnLine = document.getElementById('btn-chart-line');
    const btnBar = document.getElementById('btn-chart-bar');

    if (!btnLine || !btnBar) return;

    btnLine.addEventListener('click', () => {
        if (currentChartMode === 'line') return;
        currentChartMode = 'line';
        
        btnLine.classList.add('active');
        btnBar.classList.remove('active');

        if (bandwidthChart) renderLineView();
    });

    btnBar.addEventListener('click', () => {
        if (currentChartMode === 'bar') return;
        currentChartMode = 'bar';

        btnBar.classList.add('active');
        btnLine.classList.remove('active');

        if (bandwidthChart) renderBarView();
    });
}

function initBandwidthAccordion() {
    const toggleBtn = document.getElementById('toggle-bandwidth-btn');
    const container = document.getElementById('bandwidth-container');

    if (toggleBtn && container) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = container.style.display === 'none';
            container.style.display = isHidden ? 'block' : 'none';

            const btnText = toggleBtn.querySelector('.btn-text');
            const btnIcon = toggleBtn.querySelector('.btn-icon');

            if (btnText) btnText.textContent = isHidden ? 'Nascondi' : 'Mostra';
            if (btnIcon) btnIcon.textContent = isHidden ? '▲' : '▼';

            if (isHidden && bandwidthChart) {
                setTimeout(() => {
                    bandwidthChart.resize();
                }, 50);
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initBandwidthChart();
});

window.bandwidthChartManager = {
    update: updateBandwidthData,
    setMode: (mode) => {
        currentChartMode = mode;
        if (bandwidthChart) {
            if (mode === 'bar') renderBarView();
            else renderLineView();
        }
    }
};