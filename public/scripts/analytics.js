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

    // Mappe per tracciare le opzioni già inserite ed evitare duplicati
    const existingDropdownOptions = {
        country: new Set(),
        service: new Set(),
        provider: new Set(),
        status: new Set()
    };

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
                applyFiltersAndRender(true);
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
            
            resetAndPopulateDropdowns(allSessions);
            updateSortIcons();
            applyFiltersAndRender(true);
        } catch (error) {
            console.error('Errore:', error);
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#f87171;">Impossibile caricare i dati dal database.</td></tr>`;
            }
        }
    }

    function resetAndPopulateDropdowns(data) {
        [
            { key: 'country', el: selectCountry },
            { key: 'service', el: selectService },
            { key: 'provider', el: selectProvider },
            { key: 'status', el: selectStatus }
        ].forEach(({ key, el }) => {
            if (!el) return;
            existingDropdownOptions[key].clear();

            // Rimuove tutte le opzioni tranne la prima (es. "Tutti i paesi")
            while (el.options.length > 1) {
                el.remove(1);
            }
            
            // Registra nel Set il valore della prima opzione se presente
            Array.from(el.options).forEach(opt => {
                if (opt.value) existingDropdownOptions[key].add(opt.value);
            });
        });

        updateDropdownIncremental('country', selectCountry, data);
        updateDropdownIncremental('service', selectService, data);
        updateDropdownIncremental('provider', selectProvider, data);
        updateDropdownIncremental('status', selectStatus, data);
    }

    /**
     * Inserimento INCREMENTALE: Aggiunge solo i nuovi valori univoci
     */
    function updateDropdownIncremental(key, selectElement, data) {
        if (!selectElement) return;
        const set = existingDropdownOptions[key];

        // Sincronizza il Set con eventuali opzioni già presenti nell'HTML
        Array.from(selectElement.options).forEach(opt => {
            if (opt.value) set.add(opt.value);
        });

        const newVals = [];
        data.forEach(item => {
            const val = item[key];
            if (val !== null && val !== undefined && val !== '' && !set.has(val)) {
                set.add(val);
                newVals.push(val);
            }
        });

        if (newVals.length === 0) return;

        const fragment = document.createDocumentFragment();
        newVals.sort().forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            fragment.appendChild(optionEl);
        });
        selectElement.appendChild(fragment);
    }

    // === 6. WEBSOCKET CON THROTTLING REALE DEI RENDERING ===
    let renderTimer = null;
    let lastChartUpdateTime = 0;
    const CHART_THROTTLE_MS = 10000;
    const RENDER_DEBOUNCE_MS = 300;

    function scheduleRender() {
        if (renderTimer) return;
        renderTimer = setTimeout(() => {
            renderTimer = null;
            if (viewAnalytics && !viewAnalytics.classList.contains('hidden')) {
                applyFiltersAndRender(false);
            }
        }, RENDER_DEBOUNCE_MS);
    }

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
            
            updateDropdownIncremental('country', selectCountry, [newSession]);
            updateDropdownIncremental('service', selectService, [newSession]);
            updateDropdownIncremental('provider', selectProvider, [newSession]);
            updateDropdownIncremental('status', selectStatus, [newSession]);
        }

        scheduleRender();
    });

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
        applyFiltersAndRender(true);
    }

    function removeFilter(key) {
        activeFilters[key] = '';
        if (key === 'country' && selectCountry) selectCountry.value = '';
        if (key === 'service' && selectService) selectService.value = '';
        if (key === 'provider' && selectProvider) selectProvider.value = '';
        if (key === 'status' && selectStatus) selectStatus.value = '';
        applyFiltersAndRender(true);
    }

    // === DISABILITA OPZIONE GRAFICO SE FILTRO ATTIVO ===
    function updateChartDropdownOptions() {
        const paramSelect = document.getElementById('paramSelect');
        if (!paramSelect) return;

        let currentVal = paramSelect.value;
        let selectedOptionDisabled = false;

        Array.from(paramSelect.options).forEach(option => {
            const val = option.value;
            const isFiltered = Boolean(activeFilters[val]);

            if (isFiltered) {
                if (!option.disabled) {
                    option.disabled = true;
                    option.textContent = `${getCategoryLabel(val)} (Filtro attivo)`;
                }
                if (val === currentVal) {
                    selectedOptionDisabled = true;
                }
            } else {
                if (option.disabled) {
                    option.disabled = false;
                    option.textContent = getCategoryLabel(val);
                }
            }
        });

        if (selectedOptionDisabled) {
            const firstAvailable = Array.from(paramSelect.options).find(opt => !opt.disabled);
            if (firstAvailable) {
                paramSelect.value = firstAvailable.value;
                paramSelect.dispatchEvent(new Event('change'));
            }
        }
    }

    // === 8. FILTRAGGIO, ORDINAMENTO E RENDERING TABELLA & STATS ===
    function applyFiltersAndRender(forceChartUpdate = false) {
        renderFilterChips();
        updateChartDropdownOptions();

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

        window.filteredConnections = result;

        const now = Date.now();
        if (forceChartUpdate || (now - lastChartUpdateTime >= CHART_THROTTLE_MS)) {
            if (typeof updateAnalyticsDashboard === 'function') {
                updateAnalyticsDashboard(result, allSessions);
                lastChartUpdateTime = now;
            }
        }

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