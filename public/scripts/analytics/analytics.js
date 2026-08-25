/**
 * ====================================================================================
 * CONTROLLER PRINCIPALE ANALYTICS — SPA NAVIGATION, SOCKET.IO & FILTRI (analytics/analytics.js)
 * ====================================================================================
 * Composition root della vista Analytics: cablaggio della navigazione a tab, dei
 * listener Socket.IO che alimentano analyticsState.globalChartSessions in tempo
 * reale, e di tutti i listener di filtri/paginazione/ordinamento. Ultimo file del
 * gruppo "analytics" caricato: può contare su window.analyticsState/analyticsApi/
 * analyticsUI/analyticsExport già definiti.
 * ====================================================================================
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
            // lat/lon: mantiene il valore già noto se il pacchetto corrente non lo fornisce
            if (packetData.lat !== undefined && packetData.lat !== null) existingGlobal.lat = packetData.lat;
            if (packetData.lon !== undefined && packetData.lon !== null) existingGlobal.lon = packetData.lon;
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
                lat: packetData.lat ?? null,
                lon: packetData.lon ?? null,
                hops: [], // Popolato in seguito dal listener 'traceroute_hop'
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

    // Aggancia gli hop di traceroute scoperti in tempo reale alle sessioni corrispondenti,
    // così l'export JSON "Sessione Corrente" porta con sé l'intero percorso, non solo la destinazione.
    socket.on('traceroute_hop', (hopData) => {
        if (exp && exp.isImportedMode) return;
        if (!hopData || !hopData.targetIp) return;

        state.globalChartSessions
            .filter(s => s.remote_ip === hopData.targetIp)
            .forEach(session => {
                if (!Array.isArray(session.hops)) session.hops = [];
                const alreadyPresent = session.hops.some(h => h.hop_number === hopData.hopNumber);
                if (!alreadyPresent) {
                    session.hops.push({
                        hop_number: hopData.hopNumber,
                        ip: hopData.ip,
                        lat: hopData.lat,
                        lon: hopData.lon,
                        country: hopData.country,
                        city: hopData.city,
                        provider: hopData.provider
                    });
                }
            });
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

    // Unico listener sul cambio parametro del grafico a torta (analyticsChart.js non
    // ne registra più uno proprio, per evitare il doppio render — vedi analyticsChart.js)
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
