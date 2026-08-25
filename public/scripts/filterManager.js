/**
 * ====================================================================================
 * GESTORE FILTRI E RICERCA (filterManager.js)
 * ====================================================================================
 */

// Set per accumulare i valori DISTINCT rilevati dal traffico di rete
const detectedCountries = new Set();
const detectedServices = new Set();
const detectedFlows = new Set();

// Stato locale dei filtri attivi
const activeFilters = {
    domain: '',
    country: '',
    service: '',
    flow: ''
};

// Riferimento alla funzione di callback per aggiornare l'interfaccia principale
let onFilterChangeCallback = null;

/**
 * Estrae il nome dell'host/dominio provando tutte le proprietà possibili del pacchetto
 */
function extractPacketHost(packet) {
    if (!packet) return '';
    return (
        packet.domain ||
        packet.hostName ||
        packet.hostname ||
        packet.resourceName ||
        packet.host ||
        packet.dnsName ||
        packet.sni ||
        packet.dstHost ||
        packet.ip ||
        packet.dstIP ||
        ''
    ).toString().toLowerCase();
}

/**
 * Estrae la Nazione provando le varianti di proprietà
 */
function extractPacketCountry(packet) {
    if (!packet) return '';
    return (packet.country || packet.countryName || packet.nation || '').toString().trim();
}

/**
 * Estrae il Servizio / Porta provando le varianti di proprietà
 */
function extractPacketService(packet) {
    if (!packet) return '';
    if (packet.service) return packet.service.toString().trim();
    if (packet.protocol) return packet.protocol.toString().trim();
    const port = packet.port || packet.dstPort;
    if (port) return `PORT-${port}`;
    return '';
}

/**
 * Estrae la famiglia/flow (raggruppamento per sito/servizio, es. domini satellite di x.com)
 */
function extractPacketFlow(packet) {
    if (!packet) return '';
    return (packet.flow || '').toString().trim();
}

/**
 * Inizializza i listener degli eventi sugli elementi del DOM
 */
function initFilterManager(renderCallback) {
    onFilterChangeCallback = renderCallback;

    const domainInput = document.getElementById('domainSearchInput');
    const countrySelect = document.getElementById('countrySelect');
    const serviceSelect = document.getElementById('serviceSelect');
    const flowSelect = document.getElementById('flowSelect');
    const resetBtn = document.getElementById('resetFiltersBtn');

    // Ricerca dominio in tempo reale durante la digitazione
    domainInput?.addEventListener('input', (e) => {
        activeFilters.domain = e.target.value.trim().toLowerCase();
        triggerFilterUpdate();
    });

    // Selezione Nazione
    countrySelect?.addEventListener('change', (e) => {
        activeFilters.country = e.target.value;
        triggerFilterUpdate();
    });

    // Selezione Servizio / Porta
    serviceSelect?.addEventListener('change', (e) => {
        activeFilters.service = e.target.value;
        triggerFilterUpdate();
    });

    // Selezione Famiglia/Flow
    flowSelect?.addEventListener('change', (e) => {
        activeFilters.flow = e.target.value;
        triggerFilterUpdate();
    });

    // Reset Filtri
    resetBtn?.addEventListener('click', () => {
        resetAllFilters();
    });
}

/**
 * Registra i dati di una nuova connessione/pacchetto
 * e aggiorna i menu a tendina se compaiono valori DISTINCT non ancora registrati.
 */
function updateAvailableFilters(packet) {
    if (!packet) return;

    let hasNewValue = false;

    // 1. Estrazione Nazione
    const country = extractPacketCountry(packet);
    if (country && country !== 'Locale' && country !== 'Sconosciuta' && !detectedCountries.has(country)) {
        detectedCountries.add(country);
        hasNewValue = true;
    }

    // 2. Estrazione Servizio/Porta
    const service = extractPacketService(packet);
    if (service && !detectedServices.has(service)) {
        detectedServices.add(service);
        hasNewValue = true;
    }

    // 3. Estrazione Famiglia/Flow
    const flow = extractPacketFlow(packet);
    if (flow && !detectedFlows.has(flow)) {
        detectedFlows.add(flow);
        hasNewValue = true;
    }

    // Se è stato rilevato un valore nuovo, aggiorna i menu a tendina nel DOM
    if (hasNewValue) {
        renderFilterDropdowns();
    }
}

/**
 * Popola in modo dinamico i select mantenendo la selezione corrente
 */
function renderFilterDropdowns() {
    const countrySelect = document.getElementById('countrySelect');
    const serviceSelect = document.getElementById('serviceSelect');
    const flowSelect = document.getElementById('flowSelect');

    if (!countrySelect || !serviceSelect) return;

    const currentCountry = countrySelect.value;
    const currentService = serviceSelect.value;
    const currentFlow = flowSelect ? flowSelect.value : '';

    // Aggiorna Select Nazioni
    countrySelect.innerHTML = '<option value="">Tutte le Nazioni</option>';
    Array.from(detectedCountries).sort().forEach(country => {
        const option = document.createElement('option');
        option.value = country;
        option.textContent = country;
        countrySelect.appendChild(option);
    });
    countrySelect.value = currentCountry;

    // Aggiorna Select Servizi / Porte
    serviceSelect.innerHTML = '<option value="">Tutti i Servizi/Porte</option>';
    Array.from(detectedServices).sort().forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service;
        serviceSelect.appendChild(option);
    });
    serviceSelect.value = currentService;

    // Aggiorna Select Famiglia/Flow
    if (flowSelect) {
        flowSelect.innerHTML = '<option value="">Tutti i Flussi</option>';
        Array.from(detectedFlows).sort().forEach(flow => {
            const option = document.createElement('option');
            option.value = flow;
            option.textContent = flow;
            flowSelect.appendChild(option);
        });
        flowSelect.value = currentFlow;
    }
}

/**
 * Verifica se un pacchetto/connessione soddisfa tutti i filtri attivi
 */
function isPacketMatchingFilters(packet) {
    if (!packet) return true;

    // 1. Filtro Dominio (cerca nel nome host / dominio)
    if (activeFilters.domain) {
        const hostName = extractPacketHost(packet);
        if (!hostName.includes(activeFilters.domain)) {
            return false;
        }
    }

    // 2. Filtro Nazione
    if (activeFilters.country) {
        const country = extractPacketCountry(packet);
        if (country !== activeFilters.country) {
            return false;
        }
    }

    // 3. Filtro Servizio / Porta
    if (activeFilters.service) {
        const service = extractPacketService(packet);
        if (service !== activeFilters.service) {
            return false;
        }
    }

    // 4. Filtro Famiglia / Flow
    if (activeFilters.flow) {
        const flow = extractPacketFlow(packet);
        if (flow !== activeFilters.flow) {
            return false;
        }
    }

    return true;
}

/**
 * Notifica la dashboard dell'avvenuto cambio di filtri
 */
function triggerFilterUpdate() {
    if (typeof onFilterChangeCallback === 'function') {
        onFilterChangeCallback();
    }
}

/**
 * Resetta tutti i filtri e ripulisce gli input
 */
function resetAllFilters() {
    activeFilters.domain = '';
    activeFilters.country = '';
    activeFilters.service = '';
    activeFilters.flow = '';

    const domainInput = document.getElementById('domainSearchInput');
    const countrySelect = document.getElementById('countrySelect');
    const serviceSelect = document.getElementById('serviceSelect');
    const flowSelect = document.getElementById('flowSelect');

    if (domainInput) domainInput.value = '';
    if (countrySelect) countrySelect.value = '';
    if (serviceSelect) serviceSelect.value = '';
    if (flowSelect) flowSelect.value = '';

    triggerFilterUpdate();
}

// Esportazione funzioni per uso globale nel browser
window.filterManager = {
    init: initFilterManager,
    updateAvailableFilters,
    isPacketMatchingFilters,
    resetAllFilters
};