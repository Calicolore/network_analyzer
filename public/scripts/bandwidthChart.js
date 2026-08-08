/**
 * ====================================================================================
 * GESTORE GRAFICO BANDA IN TEMPO REALE (bandwidthChart.js)
 * ====================================================================================
 */

let bandwidthChart = null;
const MAX_DATA_POINTS = 30;

// Accumulatori di Byte per il secondo corrente
let currentDownloadBytes = 0;
let currentUploadBytes = 0;

function initBandwidthChart() {
    const ctx = document.getElementById('bandwidthChart')?.getContext('2d');
    if (!ctx) return;

    const initialLabels = Array(MAX_DATA_POINTS).fill('');
    const emptyData = Array(MAX_DATA_POINTS).fill(0);

    bandwidthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: initialLabels,
            datasets: [
                {
                    label: 'Download (KB/s)',
                    data: [...emptyData],
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'Upload (KB/s)',
                    data: [...emptyData],
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 250
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#94a3b8',
                        font: { size: 11 }
                    }
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
        }
    });

    initBandwidthAccordion();
    initSocketListener();
}

/**
 * Inizializza l'ascolto Socket.io per calcolare la banda istantanea
 */
function initSocketListener() {
    // Recupera la connessione Socket.io globale
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return;
    window.socket = socket;

    socket.on('new_packet', (packet) => {
        // Estrazione della dimensione dal payload WebSocket
        const bytes = packet.size || packet.length || packet.len || 0;
        
        // Verifica della direzione (supporta sia la freccia che il flag booleano)
        const isUpload = packet.direction === '-->' || packet.isOutbound === true;

        if (isUpload) {
            currentUploadBytes += bytes;
        } else {
            currentDownloadBytes += bytes;
        }
    });

    // Ogni 1 secondo calcola i KB/s e aggiorna grafico e testo
    setInterval(() => {
        const downloadKB = currentDownloadBytes / 1024;
        const uploadKB = currentUploadBytes / 1024;

        updateBandwidthData(downloadKB, uploadKB);

        // Azzera i contatori per il secondo successivo
        currentDownloadBytes = 0;
        currentUploadBytes = 0;
    }, 1000);
}

/**
 * Inizializza il comportamento a tendina per il grafico della banda
 */
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

function updateBandwidthData(downloadKB, uploadKB) {
    if (!bandwidthChart) return;

    const nowLabel = new Date().toLocaleTimeString();

    const labels = bandwidthChart.data.labels;
    const downloadData = bandwidthChart.data.datasets[0].data;
    const uploadData = bandwidthChart.data.datasets[1].data;

    labels.push(nowLabel);
    downloadData.push(downloadKB);
    uploadData.push(uploadKB);

    if (labels.length > MAX_DATA_POINTS) {
        labels.shift();
        downloadData.shift();
        uploadData.shift();
    }

    bandwidthChart.update();

    // Aggiornamento del testo sotto/sopra il grafico
    const statsTextEl = document.getElementById('bandwidth-stats-text');
    if (statsTextEl) {
        statsTextEl.textContent = `Download: ${downloadKB.toFixed(1)} KB/s | Upload: ${uploadKB.toFixed(1)} KB/s`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initBandwidthChart();
});

window.bandwidthChartManager = {
    update: updateBandwidthData
};