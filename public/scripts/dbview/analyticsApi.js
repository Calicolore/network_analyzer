/**
 * ====================================================================================
 * MODULO API — STATO E CHIAMATE DI RETE (dbview/analyticsApi.js)
 * ====================================================================================
 * Definisce `window.analyticsState` (l'unico stato condiviso da tutti i moduli
 * Analytics: dataset globale, filtri attivi, paginazione, ordinamento) e
 * `window.analyticsApi`, che scarica l'intero dataset dal server (`GET /api/sessions`)
 * per alimentare grafico, filtri e tabella, delegando poi il rendering a
 * `window.analyticsUI`.
 * ====================================================================================
 */

window.analyticsState = {
    allSessions: [],            // Sessioni della pagina corrente (per la tabella)
    globalChartSessions: [],    // TUTTE le sessioni dell'intero DB (per grafico e filtri)
    viewScope: 'full',          // 'full' (Tutto il DB) oppure 'current' (Solo Sessione Corrente)
    currentSortColumn: 'last_seen',
    currentSortOrder: 'desc',
    currentLimit: 25,
    currentPage: 1,
    currentTimePreset: 'all',
    customStart: '',
    customEnd: '',
    totalItems: 0,
    totalPages: 1,
    globalDbStats: {
        totalConnections: 0,
        totalBytes: 0,
        totalCountries: 0
    },
    activeFilters: {
        country: '',
        service: '',
        provider: '',
        status: ''
    },
    existingDropdownOptions: {
        country: new Set(),
        service: new Set(),
        provider: new Set(),
        status: new Set()
    }
};

window.analyticsApi = {
    /**
     * Carica l'intero dataset dal server per alimentare grafico, filtri e tabella globale
     */
    async loadSessionsData() {
        const state = window.analyticsState;
        const tableBody = document.getElementById('connections-table-body');

        try {
            // 1. Scarica l'intero dataset dal DB (exportAll=true & limit=99999)
            state.globalChartSessions = await this.fetchAllFilteredForExport();

            // Popola i menu a tendina con i valori DISTINCT dell'intero DB se vuoti
            if (window.analyticsUI) {
                window.analyticsUI.resetAndPopulateDropdowns(state.globalChartSessions);
            }

            // 2. Applica i filtri ed esegui il rendering completo (Grafico + Tabella)
            if (window.analyticsUI) {
                window.analyticsUI.updateSortIcons();
                window.analyticsUI.applyFiltersAndRender(true);
            }
        } catch (error) {
            console.error('[AnalyticsAPI Error]:', error);
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#f87171;">Impossibile caricare i dati dal database.</td></tr>`;
            }
        }
    },

    /**
     * Scarica tutte le sessioni dal DB per filtri, esportazione e grafico a torta.
     *
     * @returns {Promise<object[]>} Tutte le sessioni corrispondenti al preset temporale
     *   corrente (`state.currentTimePreset`/`customStart`/`customEnd`)
     */
    async fetchAllFilteredForExport() {
        const state = window.analyticsState;
        let url = `/api/sessions?exportAll=true&limit=99999&timePreset=${state.currentTimePreset}`;

        if (state.currentTimePreset === 'custom' && state.customStart && state.customEnd) {
            url += `&startDate=${encodeURIComponent(state.customStart)}&endDate=${encodeURIComponent(state.customEnd)}`;
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error('Impossibile scaricare i dati dal server');

        const result = await res.json();
        return Array.isArray(result) ? result : (result.data || []);
    }
};
