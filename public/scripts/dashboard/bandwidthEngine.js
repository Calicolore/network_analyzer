/**
 * ====================================================================================
 * MOTORE GRAFICO BANDA (dashboard/bandwidthEngine.js)
 * ====================================================================================
 * Inizializza e renderizza il grafico Chart.js della banda, in due modalità: grafico
 * "Temporale" (line, download/upload al secondo) e "Per Connessione" (bar, totale byte
 * per connessione). Gestisce anche il selettore di modalità e l'accordion di
 * apertura/chiusura del riquadro.
 * Dipende da: bandwidthFeed.js (lineLabels/lineDownloadData/lineUploadData,
 * getActiveTrafficMap/getActiveColorMap, isImportedModeActive, initSocketListener).
 * ====================================================================================
 */

let bandwidthChart = null;
let currentChartMode = 'line'; // 'line' | 'bar'

/**
 * Crea l'istanza Chart.js (inizialmente in modalità "Temporale") e avvia accordion,
 * selettore di modalità e listener socket. Chiamata una sola volta, su DOMContentLoaded.
 */
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
 * Opzioni Chart.js per il grafico "Temporale" (line).
 *
 * @returns {object} Oggetto opzioni Chart.js
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
 * Opzioni Chart.js per il grafico "Per Connessione" (bar).
 *
 * @returns {object} Oggetto opzioni Chart.js
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
 * Ridisegna il grafico in modalità "Temporale" (line) con i dati correnti di bandwidthFeed.js.
 */
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

/**
 * Ridisegna il grafico in modalità "Per Connessione" (bar), usando la mappa di traffico
 * attiva (live o DB importato, vedi bandwidthFeed.js getActiveTrafficMap/getActiveColorMap).
 */
function renderBarView() {
    bandwidthChart.config.type = 'bar';
    bandwidthChart.options = getBarChartOptions();

    const activeTrafficMap = getActiveTrafficMap();
    const activeColorMap = getActiveColorMap();

    const sortedConnections = Array.from(activeTrafficMap.entries())
        .sort((a, b) => b[1] - a[1]);

    const connectionLabels = sortedConnections.map(([connName]) => connName);
    const connectionDataKB = sortedConnections.map(([, bytes]) => (bytes / 1024).toFixed(1));
    const connectionColors = sortedConnections.map(([connName]) => activeColorMap.get(connName) || '#38bdf8');

    bandwidthChart.data.labels = connectionLabels;
    bandwidthChart.data.datasets = [
        {
            label: isImportedModeActive() ? 'Banda (KB) — DB Importato' : 'Banda (KB)',
            data: connectionDataKB,
            backgroundColor: connectionColors,
            borderColor: connectionColors,
            borderWidth: 1.5,
            borderRadius: 4
        }
    ];

    bandwidthChart.update('none');
}

/**
 * Collega i due pulsanti Temporale/Per Connessione al cambio di `currentChartMode`
 * e al conseguente ridisegno del grafico.
 */
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

/**
 * Collega il pulsante di apertura/chiusura del riquadro grafico banda, ridimensionando
 * il canvas Chart.js alla riapertura (Chart.js non ridisegna da solo un canvas che era
 * `display:none`).
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

document.addEventListener('DOMContentLoaded', () => {
    initBandwidthChart();
});
