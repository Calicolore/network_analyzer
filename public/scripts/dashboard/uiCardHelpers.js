/**
 * ====================================================================================
 * HELPER DOM PER LE CARD DI SESSIONE LIVE (dashboard/uiCardHelpers.js)
 * ====================================================================================
 * Creazione e aggiornamento del nodo DOM di una card di sessione (titolo, badge
 * provider/paese/flow, sottotitolo DNS), ordinamento per banda consumata, e
 * marcatura visiva di una sessione chiusa o inattiva. Include anche il listener
 * per l'accordion "Comunicazioni Attive" e il click-to-focus su una card.
 * Dipende da: mapCore.js (currentlyHighlightedSessionId), mapHighlight.js
 * (window.focusLastHop).
 * ====================================================================================
 */

let sortThrottleTimeout = null;

// ================================================================================
// CREAZIONE ED AGGIORNAMENTO NODO CARD
// ================================================================================
function createCardNode(data) {
    const sessionDiv = document.createElement('div');
    sessionDiv.id = data.sessionId;
    sessionDiv.className = 'session-card live-card';

    if (typeof currentlyHighlightedSessionId !== 'undefined' && currentlyHighlightedSessionId && currentlyHighlightedSessionId !== data.sessionId) {
        sessionDiv.classList.add('dimmed-card');
    }

    const countryBadge = `<span style="background:#334155; padding:2px 6px; border-radius:4px; font-size:0.7em; margin-left:8px;">${data.country || 'N/A'}</span>`;
    const providerBadgeStyle = 'background:#0f766e; color:#ecfdf5; padding:2px 6px; border-radius:4px; font-size:0.7em; margin-left:6px;';
    const flowBadgeStyle = 'background:#4338ca; color:#e0e7ff; padding:2px 6px; border-radius:4px; font-size:0.7em; margin-left:6px;';
    const providerBadge = `<span class="provider-badge" style="${providerBadgeStyle}${data.provider ? '' : ' display:none;'}">${data.provider || ''}</span>`;
    const flowBadge = `<span class="flow-badge" style="${flowBadgeStyle}${data.flow ? '' : ' display:none;'}">${data.flow || ''}</span>`;

    sessionDiv.innerHTML = `
        <div class="session-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div class="res-title"
                    style="color: #38bdf8; font-size: 1.1em; font-weight: bold; word-break: break-all;"
                    title="Clicca sulla card per evidenziare la rotta sulla mappa">
                    ${data.resourceName || data.remoteIp}
                </div>
                <div class="subtitle-container"></div>
                <div style="color: #64748b; font-size: 0.75em; font-family: monospace;">
                    IP: ${data.remoteIp} ${countryBadge}${providerBadge}${flowBadge}
                </div>
            </div>
            <div class="bandwidth-meter" style="text-align: right; color: #10b981; font-weight: bold; font-family: monospace; font-size: 0.9em; min-width: 110px;">
                ${data.totalKB || 0} KB Tot.
            </div>
        </div>
        <div class="packets-container" style="height: 150px; overflow-y: auto; margin: 10px 0; border-top: 1px solid #334155; padding-top: 5px; font-size: 0.85em;"></div>
    `;

    // Caching riferimenti
    sessionDiv._titleDiv = sessionDiv.querySelector('.res-title');
    sessionDiv._subContainer = sessionDiv.querySelector('.subtitle-container');
    sessionDiv._meterEl = sessionDiv.querySelector('.bandwidth-meter');
    sessionDiv._containerEl = sessionDiv.querySelector('.packets-container');
    sessionDiv._providerBadgeEl = sessionDiv.querySelector('.provider-badge');
    sessionDiv._flowBadgeEl = sessionDiv.querySelector('.flow-badge');

    return sessionDiv;
}

/**
 * Aggiorna testo e visibilità di un badge (provider/flow) sulla card.
 */
function updateBadge(badgeEl, value) {
    if (!badgeEl) return;
    if (value) {
        badgeEl.textContent = value;
        badgeEl.style.display = '';
    } else {
        badgeEl.style.display = 'none';
    }
}

function updateCardHeader(sessionDiv, data) {
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

    sessionDiv.setAttribute('data-kb', data.totalKB || 0);
    if (sessionDiv._meterEl) {
        sessionDiv._meterEl.innerText = `${data.totalKB || 0} KB Tot.`;
    }

    updateBadge(sessionDiv._providerBadgeEl, data.provider);
    updateBadge(sessionDiv._flowBadgeEl, data.flow);
}

/**
 * Applica un aggiornamento provider arrivato in differita (evento 'provider_resolved')
 * a tutte le card già create per lo stesso IP remoto (più sessioni/porte possono condividerlo).
 */
function applyProviderUpdate(payload) {
    if (!payload || !payload.remoteIp) return;
    const targetIp = payload.remoteIp.toLowerCase();

    document.querySelectorAll(`.session-card[data-ip="${targetIp}"]`).forEach(sessionDiv => {
        sessionDiv.dataset.provider = (payload.provider || '').toLowerCase();
        updateBadge(sessionDiv._providerBadgeEl, payload.provider);
    });
}

// ================================================================================
// ORDINAMENTO CARD ED ELIMINAZIONE
// ================================================================================
function sortCardsByUsage() {
    if (sortThrottleTimeout) return;

    sortThrottleTimeout = setTimeout(() => {
        const targetDashboard = dashboard || document.getElementById('dashboard');
        if (!targetDashboard) {
            sortThrottleTimeout = null;
            return;
        }

        const cards = Array.from(targetDashboard.querySelectorAll('.session-card'));
        if (cards.length < 2) {
            sortThrottleTimeout = null;
            return;
        }

        let needsReorder = false;
        for (let i = 0; i < cards.length - 1; i++) {
            const kbA = parseFloat(cards[i].getAttribute('data-kb') || 0);
            const kbB = parseFloat(cards[i + 1].getAttribute('data-kb') || 0);
            if (kbA < kbB) {
                needsReorder = true;
                break;
            }
        }

        if (needsReorder) {
            cards.sort((a, b) => parseFloat(b.getAttribute('data-kb') || 0) - parseFloat(a.getAttribute('data-kb') || 0));
            cards.forEach(card => targetDashboard.appendChild(card));
        }

        sortThrottleTimeout = null;
    }, 1000);
}

function removeSessionCard(sessionId) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) sessionDiv.remove();
}

/**
 * Marca visivamente una sessione come chiusa (bordo rosso) o inattiva per timeout
 * (attenuata in grayscale, classe 'idle-card' — distinta da 'dimmed-card', riservata
 * all'evidenziazione mappa in mapHighlight.js: le due feature non devono condividere
 * la stessa classe, altrimenti evidenziare una rotta cancellerebbe questo stato).
 */
function markSessionClosed(sessionId, reason) {
    const sessionDiv = document.getElementById(sessionId);
    if (sessionDiv) {
        if (reason === 'Idle Timeout') {
            sessionDiv.classList.add('idle-card');
        } else {
            sessionDiv.classList.add('closed-card');
        }
    }
}

// ================================================================================
// EVENT LISTENERS DOM (accordion + click-to-focus sulla card)
// ================================================================================
document.addEventListener('DOMContentLoaded', () => {
    const toggleDashboardBtn = document.getElementById('toggle-dashboard-btn');
    const dashboardContainer = document.getElementById('dashboard');

    if (toggleDashboardBtn && dashboardContainer) {
        const btnText = toggleDashboardBtn.querySelector('.btn-text');
        const btnIcon = toggleDashboardBtn.querySelector('.btn-icon');

        toggleDashboardBtn.addEventListener('click', () => {
            const isCollapsed = dashboardContainer.classList.toggle('collapsed');
            if (btnText) btnText.textContent = isCollapsed ? 'Mostra' : 'Nascondi';
            if (btnIcon) btnIcon.textContent = isCollapsed ? '▼' : '▲';
        });
    }

    if (dashboardContainer) {
        dashboardContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.session-card');
            if (!card || window.getSelection().toString().length > 0) return;
            if (typeof window.focusLastHop === 'function') {
                window.focusLastHop(card.id);
            }
        });
    }
});
