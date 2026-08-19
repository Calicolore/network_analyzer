/**
 * Modulo Export - Esportazione Dati CSV e JSON (analyticsExport.js)
 */

window.analyticsExport = {
    /**
     * Esporta tutti i dati correnti filtrati in CSV
     */
    async exportToCsv() {
        try {
            const exportData = await window.analyticsApi.fetchAllFilteredForExport();
            if (!exportData.length) return alert('Nessun dato da esportare con i filtri attuali!');

            const headers = ['IP Remoto', 'Host Name', 'Nazione', 'Servizio', 'Provider', 'Bytes Totali', 'Stato', 'Ultima Attivita'];
            const keys = ['remote_ip', 'host_name', 'country', 'service', 'provider', 'total_bytes', 'status', 'last_seen'];

            const csvRows = [
                headers.join(','),
                ...exportData.map(row => keys.map(k => `"${(row[k] || '').toString().replace(/"/g, '""')}"`).join(','))
            ];

            this.downloadBlob(csvRows.join('\n'), 'network_sessions_export.csv', 'text/csv;charset=utf-8;');
        } catch (err) {
            alert('Errore durante l\'esportazione CSV: ' + err.message);
        }
    },

    /**
     * Esporta tutti i dati correnti filtrati in JSON
     */
    async exportToJson() {
        try {
            const exportData = await window.analyticsApi.fetchAllFilteredForExport();
            if (!exportData.length) return alert('Nessun dato da esportare con i filtri attuali!');

            const jsonStr = JSON.stringify(exportData, null, 2);
            this.downloadBlob(jsonStr, 'network_sessions_export.json', 'application/json');
        } catch (err) {
            alert('Errore durante l\'esportazione JSON: ' + err.message);
        }
    },

    downloadBlob(content, fileName, contentType) {
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