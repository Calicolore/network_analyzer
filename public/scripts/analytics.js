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

            // Carica i dati paginati dal DB al passaggio di vista
            api.loadSessionsData();
        });
    }

    // Synchronizza limite iniziale dal DOM per la paginazione istantanea
    const limitSelectEl = document.getElementById('select-page-limit');
    if (limitSelectEl) {
        state.currentLimit = parseInt(limitSelectEl.value, 10) || 25;
    }

    // === 3. WEBSOCKET REAL-TIME CON THROTTLING ===
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
        const existing = state.allSessions.find(s => s.session_id === packetData.sessionId);
        const calculatedBytes = Math.round(parseFloat(packetData.totalKB || 0) * 1024) || packetData.size || 0;

        if (existing) {
            existing.total_bytes = Math.max(existing.total_bytes || 0, calculatedBytes);
            existing.last_seen = packetData.time;
            if (packetData.hostName) existing.host_name = packetData.hostName;
            if (packetData.provider) existing.provider = packetData.provider;
            if (packetData.service) existing.service = packetData.service;
            existing.status = 'active';
        } else {
            state.globalDbStats.totalConnections++;
            state.globalDbStats.totalBytes += calculatedBytes;

            if (state.currentPage === 1) { // Inserisce in cima solo se si naviga la prima pagina
                const newSession = {
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
                state.allSessions.unshift(newSession);
                if (state.allSessions.length > state.currentLimit) state.allSessions.pop();
                
                state.totalItems++;
                state.totalPages = Math.max(1, Math.ceil(state.totalItems / state.currentLimit));
                ui.updatePaginationUI();

                ui.updateDropdownIncremental('country', document.getElementById('select-country'), [newSession]);
                ui.updateDropdownIncremental('service', document.getElementById('select-service'), [newSession]);
                ui.updateDropdownIncremental('provider', document.getElementById('select-provider'), [newSession]);
                ui.updateDropdownIncremental('status', document.getElementById('select-status'), [newSession]);
            }
        }

        ui.updateGlobalKpiUI();
        scheduleRender();
    });

    socket.on('session_closed', (data) => {
        const existing = state.allSessions.find(s => s.session_id === data.sessionId);
        if (existing) {
            existing.status = data.reason === 'Idle Timeout' ? 'idle' : 'closed';
            scheduleRender();
        }
    });

    // === 4. EVENT LISTENERS PER FILTRI & PAGINAZIONE ===
    ['country', 'service', 'provider', 'status'].forEach(key => {
        document.getElementById(`select-${key}`)?.addEventListener('change', (e) => {
            state.activeFilters[key] = e.target.value;
            ui.applyFiltersAndRender(true);
        });
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
        api.loadSessionsData();
    });

    document.getElementById('btn-page-prev')?.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            api.loadSessionsData();
        }
    });

    document.getElementById('btn-page-next')?.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
            state.currentPage++;
            api.loadSessionsData();
        }
    });

    // === 5. EVENT LISTENERS PER ESPORTAZIONE ===
    document.getElementById('btn-export-csv')?.addEventListener('click', () => exp.exportToCsv());
    document.getElementById('btn-export-json')?.addEventListener('click', () => exp.exportToJson());

    // === 6. INIZIALIZZAZIONE COMPONENTI ===
    ui.initSortingHeaders();
    api.loadSessionsData();
});