/**
 * ====================================================================================
 * SERVIZIO DI TRACCIAMENTO PERCORSO DI RETE (traceroute.js)
 * ====================================================================================
 * 
 * SCOPO DEL MODULO:
 * Ricostruire il percorso geografico e gli intermediari di rete (router/hop) che un 
 * pacchetto attraversa dal tuo computer fino all'IP di destinazione finale.
 * 
 * FUNZIONAMENTO GENERALE:
 * 1. Esecuzione Multi-Piattaforma: Avvia in background un sotto-processo di sistema:
 *    - `tracert` su sistemi Windows
 *    - `traceroute` su sistemi Linux e macOS
 * 2. Streaming dell'Output: Legge in tempo reale l'output generato dal comando mentre
 *    vengono scoperti i vari nodi di rete.
 * 3. Filtraggio e Geolocalizzazione: Per ogni riga estrae gli IP validi, ignora gli IP
 *    locali o privati (es. 192.168.x.x) e geolocalizza i nodi pubblici tramite `geoip-lite`.
 * 4. Notifica WebSocket: Invia ogni hop identificato al frontend tramite Socket.io per 
 *    la tracciatura dinamica sulla mappa.
 * ====================================================================================
 */

const { exec } = require('child_process');
const geoip = require('geoip-lite');

// Registro globale per evitare l'esecuzione di traceroute duplicati ed essere sicuri
// di lanciare una sola analisi per ciascun IP di destinazione
const activeTraceroutes = new Set();

/**
 * Avvia ed esegue il comando traceroute del SO per un IP target
 * 
 * @param {string} targetIp - Indirizzo IP di destinazione da tracciare
 * @param {object} io - Istanza di Socket.io Server per emettere gli eventi in tempo reale
 */
function runNativeTraceroute(targetIp, io) {
    // PASSO 1: Blocco dei processi concorrenti sullo stesso IP
    if (activeTraceroutes.has(targetIp)) return;

    activeTraceroutes.add(targetIp);
    console.log(`[TRACEROUTE] Avviato traceroute nativo verso ${targetIp}`);
    
    // PASSO 2: Rilevamento del sistema operativo per definire il comando nativo adeguato
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `tracert -d -h 20 ${targetIp}` : `traceroute -n -m 20 ${targetIp}`;

    // Avvio del processo figlio di sistema in background
    const processStream = exec(command);
    let hopCount = 1;

    // PASSO 3: Lettura in streaming riga per riga durante la generazione dell'output
    processStream.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        
        for (let line of lines) {
            // Regex per catturare e isolare indirizzi IPv4 standard
            const ipRegex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/;
            const match = line.match(ipRegex);
            
            if (match) {
                const hopIp = match[0];
                
                // Ignoriamo la destinazione finale (già presente nelle card) e la rete locale
                if (hopIp === targetIp || hopIp.startsWith('192.168.') || hopIp.startsWith('192.168.1.1')) continue;
                
                // PASSO 4: Geolocalizzazione del nodo intermedio e identificazione automatica del Provider
                let hopProvider = null;
                const lowIp = hopIp.toLowerCase();
                if (lowIp.startsWith('20.') || lowIp.includes('microsoft')) hopProvider = 'Microsoft Azure';
                else if (lowIp.includes('amazonaws') || lowIp.includes('cloudfront')) hopProvider = 'Amazon AWS';
                else if (lowIp.includes('google') || lowIp.includes('1e100')) hopProvider = 'Google Cloud';
                else if (lowIp.includes('cloudflare')) hopProvider = 'Cloudflare';

                const geo = geoip.lookup(hopIp);
                if (geo && geo.ll) {
                    console.log(`[TRACEROUTE] Hop #${hopCount} Rilevato: ${hopIp} (${geo.city || geo.country})`);
                    
                    // Invio immediato del nodo alla mappa nella dashboard
                    io.emit('traceroute_hop', {
                        targetIp: targetIp,
                        hopNumber: hopCount,
                        ip: hopIp,
                        lat: geo.ll[0],
                        lon: geo.ll[1],
                        country: geo.country,
                        city: geo.city || 'Nodo di Rete',
                        provider: hopProvider
                    });
                    hopCount++;
                }
            }
        }
    });

    // PASSO 5: Chiusura e pulizia delle risorse al termine dell'analisi
    processStream.on('close', () => {
        console.log(`[TRACEROUTE] Concluso per ${targetIp}`);
        activeTraceroutes.delete(targetIp);
    });
}

module.exports = {
    runNativeTraceroute
};