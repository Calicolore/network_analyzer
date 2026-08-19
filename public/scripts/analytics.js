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

            api.loadSessionsData();
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
                status: 'active'
            };
            state.globalChartSessions.unshift(newGlobalSession);
        }

        // 2. Aggiungi il valore ai dropdown se nuovo
        ui.updateDropdownsWithNewItem(packetData);

        scheduleRender();
    });

    socket.on('session_closed', (data) => {
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

    // Event listener per il cambio parametro grafico (es. Nazione -> Servizio)
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
            if (state.currentTimePreset !== 'custom') {
                state.currentPage = 1;
                api.loadSessionsData();
            }
        });
    }

    document.getElementById('btn-apply-date-range')?.addEventListener('click', () => {
        state.customStart = document.getElementById('input-date-start')?.value || '';
        state.customEnd = document.getElementById('input-date-end')?.value || '';
        if (state.customStart && state.customEnd) {
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

    // === 5. ESPORTAZIONE ===
    document.getElementById('btn-export-csv')?.addEventListener('click', () => exp.exportToCsv());
    document.getElementById('btn-export-json')?.addEventListener('click', () => exp.exportToJson());

    // === 6. INIZIALIZZAZIONE ===
    ui.initSortingHeaders();
    api.loadSessionsData();
});