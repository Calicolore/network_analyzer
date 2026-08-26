/**
 * ====================================================================================
 * RENDERING ROTTE E MARKER SULLA MAPPA LIVE (dashboard/mapRoutes.js)
 * ====================================================================================
 * Disegna/aggiorna le rotte del traffico live (linee curve, marker sorgente/destinazione,
 * hop di traceroute) sul layer group condiviso dichiarato in mapCore.js, e centra la
 * mappa aprendo il popup di un nodo. Espone anche pausa/ripresa del traffico live,
 * usate quando l'utente passa alla visualizzazione di un DB importato.
 * Dipende da: mapCore.js (map, liveLayerGroup, activeMarkers, sessionRoutes, homeCoords,
 * currentlyHighlightedSessionId, HIGHLIGHT_COLOR), mapPopup.js (getHopPopupHTML).
 * ====================================================================================
 */

/**
 * Disegna la linea curva con un'hitbox d'interazione reattiva.
 *
 * @param {[number, number]} start - Coordinate [lat, lon] di partenza
 * @param {[number, number]} end - Coordinate [lat, lon] di arrivo
 * @param {string} color - Colore della linea (e della sessione)
 * @param {string} sessionId - Sessione a cui appartiene questa linea (per click/highlight)
 * @returns {L.Polyline} La linea visibile creata (l'hitbox invisibile è in `._hitbox`)
 */
function drawCurveLine(start, end, color, sessionId) {
    const latlngs = [];
    const offsetX = (start[0] + end[0]) / 2;
    const offsetY = (start[1] + end[1]) / 2;

    const curvature = 0.15;
    const controlPoint = [
        offsetX + (end[1] - start[1]) * curvature,
        offsetY - (end[0] - start[0]) * curvature
    ];

    for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const lat = (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * controlPoint[0] + t * t * end[0];
        const lng = (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * controlPoint[1] + t * t * end[1];
        latlngs.push([lat, lng]);
    }

    // Gestore del click: Evidenzia e apre il popup dell'ultimo hop
    const onLineClick = (e) => {
        L.DomEvent.stopPropagation(e);

        // Se non è già la sessione evidenziata, la evidenzia
        if (currentlyHighlightedSessionId !== sessionId) {
            window.highlightSession(sessionId);
        }

        // Apre il popup dell'ultimo hop di questa rotta, centrando la mappa sul punto+popup
        const route = sessionRoutes.get(sessionId);
        if (route && route.hopMarkers.length > 0) {
            const lastMarker = route.hopMarkers[route.hopMarkers.length - 1];
            centerAndOpenPopup(lastMarker);
        }
    };

    // 1. Linea visibile
    const visibleLine = L.polyline(latlngs, {
        color: color,
        weight: 3,
        opacity: 0.8,
        smoothFactor: 1,
        interactive: true
    }).addTo(liveLayerGroup);

    // 2. Hitbox invisibile per facilitare il click
    const invisibleHitbox = L.polyline(latlngs, {
        color: '#000000',
        weight: 35,
        opacity: 0,
        interactive: true,
        pane: 'hitboxPane',
        bubblingMouseEvents: false
    }).addTo(liveLayerGroup);

    // Collega gli eventi
    [visibleLine, invisibleHitbox].forEach(line => {
        line.on('click', onLineClick);
        line.on('mouseover', () => {
            document.getElementById('map').style.cursor = 'pointer';
        });
        line.on('mouseout', () => {
            document.getElementById('map').style.cursor = '';
        });
    });

    visibleLine._hitbox = invisibleHitbox;
    return visibleLine;
}

/**
 * ====================================================================================
 * CENTRATURA MAPPA + APERTURA POPUP
 * ====================================================================================
 * Un semplice map.setView() centra il PUNTO geografico esattamente al centro del
 * riquadro mappa — ma il popup si apre SOPRA il marker, quindi il punto finisce
 * comunque vicino al bordo inferiore (o Leaflet lo sposta lì di sua iniziativa tramite
 * l'autoPan integrato del popup, che qui teniamo disattivato per evitare conflitti).
 *
 * Questa funzione centra prima il punto, poi — una volta che il popup è realmente
 * renderizzato nel DOM (quindi ne conosciamo l'altezza vera) — sposta la vista verso
 * il basso di metà dell'altezza del popup, così l'INSIEME punto+popup risulta
 * visivamente centrato nel riquadro, invece di stare sui bordi o di lato.
 *
 * @param {L.CircleMarker} marker - Marker il cui popup va aperto
 * @param {number} [zoomLevel] - Livello di zoom target; se omesso resta quello attuale
 */
function centerAndOpenPopup(marker, zoomLevel) {
    if (!marker) return;

    const targetZoom = (zoomLevel !== undefined && zoomLevel !== null) ? zoomLevel : map.getZoom();
    const targetLatLng = marker.getLatLng();

    function openAndRebalance() {
        marker.openPopup();

        // Aspettiamo un istante che il popup sia nel DOM per leggerne l'altezza reale
        setTimeout(() => {
            const popupEl = marker.getPopup() && marker.getPopup().getElement();
            const popupHeight = popupEl ? popupEl.offsetHeight : 140;

            if (popupHeight > 20) {
                /**
                 * panBy con Y negativo sposta il CONTENUTO verso l'alto, cioè il punto
                 * scende nel riquadro, lasciando sopra lo spazio occupato dal popup.
                 */
                map.panBy([0, -(popupHeight / 2)], { animate: true });
            }
        }, 50);
    }

    map.once('moveend', openAndRebalance);
    map.setView(targetLatLng, targetZoom, { animate: true, duration: 0.8 });

    // Fallback: se la mappa era già centrata lì, 'moveend' potrebbe non scattare
    setTimeout(() => {
        map.off('moveend', openAndRebalance);
        if (!marker.isPopupOpen()) openAndRebalance();
    }, 900);
}

/**
 * Crea un marker circolare sulla mappa, cliccabile per evidenziare/centrare la sessione.
 *
 * @param {[number, number]} latLng - Coordinate [lat, lon] del marker
 * @param {string} color - Colore di riempimento (colore della sessione)
 * @param {boolean} [isFinal] - true se è il marker di destinazione (più grande, bordo bianco)
 * @param {boolean} [isSource] - true se è il marker sorgente (leggermente più grande dei transiti)
 * @param {string} [sessionId] - Sessione associata; se presente, il marker diventa cliccabile
 * @returns {L.CircleMarker} Il marker creato
 */
function createCustomMarker(latLng, color, isFinal = false, isSource = false, sessionId = '') {
    const marker = L.circleMarker(latLng, {
        radius: isFinal ? 8 : (isSource ? 6 : 4),
        color: isFinal ? '#ffffff' : color,
        weight: isFinal ? 3 : 1.5,
        fillColor: color,
        fillOpacity: isFinal ? 1 : 0.8,
        interactive: true,
        isFinal: isFinal,
        isSource: isSource
    }).addTo(liveLayerGroup);

    if (sessionId) {
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);

            // Evidenzia la sessione se non lo è già
            if (currentlyHighlightedSessionId !== sessionId) {
                window.highlightSession(sessionId);
            }

            // Centra la mappa sul marker e apre il popup
            centerAndOpenPopup(marker);
        });
    }

    return marker;
}

/**
 * Crea la rotta (sorgente->destinazione) alla prima ricezione di una sessione, oppure
 * aggiorna il popup di destinazione già esistente con i dati più recenti del pacchetto.
 *
 * @param {object} data - Pacchetto arricchito ricevuto dal server (sessionId, lat, lon,
 *   remoteIp, resourceName, technicalSubtitle, provider, sessionColor, remotePort, ...)
 */
function updateMapPacket(data) {
    if (!data.lat || !data.lon) return;

    if (!sessionRoutes.has(data.sessionId)) {
        sessionRoutes.set(data.sessionId, {
            color: data.sessionColor,
            points: [homeCoords, [data.lat, data.lon]],
            lines: [],
            hopMarkers: [],
            ips: ['Localhost', data.remoteIp],
            cities: ['Sorgente', data.resourceName],
            subtitle: data.technicalSubtitle || '',
            provider: data.provider || null,
            providers: [null, data.provider || null]
        });

        const route = sessionRoutes.get(data.sessionId);

        const isAnotherHighlighted = currentlyHighlightedSessionId && (currentlyHighlightedSessionId !== data.sessionId);

        const startMarker = createCustomMarker(homeCoords, data.sessionColor, false, true, data.sessionId);
        startMarker.bindPopup(getHopPopupHTML(data.sessionId, 0, 2, 'Localhost', 'Sorgente', data.remotePort, ''), { autoPan: false });
        route.hopMarkers.push(startMarker);

        const line = drawCurveLine(homeCoords, [data.lat, data.lon], data.sessionColor, data.sessionId);
        route.lines.push(line);

        const finalMarker = createCustomMarker([data.lat, data.lon], data.sessionColor, true, false, data.sessionId);
        finalMarker.bindPopup(getHopPopupHTML(data.sessionId, 1, 2, data.remoteIp, data.resourceName, data.remotePort, data.technicalSubtitle, data.provider), { autoPan: false });

        route.hopMarkers.push(finalMarker);
        activeMarkers.set(data.sessionId, finalMarker);

        if (isAnotherHighlighted) {
            line.setStyle({
                color: route.color,
                opacity: 0.15,
                weight: 1.5
            });

            startMarker.setStyle({
                fillOpacity: 0.15,
                weight: 1.5,
                radius: 6
            });

            finalMarker.setStyle({
                fillOpacity: 0.15,
                weight: 1.5,
                radius: 8
            });
        }
    } else if (activeMarkers.has(data.sessionId)) {
        const finalMarker = activeMarkers.get(data.sessionId);
        const route = sessionRoutes.get(data.sessionId);
        if (route) {
            route.cities[route.cities.length - 1] = data.resourceName;
            route.subtitle = data.technicalSubtitle || '';
            route.provider = data.provider || null;
            if (route.providers) route.providers[route.providers.length - 1] = data.provider || null;

            finalMarker.setPopupContent(getHopPopupHTML(data.sessionId, route.points.length - 1, route.points.length, data.remoteIp, data.resourceName, data.remotePort, data.technicalSubtitle, data.provider));
        }
    }
}

/**
 * Inserisce un nuovo hop intermedio scoperto dal traceroute nella rotta della sessione
 * corrispondente, ridisegnando l'intera catena di marker/linee tra sorgente e destinazione.
 *
 * @param {object} data - Hop di traceroute (targetIp, lat, lon, ip, provider, ...)
 */
function updateMapTraceroute(data) {
    for (const [sessionId, route] of sessionRoutes.entries()) {
        const remoteIpOfSession = sessionId.split(':')[0];

        if (remoteIpOfSession === data.targetIp) {
            const hopLatLng = [data.lat, data.lon];

            if (route.points.some(p => p[0] === hopLatLng[0] && p[1] === hopLatLng[1])) return;

            route.lines.forEach(l => {
                if (l._hitbox) liveLayerGroup.removeLayer(l._hitbox);
                liveLayerGroup.removeLayer(l);
            });
            route.hopMarkers.forEach(m => liveLayerGroup.removeLayer(m));
            route.lines = [];
            route.hopMarkers = [];

            route.points.splice(route.points.length - 1, 0, hopLatLng);
            route.ips.splice(route.ips.length - 1, 0, data.ip);
            route.cities.splice(route.cities.length - 1, 0, route.cities[route.cities.length - 1]);

            if (!route.providers) {
                route.providers = [null, route.provider || null];
            }
            route.providers.splice(route.providers.length - 1, 0, data.provider || null);

            const extractedPort = sessionId.split(':')[1] || '';
            const isTargetSession = (currentlyHighlightedSessionId === sessionId);
            const isAnotherHighlighted = currentlyHighlightedSessionId && !isTargetSession;

            for (let i = 0; i < route.points.length; i++) {
                const currentPoint = route.points[i];
                const isLast = (i === route.points.length - 1);
                const isFirst = (i === 0);

                const marker = createCustomMarker(currentPoint, route.color, isLast, isFirst, sessionId);
                const currentSubtitle = isLast ? route.subtitle : `Nodo di transito per ${route.cities[i]}`;
                const currentProvider = route.providers ? route.providers[i] : null;

                marker.bindPopup(getHopPopupHTML(sessionId, i, route.points.length, route.ips[i], route.cities[i], extractedPort, currentSubtitle, currentProvider), { autoPan: false });

                if (isAnotherHighlighted) {
                    marker.setStyle({
                        color: isLast ? '#ffffff' : route.color,
                        fillColor: route.color,
                        fillOpacity: 0.15,
                        weight: isLast ? 3 : 1.5,
                        radius: isLast ? 8 : (isFirst ? 6 : 4)
                    });
                } else if (isTargetSession) {
                    marker.setStyle({
                        color: '#ffffff',
                        fillColor: HIGHLIGHT_COLOR,
                        fillOpacity: 1.0,
                        weight: isLast ? 3.5 : 1.5,
                        radius: isLast ? 9 : 6
                    });
                }

                route.hopMarkers.push(marker);

                if (i < route.points.length - 1) {
                    const nextPoint = route.points[i + 1];
                    const curve = drawCurveLine(currentPoint, nextPoint, route.color, sessionId);

                    if (isAnotherHighlighted) {
                        curve.setStyle({
                            color: route.color,
                            opacity: 0.15,
                            weight: 1.5
                        });
                    } else if (isTargetSession) {
                        curve.setStyle({
                            color: HIGHLIGHT_COLOR,
                            opacity: 1.0,
                            weight: 4.5
                        });
                    }

                    route.lines.push(curve);
                }
            }
            break;
        }
    }
}

/**
 * Rimuove dalla mappa tutti gli elementi (linee, hitbox, marker) di una sessione chiusa.
 *
 * @param {string} sessionId - Sessione da rimuovere
 */
function removeSessionFromMap(sessionId) {
    if (currentlyHighlightedSessionId === sessionId) {
        window.clearHighlight();
    }
    const route = sessionRoutes.get(sessionId);
    if (route) {
        route.lines.forEach(line => {
            if (line._hitbox) liveLayerGroup.removeLayer(line._hitbox); // Rimuove l'hitbox associata
            liveLayerGroup.removeLayer(line);
        });
        route.hopMarkers.forEach(marker => liveLayerGroup.removeLayer(marker));
        sessionRoutes.delete(sessionId);
    }
    activeMarkers.delete(sessionId);
}

/**
 * ====================================================================================
 * PAUSA / RIPRESA DEL TRAFFICO LIVE (per la modalità "DB Importato")
 * ====================================================================================
 * Staccare/riattaccare l'intero layerGroup NON distrugge nulla: sessionRoutes e
 * activeMarkers restano invariati in memoria. Il ripristino al ritorno da un DB
 * importato è quindi istantaneo e pixel-identico a come si trovava prima della pausa,
 * senza bisogno di richiedere nulla al server.
 */
function pauseLiveTraffic() {
    if (map.hasLayer(liveLayerGroup)) {
        map.removeLayer(liveLayerGroup);
        console.log('[MAPPA] Traffico live nascosto (DB importato attivo).');
    }
}

function resumeLiveTraffic() {
    if (!map.hasLayer(liveLayerGroup)) {
        map.addLayer(liveLayerGroup);
        console.log('[MAPPA] Traffico live ripristinato.');
    }
}

window.MapManager = window.MapManager || {};
window.MapManager.pauseLiveTraffic = pauseLiveTraffic;
window.MapManager.resumeLiveTraffic = resumeLiveTraffic;
