document.addEventListener('DOMContentLoaded', () => {
    // === 1. INIZIALIZZAZIONE SOCKET.IO PER ANALYTICS LIVE ===
    const socket = typeof window.socket !== 'undefined' ? window.socket : io();

    // === 2. GESTIONE NAVIGATION TABS (MODALITÀ SPA) ===
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

            // Sincronizza i dati completi dal DB al click
            loadSessionsData();
        });
    }

    // === 3. STATO LOCALE ANALYTICS & ORDINAMENTO ===
    let allSessions = [];
    let currentSortColumn = 'last_seen';
    let currentSortOrder = 'desc';

    const activeFilters = {
        country: '',
        service: '',
        provider: '',
        status: ''
    };

    const selectCountry = document.getElementById('select-country');
    const selectService = document.getElementById('select-service');
    const selectProvider = document.getElementById('select-provider');
    const selectStatus = document.getElementById('select-status');
    
    const activeFiltersBox = document.getElementById('active-filters-box');
    const noFiltersText = document.getElementById('no-filters-text');
    const tableBody = document.getElementById('connections-table-body');

    // === 4. ORDINAMENTO COLONNE TABELLA ===
    function initSortingHeaders() {
        const headers = document.querySelectorAll('#view-analytics th.sortable');
        headers.forEach(header => {
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => {
                const column = header.getAttribute('data-sort');
                
                if (currentSortColumn === column) {
                    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortOrder = (column === 'total_bytes' || column === 'last_seen') ? 'desc' : 'asc';
                }
                
                updateSortIcons();
                applyFiltersAndRender();
            });
        });
    }

    function updateSortIcons() {
        document.querySelectorAll('#view-analytics th.sortable').forEach(header => {
            const column = header.getAttribute('data-sort');
            const icon = header.querySelector('.sort-icon');
            if (!icon) return;

            if (column === currentSortColumn) {
                icon.textContent = currentSortOrder === 'asc' ? ' ▲' : ' ▼';
                header.style.color = '#38bdf8';
            } else {
                icon.textContent = ' ⇅';
                header.style.color = '';
            }
        });
    }

    // === 5. CARICAMENTO DATI INIZIALI DAL DB ===
    async function loadSessionsData() {
        try {
            const response = await fetch('/api/sessions');
            if (!response.ok) throw new Error('Errore nel recupero dati');
            
            allSessions = await response.json();
            
            populateDropdowns(allSessions);
            updateSortIcons();
            applyFiltersAndRender();
        } catch (error) {
            console.error('Errore:', error);
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#f87171;">Impossibile caricare i dati dal database.</td></tr>`;
            }
        }
    }

    function populateDropdowns(data) {
        const getUniqueValues = (key) => {
            return [...new Set(data.map(item => item[key]).filter(val => val !== null && val !== undefined && val !== ''))].sort();
        };

        fillSelect(selectCountry, getUniqueValues('country'));
        fillSelect(selectService, getUniqueValues('service'));
        fillSelect(selectProvider, getUniqueValues('provider'));
        fillSelect(selectStatus, getUniqueValues('status'));
    }

    function fillSelect(selectElement, options) {
        if (!selectElement) return;
        const currentVal = selectElement.value;
        const firstOption = selectElement.options[0];
        
        selectElement.innerHTML = '';
        selectElement.appendChild(firstOption);

        options.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            selectElement.appendChild(optionEl);
        });

        selectElement.value = currentVal;
    }

    // === 6. AGGIORNAMENTO REATTIVO TRAMITE WEBSOCKET (LIVE + FIN/RST) ===
    let renderScheduled = false;

    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        
        setTimeout(() => {
            renderScheduled = false;
            // Esegue il re-render solo se la scheda Analytics è visible per ottimizzare le prestazioni
            if (viewAnalytics && !viewAnalytics.classList.contains('hidden')) {
                applyFiltersAndRender();
            }
        }, 1000); // Throttle di 1 secondo
    }

    // Aggiornamento pacchetti in tempo reale
    socket.on('new_packet', (packetData) => {
        const existing = allSessions.find(s => s.session_id === packetData.sessionId);
        const calculatedBytes = Math.round(parseFloat(packetData.totalKB || 0) * 1024) || packetData.size || 0;

        if (existing) {
            existing.total_bytes = Math.max(existing.total_bytes || 0, calculatedBytes);
            existing.last_seen = packetData.time;
            if (packetData.hostName) existing.host_name = packetData.hostName;
            if (packetData.provider) existing.provider = packetData.provider;
            if (packetData.service) existing.service = packetData.service;
            existing.status = 'active';
        } else {
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
            allSessions.unshift(newSession);
            populateDropdowns(allSessions);
        }

        scheduleRender();
    });

    // Aggiornamento su FIN / RST / Idle Timeout
    socket.on('session_closed', (data) => {
        const existing = allSessions.find(s => s.session_id === data.sessionId);
        if (existing) {
            existing.status = data.reason === 'Idle Timeout' ? 'idle' : 'closed';
            scheduleRender();
        }
    });

    // === 7. EVENT LISTENERS FILTRI ===
    if (selectCountry) selectCountry.addEventListener('change', (e) => setFilter('country', e.target.value));
    if (selectService) selectService.addEventListener('change', (e) => setFilter('service', e.target.value));
    if (selectProvider) selectProvider.addEventListener('change', (e) => setFilter('provider', e.target.value));
    if (selectStatus) selectStatus.addEventListener('change', (e) => setFilter('status', e.target.value));

    function setFilter(key, value) {
        activeFilters[key] = value;
        applyFiltersAndRender();
    }

    function removeFilter(key) {
        activeFilters[key] = '';
        if (key === 'country' && selectCountry) selectCountry.value = '';
        if (key === 'service' && selectService) selectService.value = '';
        if (key === 'provider' && selectProvider) selectProvider.value = '';
        if (key === 'status' && selectStatus) selectStatus.value = '';
        applyFiltersAndRender();
    }

    // === 8. FILTRAGGIO, ORDINAMENTO E RENDERING TABELLA ===
    function applyFiltersAndRender() {
        renderFilterChips();

        let result = allSessions.filter(session => {
            if (activeFilters.country && session.country !== activeFilters.country) return false;
            if (activeFilters.service && session.service !== activeFilters.service) return false;
            if (activeFilters.provider && session.provider !== activeFilters.provider) return false;
            if (activeFilters.status && session.status !== activeFilters.status) return false;
            return true;
        });

        result.sort((a, b) => {
            let valA = a[currentSortColumn] ?? '';
            let valB = b[currentSortColumn] ?? '';

            if (currentSortColumn === 'total_bytes') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            } else {
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
            }

            if (valA < valB) return currentSortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        renderTable(result);
    }

    function renderFilterChips() {
        if (!activeFiltersBox) return;
        const existingChips = activeFiltersBox.querySelectorAll('.filter-chip');
        existingChips.forEach(chip => chip.remove());

        const keysWithValues = Object.keys(activeFilters).filter(k => activeFilters[k] !== '');

        if (keysWithValues.length === 0) {
            if (noFiltersText) noFiltersText.style.display = 'inline';
        } else {
            if (noFiltersText) noFiltersText.style.display = 'none';

            keysWithValues.forEach(key => {
                const chip = document.createElement('div');
                chip.className = 'filter-chip';
                chip.innerHTML = `
                    <span><strong>${getCategoryLabel(key)}:</strong> ${activeFilters[key]}</span>
                    <button title="Rimuovi filtro">&times;</button>
                `;
                chip.querySelector('button').addEventListener('click', () => removeFilter(key));
                activeFiltersBox.appendChild(chip);
            });
        }
    }

    function getCategoryLabel(key) {
        const labels = { country: 'Nazione', service: 'Servizio', provider: 'Provider', status: 'Stato' };
        return labels[key] || key;
    }

    function renderTable(data) {
        if (!tableBody) return;
        if (data.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94a3b8;">Nessuna connessione corrisponde ai filtri selezionati.</td></tr>`;
            return;
        }

        tableBody.innerHTML = data.map(item => `
            <tr>
                <td><strong>${item.remote_ip || 'N/A'}</strong></td>
                <td>${item.host_name || 'N/A'}</td>
                <td>${item.country || 'Sconosciuta'}</td>
                <td>${item.service || 'N/A'}</td>
                <td>${item.provider || 'N/A'}</td>
                <td>${formatBytes(item.total_bytes || 0)}</td>
                <td>
                    <span class="badge-status ${item.status === 'active' ? 'status-active' : (item.status === 'closed' ? 'status-closed' : 'status-idle')}">
                        ${item.status || 'idle'}
                    </span>
                </td>
                <td>${item.last_seen || 'N/A'}</td>
            </tr>
        `).join('');
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    initSortingHeaders();
    loadSessionsData();
});