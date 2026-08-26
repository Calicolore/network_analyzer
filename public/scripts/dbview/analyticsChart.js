/**
 * ====================================================================================
 * GRAFICO A TORTA DINAMICO (dbview/analyticsChart.js)
 * ====================================================================================
 * Disegna/aggiorna il grafico a torta per il parametro selezionato (nazione, servizio,
 * provider, stato), raggruppando in "Altro" le fette sotto la soglia del 2% ed
 * escludendo dal conteggio i valori non definiti (tramite `isUndefinedValue`, usata
 * anche da dbview/analyticsUI.js per il KPI "Nazioni").
 *
 * Il rendering è invocato da analyticsUI.applyFiltersAndRender() — questo modulo NON
 * scrive più i KPI tile (quella responsabilità è unica in analyticsUI.updateGlobalKpiUI,
 * per evitare la doppia scrittura che nascondeva la percentuale reale) e non registra
 * più un proprio listener sul cambio parametro (quello in analytics.js è l'unico,
 * coerente con gli altri filtri).
 * ====================================================================================
 */

let analyticsPieChart = null;

const CHART_COLORS = [
    '#38bdf8', '#3b82f6', '#818cf8', '#a855f7',
    '#ec4899', '#f43f5e', '#10b981', '#f59e0b',
    '#06b6d4', '#6366f1', '#d946ef', '#84cc16', '#64748b'
];

/**
 * Verificatore dei valori non definiti o non validi.
 *
 * @param {*} val - Valore da verificare
 * @param {string} param - Nome del parametro/colonna (es. "country"), per applicare
 *   controlli aggiuntivi specifici (es. "??"/"?" solo per le nazioni)
 * @returns {boolean} true se il valore va considerato non definito
 */
function isUndefinedValue(val, param) {
    if (!val) return true;
    const str = String(val).trim().toLowerCase();
    if (str === '' || str === 'unknown' || str === 'n/a' || str === 'non definito' || str === 'sconosciuta' || str === '-') return true;
    if (param === 'country' && (str === '??' || str === '?')) return true;
    return false;
}

/**
 * Disegna o aggiorna in-place il grafico a torta per il parametro correntemente
 * selezionato in `#paramSelect`.
 *
 * @param {object[]} [data] - Dataset filtrato (righe sessione) da rappresentare
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

    /**
     * "length - 1" esclude deliberatamente l'ultimo colore della tavolozza (#64748b) dal
     * ciclo delle fette normali: è lo stesso grigio hardcoded assegnato esplicitamente
     * quando `label === 'Altro'`, riservato solo a quella fetta così non viene mai
     * assegnato per coincidenza a una categoria reale.
     */
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
