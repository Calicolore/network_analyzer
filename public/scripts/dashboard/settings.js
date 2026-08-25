/**
 * ====================================================================================
 * GESTORE MENU IMPOSTAZIONI, SIDEBAR E PULIZIA AUTOMATICA (dashboard/settings.js)
 * ====================================================================================
 * Apertura/chiusura della sidebar impostazioni (condivisa da entrambe le viste) e
 * timer opzionale di pulizia automatica delle sessioni inattive lato client.
 * `initSettingsUI()` e `startAutoCleanupTask()` sono chiamate da dashboard.js
 * all'avvio (DOMContentLoaded) — non vengono auto-invocate qui, per coerenza con
 * l'orchestrazione centralizzata già usata per gli altri moduli.
 * ====================================================================================
 */

const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const sidebar = document.getElementById('settings-sidebar');
const overlay = document.getElementById('sidebar-overlay');
const autoCleanToggle = document.getElementById('auto-clean-toggle');
const timeoutContainer = document.getElementById('timeout-container');
const cleanupTimeoutInput = document.getElementById('cleanup-timeout');

let cleanupIntervalId = null;

/**
 * Inizializza gli eventi per l'apertura/chiusura della sidebar
 */
function initSettingsUI() {
    function openSidebar() {
        sidebar?.classList.add('open');
        overlay?.classList.add('active');
    }

    function closeSidebar() {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('active');
    }

    if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSidebar);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);

    if (autoCleanToggle) {
        autoCleanToggle.addEventListener('change', (e) => {
            if (timeoutContainer) {
                timeoutContainer.style.display = e.target.checked ? 'block' : 'none';
            }
        });
    }
}

/**
 * Avvia il timer di monitoraggio per la pulizia delle sessioni inattive.
 * Criterio: ogni secondo controlla l'attributo `data-last-active` di ogni card
 * (impostato da dashboard.js a ogni pacchetto ricevuto su quella sessione) e, se
 * il toggle "Pulizia automatica" è attivo e il tempo di inattività supera la soglia
 * configurata (`cleanup-timeout`, in secondi), marca la card come chiusa tramite
 * `markSessionClosed` (bordo rosso — vedi uiCardHelpers.js).
 *
 * @param {Function} [removeSessionCallback] - Non usato nel corpo della funzione (la
 *   pulizia è puramente visiva, non rimuove la card né chiude la sessione lato server):
 *   invocare la funzione senza argomenti è corretto, il parametro resta per compatibilità
 */
function startAutoCleanupTask(removeSessionCallback) {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
    }

    cleanupIntervalId = setInterval(() => {
        if (!autoCleanToggle || !autoCleanToggle.checked) return;

        const timeoutSec = parseInt(cleanupTimeoutInput?.value || '30', 10);
        const timeoutMs = timeoutSec * 1000;
        const now = Date.now();

        const cards = document.querySelectorAll('.session-card');
        cards.forEach(card => {
            const lastActive = parseInt(card.getAttribute('data-last-active') || '0', 10);

            if (lastActive > 0 && (now - lastActive > timeoutMs)) {
                console.log(`[PULIZIA AUTOMATICA] Marcatura sessione chiusa: ${card.id}`);
                markSessionClosed(card.id); // Imposta il bordo rosso anziché rimuovere direttamente
            }
        });
    }, 1000);
}
