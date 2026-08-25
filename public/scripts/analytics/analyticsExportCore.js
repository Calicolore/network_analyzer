/**
 * ====================================================================================
 * MODULO EXPORT — ESPORTAZIONE DATI JSON (analytics/analyticsExportCore.js)
 * ====================================================================================
 * Crea lo stato condiviso `window.analyticsExport` (isImportedMode, currentImportedKey,
 * savedDatasets) e la parte di export/download. Il file gemello analyticsImport.js
 * aggiunge a QUESTO STESSO oggetto le proprietà di import/cambio-modalità: i metodi
 * sono assegnati come proprietà singole (non un secondo oggetto letterale) apposta,
 * così `window.analyticsExport` resta un unico oggetto condiviso e `this` dentro ogni
 * metodo continua a riferirsi correttamente ad esso quando invocato come
 * `window.analyticsExport.metodo()`.
 *
 * NOTA: Il supporto CSV è stato rimosso. Il formato JSON è l'unico che preserva la
 * fedeltà completa dei dati (in particolare lat/lon e l'array "hops" del traceroute,
 * indispensabili per ricostruire il percorso sulla mappa quando si importa un DB).
 * ====================================================================================
 */

window.analyticsExport = {
    isImportedMode: false,
    currentImportedKey: null,
    savedDatasets: {}
};

window.analyticsExport.triggerExport = function () {
    const scopeSelect = document.getElementById('export-scope-select');
    const scope = scopeSelect ? scopeSelect.value : 'current';

    if (scope === 'full' && !this.isImportedMode) {
        this.exportFullDatabase();
    } else {
        this.exportCurrentSession();
    }
};

window.analyticsExport.exportCurrentSession = function () {
    const data = window.filteredConnections || window.analyticsState?.globalChartSessions || [];

    if (data.length === 0) {
        return alert('Nessun dato presente nella sessione corrente da esportare.');
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `network_session_current_${timestamp}.json`;
    this.downloadFile(JSON.stringify(data, null, 2), fileName, 'application/json');
};

window.analyticsExport.exportFullDatabase = async function () {
    try {
        const response = await fetch('/api/sessions?exportAll=true');
        if (!response.ok) throw new Error('Errore nel recupero dati dal server');

        const result = await response.json();
        const data = result.data || [];

        if (data.length === 0) {
            return alert('Il database è attualmente vuoto.');
        }

        const timestamp = new Date().toISOString().slice(0, 10);
        const fileName = `network_db_full_${timestamp}.json`;
        this.downloadFile(JSON.stringify(data, null, 2), fileName, 'application/json');
    } catch (error) {
        console.error('[EXPORT] Errore durante l\'esportazione del DB:', error);
        alert('Si è verificato un errore durante l\'esportazione dell\'intero database.');
    }
};

window.analyticsExport.downloadFile = function (content, fileName, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
