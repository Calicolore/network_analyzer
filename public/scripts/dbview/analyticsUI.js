/**
 * ====================================================================================
 * MODULO UI — RENDERING, TABELLE, KPI E FILTRI (dbview/analyticsUI.js)
 * ====================================================================================
 * Implementa la Protezione dall'aggiornamento Real-Time (Pausa, Paginazione, Throttling
 * DOM e Dropdown Focus) e l'orchestrazione filtro→ordina→pagina→render.
 * Unica fonte di verità per i 5 KPI tile in cima alla vista (vedi updateGlobalKpiUI):
 * in precedenza analyticsChart.js scriveva gli stessi elementi con valori leggermente
 * diversi subito prima di questa funzione, nascondendo per sempre la percentuale reale
 * dietro una stringa statica — quella responsabilità duplicata è stata rimossa da
 * analyticsChart.js, che ora si occupa solo del grafico a torta.
 * Dipende da: analyticsChart.js (isUndefinedValue, renderAnalyticsChart — deve caricare
 * PRIMA di questo file).
 * ====================================================================================
 */

window.analyticsUI = {
    lastChartUpdateTime: 0,
    lastTableUpdateTime: 0,
    CHART_THROTTLE_MS: 500,
    TABLE_THROTTLE_MS: 300,

    /**
     * Formatta un numero di byte in unità leggibile (B/KB/MB/GB/TB).
     *
     * @param {number} bytes - Numero di byte da formattare
     * @returns {string} Valore formattato, es. "12.34 MB"
     */
    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    /**
     * Traduce la chiave di un filtro/colonna nell'etichetta italiana mostrata in UI.
     *
     * @param {string} key - Chiave del filtro (es. "country", "service")
     * @returns {string} Etichetta leggibile, o `key` stessa se non mappata
     */
    getCategoryLabel(key) {
        const labels = { country: 'Nazione', service: 'Servizio', provider: 'Provider', status: 'Stato' };
        return labels[key] || key;
    },

    /**
     * Scrive i 5 KPI tile in cima alla vista Analytics. `filteredDataset` è il
     * risultato dei filtri attivi; il totale (per percentuale e byte complessivi)
     * viene sempre calcolato sull'intero DB (`state.globalChartSessions`).
     *
     * @param {object[]} filteredDataset - Dataset dopo i filtri attivi
     */
    updateGlobalKpiUI(filteredDataset) {
        const state = window.analyticsState;
        const kpiConn = document.getElementById('kpi-connections');
        const kpiPerc = document.getElementById('kpi-percentage');
        const kpiBw = document.getElementById('kpi-bandwidth');
        const kpiSub = document.getElementById('kpi-bandwidth-subtext');
        const kpiCountries = document.getElementById('kpi-countries');

        const dataset = filteredDataset || state.globalChartSessions || [];
        const totalDataset = state.globalChartSessions || [];

        const filteredCount = dataset.length;
        const totalCount = totalDataset.length;

        const filteredBytes = dataset.reduce((acc, s) => acc + (Number(s.total_bytes) || 0), 0);
        const totalBytes = totalDataset.reduce((acc, s) => acc + (Number(s.total_bytes) || 0), 0);

        const uniqueCountries = new Set(
            dataset.map(s => s.country).filter(c => !isUndefinedValue(c, 'country'))
        ).size;

        if (kpiConn) kpiConn.innerText = `${filteredCount} / ${totalCount}`;
        if (kpiPerc) {
            const pct = totalCount > 0 ? ((filteredCount / totalCount) * 100).toFixed(1) : '0';
            kpiPerc.innerText = `(${pct}% del totale DB)`;
        }
        if (kpiBw) kpiBw.innerText = this.formatBytes(filteredBytes);
        if (kpiSub) kpiSub.innerText = `${this.formatBytes(totalBytes)} totali nel DB`;
        if (kpiCountries) kpiCountries.innerText = uniqueCountries;
    },

    /**
     * Aggiorna il testo "Mostrando X-Y di Z" e lo stato abilitato/disabilitato dei
     * pulsanti Prec/Succ, in base a `analyticsState` corrente.
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
     * Collega il click sulle intestazioni di colonna ordinabili al cambio di
     * ordinamento (stessa colonna -> inverte verso, colonna diversa -> imposta un
     * verso di default sensato per quella colonna).
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

    /**
     * Aggiorna le frecce ▲/▼/⇅ sulle intestazioni di colonna in base alla colonna e
     * al verso di ordinamento correnti.
     */
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
     * Ripopola da zero i 4 menu a tendina dei filtri (country/service/provider/status)
     * con i valori DISTINCT presenti nel dataset, preservando la selezione corrente.
     *
     * @param {object[]} dataset - Dataset (tipicamente l'intero DB) da cui estrarre i
     *   valori distinti
     */
    resetAndPopulateDropdowns(dataset) {
        const state = window.analyticsState;
        const fields = ['country', 'service', 'provider', 'status'];

        fields.forEach(key => {
            const selectEl = document.getElementById(`select-${key}`);
            if (!selectEl) return;

            const currentSelected = state.activeFilters[key] || selectEl.value || '';
            const distinctSet = new Set();

            (dataset || []).forEach(item => {
                const val = item[key];
                if (val !== null && val !== undefined) {
                    const strVal = String(val).trim();
                    if (strVal !== '' && strVal !== 'N/A' && strVal !== 'Sconosciuta') {
                        distinctSet.add(strVal);
                    }
                }
            });

            state.existingDropdownOptions[key] = distinctSet;

            const sortedValues = Array.from(distinctSet).sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
            );

            selectEl.innerHTML = '';

            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = `Tutti (${this.getCategoryLabel(key)})`;
            selectEl.appendChild(defaultOpt);

            sortedValues.forEach(val => {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = val;
                if (val === currentSelected) {
                    opt.selected = true;
                }
                selectEl.appendChild(opt);
            });
        });
    },

    /**
     * Protezione Dropdown: Aggiunge opzioni dinamiche solo se l'utente non sta
     * attualmente interagendo con il select (evita chiusure/reset del menu).
     *
     * @param {object} packetData - Pacchetto live appena ricevuto
     */
    updateDropdownsWithNewItem(packetData) {
        const state = window.analyticsState;
        const fields = ['country', 'service', 'provider', 'status'];

        fields.forEach(key => {
            const val = packetData[key];
            if (!val) return;

            const strVal = String(val).trim();
            if (strVal === '' || strVal === 'N/A' || strVal === 'Sconosciuta') return;

            if (!state.existingDropdownOptions) state.existingDropdownOptions = {};
            if (!state.existingDropdownOptions[key]) state.existingDropdownOptions[key] = new Set();

            const distinctSet = state.existingDropdownOptions[key];
            if (!distinctSet.has(strVal)) {
                distinctSet.add(strVal);

                const selectEl = document.getElementById(`select-${key}`);
                if (selectEl && document.activeElement !== selectEl) {
                    const opt = document.createElement('option');
                    opt.value = strVal;
                    opt.textContent = strVal;
                    selectEl.appendChild(opt);
                }
            }
        });
    },

    /**
     * Ridisegna i "chip" dei filtri attivi (uno per ogni filtro con valore non vuoto),
     * ciascuno con un pulsante per rimuovere quel singolo filtro.
     */
    renderFilterChips() {
        const activeFiltersBox = document.getElementById('active-filters-box');
        const noFiltersText = document.getElementById('no-filters-text');
        if (!activeFiltersBox) return;

        const state = window.analyticsState;
        activeFiltersBox.querySelectorAll('.filter-chip').forEach(chip => chip.remove());

        const keysWithValues = Object.keys(state.activeFilters || {}).filter(k => state.activeFilters[k] !== '');

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
                    state.currentPage = 1;
                    this.applyFiltersAndRender(true);
                });
                activeFiltersBox.appendChild(chip);
            });
        }
    },

    /**
     * Disabilita nel selettore "Raggruppa per" (`#paramSelect`) il parametro su cui è
     * già attivo un filtro (raggruppare per un valore già fissato da un filtro non
     * avrebbe senso: darebbe sempre una sola fetta), spostando la selezione su
     * un'opzione ancora disponibile se necessario.
     */
    updateChartDropdownOptions() {
        const paramSelect = document.getElementById('paramSelect');
        if (!paramSelect) return;

        const state = window.analyticsState;
        let currentVal = paramSelect.value;
        let selectedOptionDisabled = false;

        Array.from(paramSelect.options).forEach(option => {
            const val = option.value;
            const isFiltered = Boolean(state.activeFilters && state.activeFilters[val]);

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
            }
        }
    },

    /**
     * Filtra l'INTERO DATABASE per il grafico e suddivide in pagine per la tabella.
     * Applica la Protezione Paginazione Real-Time.
     *
     * @param {boolean} [forceChartUpdate] - true per forzare grafico/tabella a
     *   ridisegnarsi subito, ignorando throttling e protezione-pagina (usato per
     *   cambi utente espliciti come filtri/paginazione, non per il flusso live)
     */
    applyFiltersAndRender(forceChartUpdate = false) {
        const state = window.analyticsState;
        const exp = window.analyticsExport;
        if (!state) return;

        this.renderFilterChips();
        this.updateChartDropdownOptions();

        let dataset = state.globalChartSessions || [];

        // Se siamo in Real Time e l'utente seleziona "Solo Sessione Corrente"
        if (exp && !exp.isImportedMode && state.viewScope === 'current') {
            dataset = dataset.filter(session => session.is_current_session === true);
        }

        // 1. Filtra l'intero dataset per i filtri attivi (country, service, provider, status)
        let fullFilteredDataset = dataset.filter(session => {
            if (state.activeFilters.country && session.country !== state.activeFilters.country) return false;
            if (state.activeFilters.service && session.service !== state.activeFilters.service) return false;
            if (state.activeFilters.provider && session.provider !== state.activeFilters.provider) return false;
            if (state.activeFilters.status && session.status !== state.activeFilters.status) return false;
            return true;
        });

        // 2. Ordina l'intero dataset filtrato
        fullFilteredDataset.sort((a, b) => {
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

        // 3. Riferimento globale per i grafici
        window.filteredConnections = fullFilteredDataset;

        // 4. Calcola la paginazione
        state.totalItems = fullFilteredDataset.length;
        state.totalPages = Math.max(1, Math.ceil(state.totalItems / state.currentLimit));
        if (state.currentPage > state.totalPages) state.currentPage = state.totalPages;

        // 5. Estrai la porzione di elementi per la tabella della pagina corrente
        const startIdx = (state.currentPage - 1) * state.currentLimit;
        const pageTableData = fullFilteredDataset.slice(startIdx, startIdx + state.currentLimit);
        state.allSessions = pageTableData;

        // 6. Invia al Grafico a Torta (con throttling temporale)
        const now = Date.now();
        if (forceChartUpdate || (now - this.lastChartUpdateTime >= this.CHART_THROTTLE_MS)) {
            if (typeof renderAnalyticsChart === 'function') {
                renderAnalyticsChart(fullFilteredDataset);
                this.lastChartUpdateTime = now;
            }
        }

        // 7. Aggiorna KPI e Paginazione sempre
        this.updatePaginationUI();
        this.updateGlobalKpiUI(fullFilteredDataset);

        /**
         * Se è un aggiornamento automatico da streaming real-time e l'utente NON è su Pagina 1
         * (es. sta analizzando Pagina 2 o successive), aggiorniamo i dati in background ma
         * NON ridisegniamo le righe della tabella per evitare slittamenti e glitch visivi.
         */
        // 8. Protezione paginazione real-time per la tabella
        if (forceChartUpdate || state.currentPage === 1) {
            this.renderTable(pageTableData);
        }
    },

    /**
     * Ridisegna le righe della tabella risultati per la pagina corrente.
     *
     * @param {object[]} data - Righe sessione da mostrare (già paginate)
     */
    renderTable(data) {
        const tableBody = document.getElementById('connections-table-body');
        if (!tableBody) return;

        if (!data || data.length === 0) {
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
