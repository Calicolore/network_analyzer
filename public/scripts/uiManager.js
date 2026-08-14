/**
 * ================================================================================
 * GESTORE DELL'INTERFACCIA UTENTE E SCHEDE DI SESSIONE (uiManager.js)
 * ================================================================================
 * Questo modulo gestisce la creazione, l'aggiornamento dinamico, l'ordinamento
 * e la rimozione delle schede di sessione (card) nella dashboard.
 * ================================================================================
 */

// ================================================================================
// PASSO 1: INIZIALIZZAZIONE ELEMENTI DOM E VARIABILI DI STATO
// ================================================================================
const dashboard = document.getElementById('dashboard');
let sortThrottleTimeout = null;

// ================================================================================
// PASSO 2: ORDINAMENTO THROTTLED DELLE CARD PER CONSUMO DI BANDA
// ================================================================================
function sortCardsByUsage() {
    if (sortThrottleTimeout) return;

    // Esegue il riordinamento DOM a intervalli controllati (1000ms)
    // per evitare Continuous Layout Reflow durante il flusso intenso di pacchetti
    sortThrottleTimeout = setTimeout(() => {
        const cards = Array.from(dashboard.querySelectorAll('.session-card'));
        if (cards.length < 2) {
            sortThrottleTimeout = null;
            return;
        }

        // Verifica se l'ordine attuale è cambiato prima di toccare il DOM
        let needsReorder = false;
        for (let i = 0; i < cards.length - 1; i++) {
            const kbA = parseFloat(cards[i].getAttribute('data-kb') || 0);
            const kbB = parseFloat(cards[i + 1].getAttribute('data-kb') || 0);
            if (kbA < kbB) {
                needsReorder = true;
                break;
            }
        }

        // Sposta i nodi DOM solo se l'ordinamento è effettivamente variato
        if (needsReorder) {
            cards.sort((a, b) => {
                return parseFloat(b.getAttribute('data-kb') || 0) - parseFloat(a.getAttribute('data-kb') || 0);
            });
            cards.forEach(card => dashboard.appendChild(card));
        }

        sortThrottleTimeout = null;
    }, 1000);
}

// ================================================================================
// PASSO 3: GENERAZIONE E AGGIORNAMENTO DELLE CARD
// ================================================================================
function renderPacketCard(data) {
    let sessionDiv = document.getElementById(data.sessionId);
    
    // ================================================================================
    // FASE 1: CREAZIONE NUOVA CARD (SE NON ESISTE) E CACHING ELEMENTI DOM
    // ================================================================================
    if (!sessionDiv) {
        sessionDiv = document.createElement('div');
        sessionDiv.id = data.sessionId;
        sessionDiv.className = 'session-card';
        
        if (typeof currentlyHighlightedSessionId !== 'undefined' && currentlyHighlightedSessionId && currentlyHighlightedSessionId !== data.sessionId) {
            sessionDiv.classList.add('dimmed-card');
        }
        
        const countryBadge = `<span style="background:#334155; padding:2px 6px; border-radius:4px; font-size:0.7em; margin-left:8px;">${data.country}</span>`;
        
        sessionDiv.innerHTML = `
            <div class="session-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div class="res-title" 
                        style="color: #38bdf8; font-size: 1.1em; font-weight: bold; word-break: break-all;"
                        title="Clicca sulla card per evidenziare la rotta sulla mappa">
                        ${data.resourceName}
                    </div>
                    <div class="subtitle-container"></div>
                    <div style="color: #64748b; font-size: 0.75em; font-family: monospace;">
                        IP: ${data.remoteIp} ${countryBadge}
                    </div>
                </div>
                <div class="bandwidth-meter" style="text-align: right; color: #10b981; font-weight: bold; font-family: monospace; font-size: 0.9em; min-width: 110px;">
                    ${data.totalKB} KB Tot.
                </div>
            </div>
            <div class="packets-container" style="height: 150px; overflow-y: auto; margin: 10px 0; border-top: 1px solid #334155; padding-top: 5px; font-size: 0.85em;"></div>
        `;
        dashboard.appendChild(sessionDiv);

        // Caching dei riferimenti ai nodi interni per evitare querySelector ripetuti ad ogni pacchetto
        sessionDiv._titleDiv = sessionDiv.querySelector('.res-title');
        sessionDiv._subContainer = sessionDiv.querySelector('.subtitle-container');
        sessionDiv._meterEl = sessionDiv.querySelector('.bandwidth-meter');
        sessionDiv._containerEl = sessionDiv.querySelector('.packets-container');
    } else {
        // Se arrivano nuovi pacchetti, la sessione torna attiva
        sessionDiv.classList.remove('closed-card');
        sessionDiv.classList.remove('idle-card');
    }

    // ================================================================================
    // FASE 2: OTTIMIZZAZIONE E AGGIORNAMENTO TITOLO E SOTTOTITOLO
    // ================================================================================
    const titleDiv = sessionDiv._titleDiv;
    const subContainer = sessionDiv._subContainer;

    const isGeneric = (name) => {
        if (!name) return true;
        const n = name.toLowerCase();
        return n.includes('googleusercontent') || n.includes('akamai') || 
               n.includes('amazonaws') || n.includes('1e100.net') || 
               n.includes('risorsa web') || n === data.remoteIp;
    };

    if (titleDiv) {
        const currentTitle = titleDiv.textContent.trim();
        const needsImprovement = isGeneric(currentTitle) || currentTitle === data.technicalSubtitle;
        const incomingIsBetter = !isGeneric(data.resourceName);

        if (needsImprovement && incomingIsBetter) {
            titleDiv.textContent = data.resourceName;
        }
    }

    if (subContainer) {
        const currentTitle = titleDiv ? titleDiv.textContent.trim() : '';
        
        const getBaseDomain = (dom) => {
            if (!dom) return '';
            const parts = dom.toLowerCase().split('.');
            return parts.length >= 2 ? parts.slice(-2).join('.') : dom;
        };

        const titleBase = getBaseDomain(currentTitle);
        const subBase = getBaseDomain(data.technicalSubtitle);

        if (data.technicalSubtitle && data.technicalSubtitle !== currentTitle && (titleBase === subBase || titleBase === '')) {
            subContainer.innerHTML = `<div class="technical-subtitle" style="color: #94a3b8; font-size: 0.85em; font-family: monospace; border-left: 2px solid #38bdf8; padding-left: 8px; margin-bottom: 4px;">${data.technicalSubtitle}</div>`;
        } else {
            subContainer.innerHTML = '';
        }
    }

    // ================================================================================
    // FASE 3: AGGIORNAMENTO METER BANDA E ATTRIBUTI DATI
    // ================================================================================
    sessionDiv.setAttribute('data-kb', data.totalKB);
    if (sessionDiv._meterEl) {
        sessionDiv._meterEl.innerText = `${data.totalKB} KB Tot.`;
    }

    // ================================================================================
    // FASE 4: INSERIMENTO RIGA PACCHETTO NEL CONTENITORE
    // ================================================================================
    const container = sessionDiv._containerEl;
    const directionCol = data.direction === "-->" ? "#ef4444" : "#22c55e";
    const serviceDisplay = data.service.startsWith('Port:') ? data.service : `Port: ${data.remotePort} - ${data.service}`;

    const p = document.createElement('div');
    p.className = 'packet-line';
    p.innerHTML = `
        <span style="color:#64748b; font-size: 0.85em;">${data.time}</span>
        <span style="color:${directionCol}; font-weight: bold; margin: 0 5px;">${data.direction}</span>
        <span class="flags" style="color:#94a3b8; font-size: 0.8em; margin-right: 5px;">[${data.flags}]</span>
        <span style="color:#38bdf8; font-weight:bold;">${serviceDisplay}</span>
    `;
    
    container.appendChild(p);

    if (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
    
    // Auto-scroll del contenitore pacchetti
    container.scrollTop = container.scrollHeight;

    // ================================================================================
    // FASE 5: AGGIORNAMENTO DATASET PER FILTRI E VALUTAZIONE
    // ================================================================================
    sessionDiv.dataset.domain = (data.resourceName || '').toLowerCase();
    sessionDiv.dataset.ip = (data.remoteIp || '').toLowerCase();
    sessionDiv.dataset.country = (data.country || '').toLowerCase();
    sessionDiv.dataset.provider = (data.provider || '').toLowerCase();
    sessionDiv.dataset.service = (data.service || '').toUpperCase();
    
    // Considera chiusa sia la connessione FIN/RST che quella in Timeout
    const isClosedOrIdle = sessionDiv.classList.contains('closed-card') || sessionDiv.classList.contains('idle-card');
    sessionDiv.dataset.closed = isClosedOrIdle ? 'true' : 'false';

    if (window.FilterManager) {
        window.FilterManager.evaluateNewCard(sessionDiv);
    }

    // Trigger del riordinamento ottimizzato
    sortCardsByUsage();
}

// ================================================================================
// PASSO 4: RIMOZIONE CARD DALLA DASHBOARD
// ================================================================================
function removeSessionCard(sessionId) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) {
        sessionDiv.remove();
    }
}

// ================================================================================
// PASSO 5: EVENT LISTENER TENDINA ED EVENTI CLICK SULLE CARD
// ================================================================================
document.addEventListener('DOMContentLoaded', () => {
    const toggleDashboardBtn = document.getElementById('toggle-dashboard-btn');
    const dashboardContainer = document.getElementById('dashboard');

    if (toggleDashboardBtn && dashboardContainer) {
        const btnText = toggleDashboardBtn.querySelector('.btn-text');
        const btnIcon = toggleDashboardBtn.querySelector('.btn-icon');

        toggleDashboardBtn.addEventListener('click', () => {
            const isCollapsed = dashboardContainer.classList.toggle('collapsed');

            if (isCollapsed) {
                if (btnText) btnText.textContent = 'Mostra';
                if (btnIcon) btnIcon.textContent = '▼';
            } else {
                if (btnText) btnText.textContent = 'Nascondi';
                if (btnIcon) btnIcon.textContent = '▲';
            }
        });
    }

    if (dashboardContainer) {
        dashboardContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.session-card');
            if (!card) return;

            if (window.getSelection().toString().length > 0) return;

            const sessionId = card.id;
            if (typeof window.focusLastHop === 'function') {
                window.focusLastHop(sessionId);
            }
        });
    }
});

// ================================================================================
// PASSO 6: MARCATURA CHIUSURA SESSIONE 
// ================================================================================
function markSessionClosed(sessionId, reason) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) {
        
        if (reason === 'Idle Timeout') {
            // Se è chiusa per inattività -> diventa GRIGIA / OPACA
            sessionDiv.classList.add('dimmed-card');
        } else {
            // Se è chiusa normalmente (FIN/RST) -> diventa ROSSA
            sessionDiv.classList.add('closed-card');
        }
        
        sessionDiv.dataset.closed = 'true';
        
        if (window.FilterManager) {
            window.FilterManager.evaluateNewCard(sessionDiv);
        }
    }
}