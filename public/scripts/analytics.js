document.addEventListener('DOMContentLoaded', () => {
    let allSessions = [];
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

    // 1. Recupera le sessioni dall'endpoint /api/sessions del database
    async function loadSessionsData() {
        try {
            const response = await fetch('/api/sessions');
            if (!response.ok) throw new Error('Errore nel recupero dati');
            
            allSessions = await response.json();
            
            populateDropdowns(allSessions);
            applyFiltersAndRender();
        } catch (error) {
            console.error('Errore:', error);
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#f87171;">Impossibile caricare i dati dal database.</td></tr>`;
        }
    }

    // 2. Popola i dropdown selezionando solo i valori unici reali del database
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
        const firstOption = selectElement.options[0];
        selectElement.innerHTML = '';
        selectElement.appendChild(firstOption);

        options.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            selectElement.appendChild(optionEl);
        });
    }

    // 3. Gestione selezione filtri (un solo valore attivo per categoria)
    selectCountry.addEventListener('change', (e) => setFilter('country', e.target.value));
    selectService.addEventListener('change', (e) => setFilter('service', e.target.value));
    selectProvider.addEventListener('change', (e) => setFilter('provider', e.target.value));
    selectStatus.addEventListener('change', (e) => setFilter('status', e.target.value));

    function setFilter(key, value) {
        activeFilters[key] = value;
        applyFiltersAndRender();
    }

    function removeFilter(key) {
        activeFilters[key] = '';
        
        if (key === 'country') selectCountry.value = '';
        if (key === 'service') selectService.value = '';
        if (key === 'provider') selectProvider.value = '';
        if (key === 'status') selectStatus.value = '';

        applyFiltersAndRender();
    }

    // 4. Filtraggio dati e aggiornamento UI
    function applyFiltersAndRender() {
        renderFilterChips();

        const filteredSessions = allSessions.filter(session => {
            if (activeFilters.country && session.country !== activeFilters.country) return false;
            if (activeFilters.service && session.service !== activeFilters.service) return false;
            if (activeFilters.provider && session.provider !== activeFilters.provider) return false;
            if (activeFilters.status && session.status !== activeFilters.status) return false;
            return true;
        });

        renderTable(filteredSessions);
    }

    function renderFilterChips() {
        const existingChips = activeFiltersBox.querySelectorAll('.filter-chip');
        existingChips.forEach(chip => chip.remove());

        const keysWithValues = Object.keys(activeFilters).filter(k => activeFilters[k] !== '');

        if (keysWithValues.length === 0) {
            noFiltersText.style.display = 'inline';
        } else {
            noFiltersText.style.display = 'none';

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
        const labels = {
            country: 'Nazione',
            service: 'Servizio',
            provider: 'Provider',
            status: 'Stato'
        };
        return labels[key] || key;
    }

    function renderTable(data) {
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
                    <span class="badge-status ${item.status === 'active' ? 'status-active' : 'status-idle'}">
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

    loadSessionsData();
});