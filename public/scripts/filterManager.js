/**
 * ====================================================================================
 * GESTORE FILTRI E RICERCA IN TEMPO REALE (filterManager.js)
 * ====================================================================================
 */

const FilterManager = {
    // Riferimenti agli elementi DOM
    searchInput: null,
    clearSearchBtn: null,
    serviceFilter: null,
    statusFilter: null,
    resetBtn: null,
    counterEl: null,

    /**
     * Inizializza i listener della barra filtri
     */
    init() {
        this.searchInput = document.getElementById('search-input');
        this.clearSearchBtn = document.getElementById('clear-search-btn');
        this.serviceFilter = document.getElementById('service-filter');
        this.statusFilter = document.getElementById('status-filter');
        this.resetBtn = document.getElementById('reset-filters-btn');
        this.counterEl = document.getElementById('filter-counter');

        if (!this.searchInput) return;

        // Listener per input e tendine
        this.searchInput.addEventListener('input', () => {
            this.toggleClearBtn();
            this.applyFilters();
        });

        this.clearSearchBtn.addEventListener('click', () => {
            this.searchInput.value = '';
            this.toggleClearBtn();
            this.applyFilters();
        });

        this.serviceFilter.addEventListener('change', () => this.applyFilters());
        this.statusFilter.addEventListener('change', () => this.applyFilters());
        this.resetBtn.addEventListener('click', () => this.resetAll());
    },

    toggleClearBtn() {
        if (this.clearSearchBtn) {
            this.clearSearchBtn.style.display = this.searchInput.value ? 'block' : 'none';
        }
    },

    resetAll() {
        if (this.searchInput) this.searchInput.value = '';
        if (this.serviceFilter) this.serviceFilter.value = 'ALL';
        if (this.statusFilter) this.statusFilter.value = 'ALL';
        this.toggleClearBtn();
        this.applyFilters();
    },

    /**
     * Verifica se una singola card soddisfa i criteri attivi
     */
    checkCardMatch(card) {
        const query = (this.searchInput?.value || '').trim().toLowerCase();
        const selectedService = this.serviceFilter?.value || 'ALL';
        const selectedStatus = this.statusFilter?.value || 'ALL';

        // Data attributes memorizzati sulla card
        const domain = card.dataset.domain || '';
        const ip = card.dataset.ip || '';
        const country = card.dataset.country || '';
        const provider = card.dataset.provider || '';
        const service = card.dataset.service || '';
        const isClosed = card.dataset.closed === 'true';

        // 1. Filtro Testuale (su dataset e testo visibile)
        let matchesQuery = true;
        if (query) {
            const fullContent = `${domain} ${ip} ${country} ${provider} ${service} ${card.innerText}`.toLowerCase();
            matchesQuery = fullContent.includes(query);
        }

        // 2. Filtro Servizio / Porta
        let matchesService = true;
        if (selectedService !== 'ALL') {
            if (selectedService === 'OTHER') {
                matchesService = !['HTTPS', 'HTTP', 'DNS', 'QUIC'].includes(service);
            } else {
                matchesService = service.includes(selectedService);
            }
        }

        // 3. Filtro Stato Connessione
        let matchesStatus = true;
        if (selectedStatus === 'ACTIVE') {
            matchesStatus = !isClosed;
        } else if (selectedStatus === 'CLOSED') {
            matchesStatus = isClosed;
        }

        return matchesQuery && matchesService && matchesStatus;
    },

    /**
     * Applica i filtri su tutte le card correnti nella dashboard
     */
    applyFilters() {
        const cards = document.querySelectorAll('#dashboard .session-card');
        let visibleCount = 0;

        cards.forEach(card => {
            const isMatch = this.checkCardMatch(card);
            if (isMatch) {
                card.classList.remove('filter-hidden');
                visibleCount++;
            } else {
                card.classList.add('filter-hidden');
            }
        });

        this.updateCounter(visibleCount, cards.length);
    },

    /**
     * Valuta una nuova card creata dinamica durante lo streaming
     */
    evaluateNewCard(cardElement) {
        const isMatch = this.checkCardMatch(cardElement);
        if (isMatch) {
            cardElement.classList.remove('filter-hidden');
        } else {
            cardElement.classList.add('filter-hidden');
        }
        this.updateCounterOnly();
    },

    updateCounter(visible, total) {
        if (this.counterEl) {
            this.counterEl.innerHTML = `Sessioni: <strong>${visible} / ${total}</strong>`;
        }
    },

    updateCounterOnly() {
        const totalCards = document.querySelectorAll('#dashboard .session-card').length;
        const visibleCards = document.querySelectorAll('#dashboard .session-card:not(.filter-hidden)').length;
        this.updateCounter(visibleCards, totalCards);
    }
};

// Inizializzazione al caricamento del DOM
document.addEventListener('DOMContentLoaded', () => {
    FilterManager.init();
});

// Esporta l'oggetto a livello globale per utilizzarlo in dashboard.js / uiManager.js
window.FilterManager = FilterManager;