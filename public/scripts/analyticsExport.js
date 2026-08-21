/**
 * Modulo Export & Import - Esportazione ed Importazione Dati CSV/JSON (analyticsExport.js)
 */

window.analyticsExport = {
    isImportedMode: false,
    currentImportedKey: null,
    savedDatasets: {},

    /**
     * Inizializza i listener per l'header e i pulsanti di esportazione (Singola associazione)
     */
    initHeaderControls() {
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

        // Listener UNICO per i pulsanti di esportazione
        const btnCsv = document.getElementById('btn-export-csv');
        const btnJson = document.getElementById('btn-export-json');

        if (btnCsv) {
            btnCsv.onclick = () => this.triggerExport('csv');
        }
        if (btnJson) {
            btnJson.onclick = () => this.triggerExport('json');
        }
    },

    triggerExport(format = 'csv') {
        const scopeSelect = document.getElementById('export-scope-select');
        const scope = scopeSelect ? scopeSelect.value : 'current';

        if (scope === 'full' && !this.isImportedMode) {
            this.exportFullDatabase(format);
        } else {
            this.exportCurrentSession(format);
        }
    },

    importFile(file) {
        if (!file) return;

        const reader = new FileReader();
        const extension = file.name.split('.').pop().toLowerCase();

        reader.onload = (e) => {
            try {
                const content = e.target.result;
                let parsedData = [];

                if (extension === 'json') {
                    parsedData = JSON.parse(content);
                } else if (extension === 'csv') {
                    parsedData = this.parseCsv(content);
                } else {
                    return alert('Formato non supportato! Seleziona un file .json o .csv');
                }

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
    },

    updateDropdownMenu(selectedFileName) {
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
        newOpt.textContent = '➕ Importa nuovo DB (JSON/CSV)...';
        selectDb.appendChild(newOpt);
    },

    switchImportedDb(fileName) {
        const data = this.savedDatasets[fileName];
        if (!data) return;

        this.isImportedMode = true;
        this.currentImportedKey = fileName;

        if (window.analyticsState) {
            window.analyticsState.isRealtimePaused = true;
        }

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
    },

    resetToLiveMode() {
        this.isImportedMode = false;
        this.currentImportedKey = null;

        if (window.analyticsState) {
            window.analyticsState.isRealtimePaused = false;
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

        if (window.analyticsApi && typeof window.analyticsApi.loadSessionsData === 'function') {
            window.analyticsApi.loadSessionsData();
        }
    },

    parseCsv(csvText) {
        const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) return [];

        const headerMap = {
            'ip remoto': 'remote_ip',
            'host name': 'host_name',
            'nazione': 'country',
            'servizio': 'service',
            'provider': 'provider',
            'bytes totali': 'total_bytes',
            'stato': 'status',
            'ultima attivita': 'last_seen'
        };

        const rawHeaders = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
        const keys = rawHeaders.map(h => headerMap[h] || h);

        const result = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
            const rowObj = {};

            keys.forEach((key, index) => {
                let val = values[index] ? values[index].trim() : '';
                val = val.replace(/^"|"$/g, '').replace(/""/g, '"');
                if (key === 'total_bytes') val = parseFloat(val) || 0;
                rowObj[key] = val;
            });

            result.push(rowObj);
        }

        return result;
    },

    exportCurrentSession(format = 'csv') {
        const data = window.filteredConnections || window.analyticsState?.globalChartSessions || [];
        
        if (data.length === 0) {
            return alert('Nessun dato presente nella sessione corrente da esportare.');
        }

        const timestamp = new Date().toISOString().slice(0, 10);
        const fileName = `network_session_current_${timestamp}.${format}`;

        if (format === 'json') {
            this.downloadFile(JSON.stringify(data, null, 2), fileName, 'application/json');
        } else {
            const csvContent = this.jsonToCSV(data);
            this.downloadFile(csvContent, fileName, 'text/csv;charset=utf-8;');
        }
    },

    async exportFullDatabase(format = 'csv') {
        try {
            const response = await fetch('/api/sessions?exportAll=true');
            if (!response.ok) throw new Error('Errore nel recupero dati dal server');
            
            const result = await response.json();
            const data = result.data || [];

            if (data.length === 0) {
                return alert('Il database è attualmente vuoto.');
            }

            const timestamp = new Date().toISOString().slice(0, 10);
            const fileName = `network_db_full_${timestamp}.${format}`;

            if (format === 'json') {
                this.downloadFile(JSON.stringify(data, null, 2), fileName, 'application/json');
            } else {
                const csvContent = this.jsonToCSV(data);
                this.downloadFile(csvContent, fileName, 'text/csv;charset=utf-8;');
            }
        } catch (error) {
            console.error('[EXPORT] Errore durante l\'esportazione del DB:', error);
            alert('Si è verificato un errore durante l\'esportazione dell\'intero database.');
        }
    },

    jsonToCSV(items) {
        if (!items || !items.length) return '';
        
        const headers = Object.keys(items[0]);
        const headerRow = headers.join(',');

        const bodyRows = items.map(item => 
            headers.map(header => {
                const val = item[header] ?? '';
                const escaped = String(val).replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(',')
        );

        return [headerRow, ...bodyRows].join('\n');
    },

    downloadFile(content, fileName, contentType) {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.analyticsExport.initHeaderControls();
});