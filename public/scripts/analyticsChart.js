/**
 * analyticsChart.js
 * Gestione dei contatori KPI e del grafico a torta dinamico ad alte prestazioni.
 */

let analyticsPieChart = null;

const CHART_COLORS = [
    '#38bdf8', '#3b82f6', '#818cf8', '#a855f7',
    '#ec4899', '#f43f5e', '#10b981', '#f59e0b',
    '#06b6d4', '#6366f1', '#d946ef', '#84cc16', '#64748b'
];

function formatBytesChart(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Verificatore dei valori non definiti o non validi
 */
function isUndefinedValue(val, param) {
    if (!val) return true;
    const str = String(val).trim().toLowerCase();
    if (str === '' || str === 'unknown' || str === 'n/a' || str === 'non definito' || str === 'sconosciuta' || str === '-') return true;
    if (param === 'country' && (str === '??' || str === '?')) return true;
    return false;
}

/**
 * Aggiorna sia i contatori KPI in cima sia il grafico a torta
 */
function updateAnalyticsDashboard(filteredData = [], totalData = []) {
    const filteredCount = filteredData.length;
    const totalCount = totalData.length;

    // 1. KPI Connessioni
    const connElem = document.getElementById('kpi-connections');
    const percElem = document.getElementById('kpi-percentage');
    if (connElem && percElem) {
        connElem.innerText = `${filteredCount} / ${totalCount}`;
        const pct = totalCount > 0 ? ((filteredCount / totalCount) * 100).toFixed(1) : '0';
        percElem.innerText = `(${pct}% del totale DB)`;
    }

    // 2. KPI Traffico
    const filteredBytes = filteredData.reduce((acc, row) => acc + (Number(row.total_bytes) || 0), 0);
    const totalBytes = totalData.reduce((acc, row) => acc + (Number(row.total_bytes) || 0), 0);

    const bwElem = document.getElementById('kpi-bandwidth');
    const bwSubElem = document.getElementById('kpi-bandwidth-subtext');
    if (bwElem && bwSubElem) {
        bwElem.innerText = formatBytesChart(filteredBytes);
        bwSubElem.innerText = `${formatBytesChart(totalBytes)} totali nel DB`;
    }

    // 3. KPI Nazioni (esclude nazioni non definite)
    const uniqueCountries = new Set(
        filteredData.map(r => r.country).filter(c => !isUndefinedValue(c, 'country'))
    );
    const countryElem = document.getElementById('kpi-countries');
    if (countryElem) {
        countryElem.innerText = uniqueCountries.size;
    }

    // 4. Aggiorna Grafico
    renderAnalyticsChart(filteredData);
}

/**
 * Disegna o aggiorna in-place il grafico a torta
 */
function renderAnalyticsChart(data = []) {
    const canvas = document.getElementById('analyticsPieChart');
    const undefinedInfoElem = document.getElementById('undefined-stats-info');
    if (!canvas) return;

    const selectedParam = document.getElementById('paramSelect')?.value || 'country';
    const totalCount = data.length;

    if (totalCount === 0) {
        if (analyticsPieChart) {
            analyticsPieChart.destroy();
            analyticsPieChart = null;
        }
        if (undefinedInfoElem) undefinedInfoElem.innerHTML = '';
        return;
    }

    // Conteggio separato tra dati validi e dati non definiti ("??", "Non Definito", ecc.)
    const rawCounts = {};
    let undefinedCount = 0;

    data.forEach(row => {
        const val = row[selectedParam];
        if (isUndefinedValue(val, selectedParam)) {
            undefinedCount++;
        } else {
            const strVal = String(val).trim();
            rawCounts[strVal] = (rawCounts[strVal] || 0) + 1;
        }
    });

    const validTotalCount = totalCount - undefinedCount;

    // Aggiorna l'area di testo sotto il grafico
    if (undefinedInfoElem) {
        if (undefinedCount > 0) {
            const paramLabel = selectedParam === 'country' ? 'Nazione non definita ("??")' :
                selectedParam === 'provider' ? 'Provider non definito' : 'Valore non definito';
            undefinedInfoElem.innerHTML = `⚠️ <strong>${undefinedCount}</strong> connessioni con <em>${paramLabel}</em> escluse dal grafico (percentuali calcolate sulle <strong>${validTotalCount}</strong> connessioni valide).`;
        } else {
            undefinedInfoElem.innerHTML = `✅ Tutte le <strong>${totalCount}</strong> connessioni filtrate hanno un parametro valido.`;
        }
    }

    // Se non ci sono dati validi da mostrare
    if (validTotalCount === 0) {
        if (analyticsPieChart) {
            analyticsPieChart.destroy();
            analyticsPieChart = null;
        }
        return;
    }

    // Soglia percentuale per "Altro" (2%) calcolata SOLO sulle connessioni valide
    const THRESHOLD_PERCENT = 2.0;
    const counts = {};
    let altroCount = 0;

    Object.entries(rawCounts).forEach(([label, count]) => {
        const percentage = (count / validTotalCount) * 100;
        if (percentage < THRESHOLD_PERCENT) {
            altroCount += count;
        } else {
            counts[label] = count;
        }
    });

    if (altroCount > 0) {
        counts['Altro'] = altroCount;
    }

    const labels = Object.keys(counts);
    const values = Object.values(counts);

    const bgColors = labels.map((label, i) => {
        if (label === 'Altro') return '#64748b';
        return CHART_COLORS[i % (CHART_COLORS.length - 1)];
    });

    // Aggiornamento grafico esistente
    if (analyticsPieChart) {
        analyticsPieChart.data.labels = labels;
        analyticsPieChart.data.datasets[0].data = values;
        analyticsPieChart.data.datasets[0].backgroundColor = bgColors;

        analyticsPieChart.options.plugins.tooltip.callbacks.label = function (context) {
            const count = context.raw;
            const percentage = ((count / validTotalCount) * 100).toFixed(1);
            return ` ${context.label}: ${count} con. (${percentage}%)`;
        };

        analyticsPieChart.update('none');
        return;
    }

    // Creazione iniziale del grafico
    const ctx = canvas.getContext('2d');
    analyticsPieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: bgColors,
                borderWidth: 1,
                borderColor: '#1e293b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const count = context.raw;
                            const percentage = ((count / validTotalCount) * 100).toFixed(1);
                            return ` ${context.label}: ${count} con. (${percentage}%)`;
                        }
                    }
                },
                legend: {
                    position: 'right',
                    labels: { color: '#f8fafc', font: { size: 12 } }
                }
            }
        }
    });
}

// Event Listener sul cambio parametro
document.addEventListener('DOMContentLoaded', () => {
    const paramSelect = document.getElementById('paramSelect');
    if (paramSelect) {
        paramSelect.addEventListener('change', () => {
            if (window.filteredConnections) {
                renderAnalyticsChart(window.filteredConnections);
            }
        });
    }
});