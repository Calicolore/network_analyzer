/**
 * Modulo UI - Rendering, Tabelle, KPI e Filtri Grafici (analyticsUI.js)
 */

window.analyticsUI = {
    lastChartUpdateTime: 0,
    CHART_THROTTLE_MS: 10000,

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    getCategoryLabel(key) {
        const labels = { country: 'Nazione', service: 'Servizio', provider: 'Provider', status: 'Stato' };
        return labels[key] || key;
    },

    /**
     * Aggiorna le Card KPI in cima alla pagina con i dati dell'intero DB
     */
    updateGlobalKpiUI() {
        const state = window.analyticsState;
        const kpiConn = document.getElementById('kpi-connections');
        const kpiPerc = document.getElementById('kpi-percentage');
        const kpiBw = document.getElementById('kpi-bandwidth');
        const kpiSub = document.getElementById('kpi-bandwidth-subtext');
        const kpiCountries = document.getElementById('kpi-countries');

        const totalDbCount = state.globalDbStats.totalConnections || state.totalItems;

        if (kpiConn) {
            if (state.totalItems < totalDbCount) {
                const perc = totalDbCount > 0 ? ((state.totalItems / totalDbCount) * 100).toFixed(1) : '0';
                kpiConn.innerText = `${state.totalItems} / ${totalDbCount}`;
                if (kpiPerc) kpiPerc.innerText = `(${perc}% filtrate)`;
            } else {
                kpiConn.innerText = `${totalDbCount}`;
                if (kpiPerc) kpiPerc.innerText = `(100% del totale)`;
            }
        }

        if (kpiBw) kpiBw.innerText = this.formatBytes(state.globalDbStats.totalBytes);
        if (kpiSub) kpiSub.innerText = `${this.formatBytes(state.globalDbStats.totalBytes)} totali nel DB`;
        if (kpiCountries) kpiCountries.innerText = state.globalDbStats.totalCountries;
    },

    /**
     * Aggiorna la barra di paginazione
     */
    updatePaginationUI() {
        const state = window.analyticsState;
        const startElem = document.getElementById('pag-start');
        const endElem = document.getElementById('pag-end');
        const totalElem = document.getElementById('pag-total');
        const pageIndicator = document.getElementById('page-current-indicator');
        const btnPrev = document.getElementById('btn-page-prev');
        const btnNext = document.getElementById('btn-page-next');

        const startVal = state.totalItems === 0 ? 0 : (state.currentPage - 1) * state.currentLimit + 1;
        const endVal = Math.min(state.currentPage * state.currentLimit, state.totalItems);

        if (startElem) startElem.innerText = startVal;
        if (endElem) endElem.innerText = endVal;
        if (totalElem) totalElem.innerText = state.totalItems;
        if (pageIndicator) pageIndicator.innerText = `Pagina ${state.currentPage} di ${state.totalPages}`;

        if (btnPrev) btnPrev.disabled = (state.currentPage <= 1);
        if (btnNext) btnNext.disabled = (state.currentPage >= state.totalPages);
    },

    /**
     * Inizializza gli eventi sui TH della tabella per l'ordinamento
     */
    initSortingHeaders() {
        const headers = document.querySelectorAll('#view-analytics th.sortable');
        headers.forEach(header => {
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => {
                const column = header.getAttribute('data-sort');
                const state = window.analyticsState;
                
                if (state.currentSortColumn === column) {
                    state.currentSortOrder = state.currentSortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    state.currentSortColumn = column;
                    state.currentSortOrder = (column === 'total_bytes' || column === 'last_seen') ? 'desc' : 'asc';
                }
                
                this.updateSortIcons();
                this.applyFiltersAndRender(true);
            });
        });
    },

    updateSortIcons() {
        const state = window.analyticsState;
        document.querySelectorAll('#view-analytics th.sortable').forEach(header => {
            const column = header.getAttribute('data-sort');
            const icon = header.querySelector('.sort-icon');
            if (!icon) return;

            if (column === state.currentSortColumn) {
                icon.textContent = state.currentSortOrder === 'asc' ? ' ▲' : ' ▼';
                header.style.color = '#38bdf8';
            } else {
                icon.textContent = ' ⇅';
                header.style.color = '';
            }
        });
    },

    /**
     * Popola i dropdown di filtraggio
     */
    resetAndPopulateDropdowns(data) {
        const state = window.analyticsState;
        const selects = [
            { key: 'country', el: document.getElementById('select-country') },
            { key: 'service', el: document.getElementById('select-service') },
            { key: 'provider', el: document.getElementById('select-provider') },
            { key: 'status', el: document.getElementById('select-status') }
        ];

        selects.forEach(({ key, el }) => {
            if (!el) return;
            state.existingDropdownOptions[key].clear();

            while (el.options.length > 1) {
                el.remove(1);
            }
            
            Array.from(el.options).forEach(opt => {
                if (opt.value) state.existingDropdownOptions[key].add(opt.value);
            });

            this.updateDropdownIncremental(key, el, data);
        });
    },

    updateDropdownIncremental(key, selectElement, data) {
        if (!selectElement) return;
        const set = window.analyticsState.existingDropdownOptions[key];

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
    },

    /**
     * Mostra i chip dei filtri attivi
     */
    renderFilterChips() {
        const activeFiltersBox = document.getElementById('active-filters-box');
        const noFiltersText = document.getElementById('no-filters-text');
        if (!activeFiltersBox) return;

        const state = window.analyticsState;
        activeFiltersBox.querySelectorAll('.filter-chip').forEach(chip => chip.remove());

        const keysWithValues = Object.keys(state.activeFilters).filter(k => state.activeFilters[k] !== '');

        if (keysWithValues.length === 0) {
            if (noFiltersText) noFiltersText.style.display = 'inline';
        } else {
            if (noFiltersText) noFiltersText.style.display = 'none';

            keysWithValues.forEach(key => {
                const chip = document.createElement('div');
                chip.className = 'filter-chip';
                chip.innerHTML = `
                    <span><strong>${this.getCategoryLabel(key)}:</strong> ${state.activeFilters[key]}</span>
                    <button title="Rimuovi filtro">&times;</button>
                `;
                chip.querySelector('button').addEventListener('click', () => {
                    state.activeFilters[key] = '';
                    const selectEl = document.getElementById(`select-${key}`);
                    if (selectEl) selectEl.value = '';
                    this.applyFiltersAndRender(true);
                });
                activeFiltersBox.appendChild(chip);
            });
        }
    },

    updateChartDropdownOptions() {
        const paramSelect = document.getElementById('paramSelect');
        if (!paramSelect) return;

        const state = window.analyticsState;
        let currentVal = paramSelect.value;
        let selectedOptionDisabled = false;

        Array.from(paramSelect.options).forEach(option => {
            const val = option.value;
            const isFiltered = Boolean(state.activeFilters[val]);

            if (isFiltered) {
                if (!option.disabled) {
                    option.disabled = true;
                    option.textContent = `${this.getCategoryLabel(val)} (Filtro attivo)`;
                }
                if (val === currentVal) selectedOptionDisabled = true;
            } else {
                if (option.disabled) {
                    option.disabled = false;
                    option.textContent = this.getCategoryLabel(val);
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
    },

    /**
     * Applica ordinamento, filtri grafici e renderizza la tabella
     */
    applyFiltersAndRender(forceChartUpdate = false) {
        const state = window.analyticsState;
        this.renderFilterChips();
        this.updateChartDropdownOptions();

        let result = state.allSessions.filter(session => {
            if (state.activeFilters.country && session.country !== state.activeFilters.country) return false;
            if (state.activeFilters.service && session.service !== state.activeFilters.service) return false;
            if (state.activeFilters.provider && session.provider !== state.activeFilters.provider) return false;
            if (state.activeFilters.status && session.status !== state.activeFilters.status) return false;
            return true;
        });

        result.sort((a, b) => {
            let valA = a[state.currentSortColumn] ?? '';
            let valB = b[state.currentSortColumn] ?? '';

            if (state.currentSortColumn === 'total_bytes') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
            } else {
                valA = valA.toString().toLowerCase();
                valB = valB.toString().toLowerCase();
            }

            if (valA < valB) return state.currentSortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return state.currentSortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        window.filteredConnections = result;

        const now = Date.now();
        if (forceChartUpdate || (now - this.lastChartUpdateTime >= this.CHART_THROTTLE_MS)) {
            if (typeof updateAnalyticsDashboard === 'function') {
                updateAnalyticsDashboard(result, state.allSessions);
                this.lastChartUpdateTime = now;
            }
        }

        this.renderTable(result);
        this.updateGlobalKpiUI();
    },

    renderTable(data) {
        const tableBody = document.getElementById('connections-table-body');
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
                <td>${this.formatBytes(item.total_bytes || 0)}</td>
                <td>
                    <span class="badge-status ${item.status === 'active' ? 'status-active' : (item.status === 'closed' ? 'status-closed' : 'status-idle')}">
                        ${item.status || 'idle'}
                    </span>
                </td>
                <td>${item.last_seen || 'N/A'}</td>
            </tr>
        `).join('');
    }
};