/**
 * Gestore dell'Interfaccia Utente (Dashboard, Card e Interazioni UI)
 */

const dashboard = document.getElementById('dashboard');
let sortThrottleTimeout = null;

/**
 * Ordinamento dinamico per consumo di banda
 */
function sortCardsByUsage() {
    if (sortThrottleTimeout) return;

    sortThrottleTimeout = setTimeout(() => {
        const cards = Array.from(dashboard.querySelectorAll('.session-card'));
        if (cards.length < 2) {
            sortThrottleTimeout = null;
            return;
        }

        cards.sort((a, b) => {
            return parseFloat(b.getAttribute('data-kb') || 0) - parseFloat(a.getAttribute('data-kb') || 0);
        });

        cards.forEach(card => dashboard.appendChild(card));
        sortThrottleTimeout = null;
    }, 10);
}

/**
 * Genera o aggiorna una scheda di sessione HTML
 */
function renderPacketCard(data) {
    let sessionDiv = document.getElementById(data.sessionId);
    
    if (!sessionDiv) {
        sessionDiv = document.createElement('div');
        sessionDiv.id = data.sessionId;
        sessionDiv.className = 'session-card';
        
        // Se c'è una card evidenziata attiva, scurisci subito la nuova arrivata
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
    } else {
        // Se la card esiste già ma era stata chiusa (bordo rosso), 
        // l'arrivo di nuovi pacchetti la fa tornare attiva rimuovendo la classe 'closed-card'
        sessionDiv.classList.remove('closed-card');
    }

    // Auto-riparazione nomi
    const titleDiv = sessionDiv.querySelector('.res-title');
    const subContainer = sessionDiv.querySelector('.subtitle-container');

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

    // Gestione Sottotitolo e Validazione Coerenza Domini
    if (subContainer) {
        const currentTitle = titleDiv.textContent.trim();
        
        const getBaseDomain = (dom) => {
            if (!dom) return '';
            const parts = dom.toLowerCase().split('.');
            return parts.length >= 2 ? parts.slice(-2).join('.') : dom;
        };

        const titleBase = getBaseDomain(currentTitle);
        const subBase = getBaseDomain(data.technicalSubtitle);

        // Mostra il sottotitolo solo se non è identico al titolo E appartiene alla stessa radice o se il titolo è generico
        if (data.technicalSubtitle && data.technicalSubtitle !== currentTitle && (titleBase === subBase || titleBase === '')) {
            subContainer.innerHTML = `<div class="technical-subtitle" style="color: #94a3b8; font-size: 0.85em; font-family: monospace; border-left: 2px solid #38bdf8; padding-left: 8px; margin-bottom: 4px;">${data.technicalSubtitle}</div>`;
        } else {
            subContainer.innerHTML = '';
        }
    }

    // Aggiornamento KB
    sessionDiv.setAttribute('data-kb', data.totalKB);
    const meter = sessionDiv.querySelector('.bandwidth-meter');
    if (meter) meter.innerText = `${data.totalKB} KB Tot.`;

    // Aggiunta riga pacchetto
    const container = sessionDiv.querySelector('.packets-container');
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
    
    container.scrollTop = container.scrollHeight;

    // --- INTEGRAZIONE FILTRI IN TEMPO REALE ---
    // 1. Assegna le etichette per la ricerca sulla card
    sessionDiv.dataset.domain = (data.resourceName || '').toLowerCase();
    sessionDiv.dataset.ip = (data.remoteIp || '').toLowerCase();
    sessionDiv.dataset.country = (data.country || '').toLowerCase();
    sessionDiv.dataset.provider = (data.provider || '').toLowerCase();
    sessionDiv.dataset.service = (data.service || '').toUpperCase();
    sessionDiv.dataset.closed = sessionDiv.classList.contains('closed-card') ? 'true' : 'false';

    // 2. Valuta se nascondere o mostrare la card in base ai filtri attualmente attivi nella barra
    if (window.FilterManager) {
        window.FilterManager.evaluateNewCard(sessionDiv);
    }

    sortCardsByUsage();
}

/**
 * Elimina la card HTML dalla dashboard
 */
function removeSessionCard(sessionId) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) {
        sessionDiv.remove();
    }
}

/**
 * Gestore dell'Interfaccia Utente (Tendina Dashboard & Eventi Click)
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- ACCORDION / TENDINA DASHBOARD ---
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

    // --- DELEGAZIONE EVENTO CLICK SULLE CARD ---
    if (dashboardContainer) {
        dashboardContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.session-card');
            if (!card) return;

            // Se l'utente sta selezionando del testo, ignoriamo il click
            if (window.getSelection().toString().length > 0) return;

            const sessionId = card.id;
            if (typeof window.focusLastHop === 'function') {
                window.focusLastHop(sessionId);
            }
        });
    }
});

/**
 * Imposta lo stato visivo di una card su "Chiusa" (Bordo Rosso)
 */
function markSessionClosed(sessionId) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) {
        sessionDiv.classList.add('closed-card');
        
        // --- INTEGRAZIONE FILTRI ---
        // Segnala al filtro che la connessione è chiusa
        sessionDiv.dataset.closed = 'true';
        if (window.FilterManager) {
            window.FilterManager.evaluateNewCard(sessionDiv);
        }
    }
}