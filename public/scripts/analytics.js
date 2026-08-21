/**
 * Controller Principale Analytics - SPA Navigation, Socket.IO & Event Listener (analytics.js)
 */

document.addEventListener('DOMContentLoaded', () => {
    const state = window.analyticsState;
    const api = window.analyticsApi;
    const ui = window.analyticsUI;
    const exp = window.analyticsExport;

    // === 1. INIZIALIZZAZIONE SOCKET.IO ===
    const socket = typeof window.socket !== 'undefined' ? window.socket : io();

    // === 2. GESTIONE NAVIGATION TABS (SPA) ===
    const btnLive = document.getElementById('nav-btn-live');
    const btnAnalytics = document.getElementById('nav-btn-analytics');
    const viewLive = document.getElementById('view-live');
    const viewAnalytics = document.getElementById('view-analytics');

    if (btnLive && btnAnalytics) {
        btnLive.addEventListener('click', () => {
            viewLive.classList.remove('hidden');
            viewAnalytics.classList.add('hidden');
            btnLive.classList.add('active');
            btnAnalytics.classList.remove('active');

            if (window.map && typeof window.map.invalidateSize === 'function') {
                setTimeout(() => window.map.invalidateSize(), 100);
            }
        });

        btnAnalytics.addEventListener('click', () => {
            viewAnalytics.classList.remove('hidden');
            viewLive.classList.add('hidden');
            btnAnalytics.classList.add('active');
            btnLive.classList.remove('active');

            // Ricarica il DB reale solo se NON siamo in modalità importata
            if (!exp.isImportedMode) {
                api.loadSessionsData();
            }
        });
    }

    const limitSelectEl = document.getElementById('select-page-limit');
    if (limitSelectEl) {
        state.currentLimit = parseInt(limitSelectEl.value, 10) || 25;
    }

    // === 3. WEBSOCKET REAL-TIME ===
    let renderTimer = null;
    const RENDER_DEBOUNCE_MS = 300;

    function scheduleRender() {
        if (renderTimer) return;
        renderTimer = setTimeout(() => {
            renderTimer = null;
            if (viewAnalytics && !viewAnalytics.classList.contains('hidden')) {
                ui.applyFiltersAndRender(false);
            }
        }, RENDER_DEBOUNCE_MS);
    }

    socket.on('new_packet', (packetData) => {
        // Se siamo in modalità DB Importato, blocca l'inserimento dei pacchetti real-time
        if (exp && exp.isImportedMode) return;

        const calculatedBytes = Math.round(parseFloat(packetData.totalKB || 0) * 1024) || packetData.size || 0;

        // 1. Aggiorna dataset globale per grafico e filtri
        const existingGlobal = state.globalChartSessions.find(s => s.session_id === packetData.sessionId);
        if (existingGlobal) {
            existingGlobal.total_bytes = Math.max(existingGlobal.total_bytes || 0, calculatedBytes);
            existingGlobal.last_seen = packetData.time;
            if (packetData.hostName) existingGlobal.host_name = packetData.hostName;
            if (packetData.provider) existingGlobal.provider = packetData.provider;
            if (packetData.service) existingGlobal.service = packetData.service;
            existingGlobal.status = 'active';
            existingGlobal.is_current_session = true;
        } else {
            const newGlobalSession = {
                session_id: packetData.sessionId,
                remote_ip: packetData.remoteIp,
                remote_port: packetData.remotePort,
                host_name: packetData.hostName || 'N/A',
                resource_name: packetData.resourceName || '',
                technical_subtitle: packetData.technicalSubtitle || '',
                provider: packetData.provider || 'N/A',
                country: packetData.country || 'N/A',
                service: packetData.service || 'N/A',
                total_bytes: calculatedBytes,
                first_seen: packetData.time,
                last_seen: packetData.time,
                status: 'active',
                is_current_session: true
            };
            state.globalChartSessions.unshift(newGlobalSession);
        }

        ui.updateDropdownsWithNewItem(packetData);
        scheduleRender();
    });

    // Listener per il cambio dell'ambito dati
    document.getElementById('select-view-scope')?.addEventListener('change', (e) => {
        state.viewScope = e.target.value;
        state.currentPage = 1;
        ui.applyFiltersAndRender(true);
    });

    socket.on('session_closed', (data) => {
        if (exp && exp.isImportedMode) return;

        const existingGlobal = state.globalChartSessions.find(s => s.session_id === data.sessionId);
        if (existingGlobal) {
            existingGlobal.status = data.reason === 'Idle Timeout' ? 'idle' : 'closed';
        }
        scheduleRender();
    });

    // === 4. EVENT LISTENERS PER FILTRI & PAGINAZIONE ===
    ['country', 'service', 'provider', 'status'].forEach(key => {
        document.getElementById(`select-${key}`)?.addEventListener('change', (e) => {
            state.activeFilters[key] = e.target.value;
            state.currentPage = 1;
            ui.applyFiltersAndRender(true);
        });
    });

    document.getElementById('paramSelect')?.addEventListener('change', () => {
        ui.applyFiltersAndRender(true);
    });

    const selectTimePreset = document.getElementById('select-time-preset');
    if (selectTimePreset) {
        selectTimePreset.addEventListener('change', (e) => {
            state.currentTimePreset = e.target.value;
            const customGroup = document.getElementById('custom-date-group');
            if (customGroup) {
                customGroup.style.display = state.currentTimePreset === 'custom' ? 'flex' : 'none';
            }
            if (state.currentTimePreset !== 'custom' && !exp.isImportedMode) {
                state.currentPage = 1;
                api.loadSessionsData();
            }
        });
    }

    document.getElementById('btn-apply-date-range')?.addEventListener('click', () => {
        state.customStart = document.getElementById('input-date-start')?.value || '';
        state.customEnd = document.getElementById('input-date-end')?.value || '';
        if (state.customStart && state.customEnd && !exp.isImportedMode) {
            state.currentPage = 1;
            api.loadSessionsData();
        }
    });

    document.getElementById('select-page-limit')?.addEventListener('change', (e) => {
        state.currentLimit = parseInt(e.target.value, 10) || 25;
        state.currentPage = 1;
        ui.applyFiltersAndRender(false);
    });

    document.getElementById('btn-page-prev')?.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            ui.applyFiltersAndRender(false);
        }
    });

    document.getElementById('btn-page-next')?.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
            state.currentPage++;
            ui.applyFiltersAndRender(false);
        }
    });

    // === 5. INIZIALIZZAZIONE ===
    ui.initSortingHeaders();
    api.loadSessionsData();
});