/**
 * Modulo API - Gestione Chiamate di Rete e Stato Dati (analyticsApi.js)
 */

window.analyticsState = {
    allSessions: [],
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
     * Carica i dati dal DB per la pagina e il range temporale corrente
     */
    async loadSessionsData() {
        const state = window.analyticsState;
        const tableBody = document.getElementById('connections-table-body');

        try {
            let url = `/api/sessions?page=${state.currentPage}&limit=${state.currentLimit}&timePreset=${state.currentTimePreset}`;
            if (state.currentTimePreset === 'custom' && state.customStart && state.customEnd) {
                url += `&startDate=${encodeURIComponent(state.customStart)}&endDate=${encodeURIComponent(state.customEnd)}`;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error('Errore nel recupero dati dal server');
            
            const result = await response.json();
            
            // Estrazione array sessioni della pagina corrente
            state.allSessions = Array.isArray(result) ? result : (result.data || []);
            
            // Calcolo paginazione per l'intero DB
            if (result.pagination) {
                state.totalItems = parseInt(result.pagination.total, 10) || 0;
                state.totalPages = parseInt(result.pagination.totalPages, 10) || Math.ceil(state.totalItems / state.currentLimit) || 1;
            } else {
                state.totalItems = state.allSessions.length;
                state.totalPages = Math.ceil(state.totalItems / state.currentLimit) || 1;
            }
            if (state.totalPages < 1) state.totalPages = 1;

            // Estrazione statistiche sull'intero DB per le card KPI
            if (result.stats) {
                state.globalDbStats = {
                    totalConnections: Number(result.stats.totalConnections ?? result.stats.total_connections ?? state.totalItems),
                    totalBytes: Number(result.stats.totalBytes ?? result.stats.total_bytes ?? 0),
                    totalCountries: Number(result.stats.totalCountries ?? result.stats.total_countries ?? 0)
                };
            } else {
                state.globalDbStats = {
                    totalConnections: state.totalItems,
                    totalBytes: state.globalDbStats.totalBytes || state.allSessions.reduce((acc, s) => acc + (s.total_bytes || 0), 0),
                    totalCountries: state.globalDbStats.totalCountries || new Set(state.allSessions.map(s => s.country).filter(Boolean)).size
                };
            }

            // Aggiorna l'interfaccia utente
            if (window.analyticsUI) {
                window.analyticsUI.updateGlobalKpiUI();
                window.analyticsUI.updatePaginationUI();
                window.analyticsUI.resetAndPopulateDropdowns(state.allSessions);
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
     * Scarica tutte le sessioni filtrate senza paginazione per l'export
     */
    async fetchAllFilteredForExport() {
        const state = window.analyticsState;
        let url = `/api/sessions?exportAll=true&timePreset=${state.currentTimePreset}`;
        if (state.currentTimePreset === 'custom' && state.customStart && state.customEnd) {
            url += `&startDate=${encodeURIComponent(state.customStart)}&endDate=${encodeURIComponent(state.customEnd)}`;
        }
        
        const res = await fetch(url);
        if (!res.ok) throw new Error('Impossibile scaricare tutti i dati per l\'esportazione');
        
        const result = await res.json();
        let data = Array.isArray(result) ? result : (result.data || []);
        
        // Filtra lato client per i filtri di categoria attivi
        return data.filter(s => {
            if (state.activeFilters.country && s.country !== state.activeFilters.country) return false;
            if (state.activeFilters.service && s.service !== state.activeFilters.service) return false;
            if (state.activeFilters.provider && s.provider !== state.activeFilters.provider) return false;
            if (state.activeFilters.status && s.status !== state.activeFilters.status) return false;
            return true;
        });
    }
};