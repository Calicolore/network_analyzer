/**
 * ====================================================================================
 * MODULO IMPORT — IMPORTAZIONE JSON E CAMBIO MODALITÀ LIVE/IMPORTATA (dbview/analyticsImport.js)
 * ====================================================================================
 * Aggiunge a `window.analyticsExport` (creato in analyticsExportCore.js) i metodi di
 * import file e di switch tra modalità Real Time e DB Importato. Qui si concentrano le
 * chiamate verso i moduli Dashboard (MapManager, UIManager, MapImportManager,
 * bandwidthChartManager) che mettono in pausa/ripristinano il traffico live e
 * ricostruiscono la vista con i dati importati.
 * ====================================================================================
 */

window.analyticsExport.initHeaderControls = function () {
    const selectDb = document.getElementById('select-imported-db');
    const fileInput = document.getElementById('input-header-import-file');
    const resetBtn = document.getElementById('btn-reset-import');

    if (selectDb) {
        selectDb.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === '__NEW__') {
                fileInput.click();
            } else if (val && this.savedDatasets[val]) {
                this.switchImportedDb(val);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.importFile(file);
                fileInput.value = '';
            }
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            this.resetToLiveMode();
        });
    }

    const btnJson = document.getElementById('btn-export-json');
    if (btnJson) {
        btnJson.onclick = () => this.triggerExport();
    }
};

window.analyticsExport.importFile = function (file) {
    if (!file) return;

    const reader = new FileReader();
    const extension = file.name.split('.').pop().toLowerCase();

    if (extension !== 'json') {
        return alert('Formato non supportato! Seleziona un file .json (il supporto CSV è stato rimosso).');
    }

    reader.onload = (e) => {
        try {
            const content = e.target.result;
            const parsedData = JSON.parse(content);

            if (!Array.isArray(parsedData) || parsedData.length === 0) {
                return alert('Il file importato non contiene dati validi o è vuoto.');
            }

            const fileName = file.name;
            this.savedDatasets[fileName] = parsedData;

            this.updateDropdownMenu(fileName);
            this.switchImportedDb(fileName);

        } catch (err) {
            alert('Errore durante il parsing del file: ' + err.message);
        }
    };

    reader.readAsText(file);
};

window.analyticsExport.updateDropdownMenu = function (selectedFileName) {
    const selectDb = document.getElementById('select-imported-db');
    if (!selectDb) return;

    selectDb.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = '📂 DB Importati';
    selectDb.appendChild(placeholder);

    Object.keys(this.savedDatasets).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `📄 ${name}`;
        if (name === selectedFileName) opt.selected = true;
        selectDb.appendChild(opt);
    });

    const newOpt = document.createElement('option');
    newOpt.value = '__NEW__';
    newOpt.textContent = '➕ Importa nuovo DB (JSON)...';
    selectDb.appendChild(newOpt);
};

window.analyticsExport.switchImportedDb = function (fileName) {
    const data = this.savedDatasets[fileName];
    if (!data) return;

    this.isImportedMode = true;
    this.currentImportedKey = fileName;

    if (window.analyticsState) {
        window.analyticsState.isRealtimePaused = true;
    }

    // Nascondi il selettore dell'ambito dati in modalità importata
    const viewScopeGroup = document.getElementById('group-view-scope');
    if (viewScopeGroup) viewScopeGroup.style.display = 'none';

    const statusBadge = document.getElementById('mode-status-badge');
    const resetImportBtn = document.getElementById('btn-reset-import');

    if (statusBadge) {
        statusBadge.textContent = `📁 IMPORTATO: ${fileName}`;
        statusBadge.style.background = '#f59e0b';
    }
    if (resetImportBtn) resetImportBtn.style.display = 'inline-block';

    if (window.analyticsState) {
        window.analyticsState.globalChartSessions = JSON.parse(JSON.stringify(data));
        window.analyticsState.currentPage = 1;

        if (window.analyticsUI) {
            window.analyticsUI.resetAndPopulateDropdowns(window.analyticsState.globalChartSessions);
            window.analyticsUI.applyFiltersAndRender(true);
        }
    }

    // --- PAUSA GENERALE DEL TRAFFICO LIVE (mappa + card) ---
    // Il traffico live non viene distrutto, solo nascosto: lo sniffing lato server continua
    // a scrivere sul DB, ma il client smette di elaborarlo (vedi guardia in dashboard.js).
    if (window.MapManager && typeof window.MapManager.pauseLiveTraffic === 'function') {
        window.MapManager.pauseLiveTraffic();
    }
    if (window.UIManager && typeof window.UIManager.pauseLiveCards === 'function') {
        window.UIManager.pauseLiveCards();
    }

    // Ricostruisce sulla mappa (linee tratteggiate) e nelle card la vista SOLO del DB importato
    if (window.MapImportManager && typeof window.MapImportManager.renderDataset === 'function') {
        window.MapImportManager.renderDataset(window.analyticsState.globalChartSessions);
    }
    if (window.UIManager && typeof window.UIManager.renderImportedCards === 'function') {
        window.UIManager.renderImportedCards(window.analyticsState.globalChartSessions);
    }

    // Carica i totali del DB importato nel grafico "Per Connessione"; il grafico "Temporale"
    // e le statistiche Download/Upload restano a zero (bandwidthChart.js si mette in pausa da sé)
    if (window.bandwidthChartManager && typeof window.bandwidthChartManager.loadImportedData === 'function') {
        window.bandwidthChartManager.loadImportedData(window.analyticsState.globalChartSessions);
    }
};

window.analyticsExport.resetToLiveMode = function () {
    this.isImportedMode = false;
    this.currentImportedKey = null;

    if (window.analyticsState) {
        window.analyticsState.isRealtimePaused = false;
        // ripristina la vista completa del DB al ritorno in live
        window.analyticsState.viewScope = 'full';
    }

    const statusBadge = document.getElementById('mode-status-badge');
    const resetImportBtn = document.getElementById('btn-reset-import');
    const selectDb = document.getElementById('select-imported-db');

    if (statusBadge) {
        statusBadge.textContent = '🔴 REAL TIME';
        statusBadge.style.background = '#10b981';
    }
    if (resetImportBtn) resetImportBtn.style.display = 'none';
    if (selectDb) selectDb.selectedIndex = 0;

    // Ripristina la visibilità del selettore in modalità Real Time e sincronizza il valore scelto
    const viewScopeGroup = document.getElementById('group-view-scope');
    const selectViewScope = document.getElementById('select-view-scope');

    if (viewScopeGroup) viewScopeGroup.style.display = 'flex';
    if (selectViewScope && window.analyticsState) {
        selectViewScope.value = window.analyticsState.viewScope || 'full';
    }

    // Rimuove dalla mappa le rotte del dataset importato, per non mescolarle col traffico live
    if (window.MapImportManager && typeof window.MapImportManager.clear === 'function') {
        window.MapImportManager.clear();
    }

    // Rimuove le card ricostruite dal DB importato
    if (window.UIManager && typeof window.UIManager.clearImportedCards === 'function') {
        window.UIManager.clearImportedCards();
    }

    // Rimuove i dati del DB importato dal grafico "Per Connessione": il traffico live
    // (mai azzerato durante la pausa) torna visibile dal punto in cui si era fermato
    if (window.bandwidthChartManager && typeof window.bandwidthChartManager.clearImportedData === 'function') {
        window.bandwidthChartManager.clearImportedData();
    }

    // --- RIPRESA DEL TRAFFICO LIVE DAL PUNTO IN CUI ERA STATO MESSO IN PAUSA ---
    // Mappa e card live non erano mai state distrutte, solo nascoste: riappaiono qui
    // istantaneamente e identiche a come si trovavano al momento dell'importazione.
    // Da questo momento dashboard.js torna anche a elaborare i nuovi eventi socket in arrivo.
    if (window.MapManager && typeof window.MapManager.resumeLiveTraffic === 'function') {
        window.MapManager.resumeLiveTraffic();
    }
    if (window.UIManager && typeof window.UIManager.resumeLiveCards === 'function') {
        window.UIManager.resumeLiveCards();
    }

    if (window.analyticsApi && typeof window.analyticsApi.loadSessionsData === 'function') {
        window.analyticsApi.loadSessionsData();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.analyticsExport.initHeaderControls();
});
