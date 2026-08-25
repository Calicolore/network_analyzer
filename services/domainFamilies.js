/**
 * ====================================================================================
 * TABELLA FAMIGLIE DI DOMINIO (services/domainFamilies.js)
 * ====================================================================================
 * Elenco curato di domini "satellite" (CDN, sotto-servizi, infrastrutture) associati
 * al brand/sito principale a cui appartengono. Usata per:
 * 1) normalizzare il nome mostrato (campo `target`, es. twimg.com -> x.com)
 * 2) raggruppare in UI le connessioni correlate allo stesso sito (campo `family`)
 * `target: null` indica un'infrastruttura CDN pura, senza un brand "sito" da forzare,
 * che comunque partecipa al raggruppamento tramite `family`.
 * ====================================================================================
 */

const DOMAIN_FAMILIES = [
    // --- Google / Alphabet ---
    { pattern: 'google.com', family: 'google', target: 'google.com' },
    { pattern: 'googleapis.com', family: 'google', target: 'google.com' },
    { pattern: 'gstatic.com', family: 'google', target: 'google.com' },
    { pattern: 'googlesyndication.com', family: 'google', target: 'google.com' },
    { pattern: 'doubleclick.net', family: 'google', target: 'google.com' },
    { pattern: 'gvt1.com', family: 'google', target: 'google.com' },
    { pattern: 'gvt2.com', family: 'google', target: 'google.com' },
    { pattern: '1e100.net', family: 'google', target: 'google.com' },
    { pattern: 'googleusercontent.com', family: 'google', target: 'google.com' },
    { pattern: 'googlevideo.com', family: 'google', target: 'youtube.com' },
    { pattern: 'ytimg.com', family: 'google', target: 'youtube.com' },
    { pattern: 'ggpht.com', family: 'google', target: 'youtube.com' },
    { pattern: 'youtube.com', family: 'google', target: 'youtube.com' },

    // --- Meta / Facebook / Instagram / WhatsApp ---
    { pattern: 'facebook.com', family: 'meta', target: 'facebook.com' },
    { pattern: 'fbcdn.net', family: 'meta', target: 'facebook.com' },
    { pattern: 'fbsbx.com', family: 'meta', target: 'facebook.com' },
    { pattern: 'instagram.com', family: 'meta', target: 'instagram.com' },
    { pattern: 'cdninstagram.com', family: 'meta', target: 'instagram.com' },
    { pattern: 'whatsapp.com', family: 'meta', target: 'whatsapp.com' },
    { pattern: 'whatsapp.net', family: 'meta', target: 'whatsapp.com' },

    // --- X / Twitter ---
    { pattern: 'twimg.com', family: 'x', target: 'x.com' },
    { pattern: 't.co', family: 'x', target: 'x.com' },
    { pattern: 'twitter.com', family: 'x', target: 'x.com' },
    { pattern: 'x.com', family: 'x', target: 'x.com' },

    // --- Amazon ---
    { pattern: 'amazon.com', family: 'amazon', target: 'amazon.com' },
    { pattern: 'amazon.it', family: 'amazon', target: 'amazon.com' },
    { pattern: 'media-amazon.com', family: 'amazon', target: 'amazon.com' },
    { pattern: 'ssl-images-amazon.com', family: 'amazon', target: 'amazon.com' },
    { pattern: 'amazonaws.com', family: 'amazon-aws', target: null },
    { pattern: 'cloudfront.net', family: 'amazon-aws', target: null },

    // --- Microsoft ---
    { pattern: 'microsoft.com', family: 'microsoft', target: 'microsoft.com' },
    { pattern: 'live.com', family: 'microsoft', target: 'microsoft.com' },
    { pattern: 'office.com', family: 'microsoft', target: 'office.com' },
    { pattern: 'office365.com', family: 'microsoft', target: 'office.com' },
    { pattern: 'msftconnecttest.com', family: 'microsoft', target: 'microsoft.com' },
    { pattern: 'msn.com', family: 'microsoft', target: 'microsoft.com' },
    { pattern: 'windowsupdate.com', family: 'microsoft', target: 'microsoft.com' },
    { pattern: 'azureedge.net', family: 'microsoft-azure', target: null },
    { pattern: 'windows.net', family: 'microsoft-azure', target: null },
    { pattern: 'github.com', family: 'github', target: 'github.com' },
    { pattern: 'github.io', family: 'github', target: 'github.com' },
    { pattern: 'githubusercontent.com', family: 'github', target: 'github.com' },
    { pattern: 'githubassets.com', family: 'github', target: 'github.com' },

    // --- Infrastrutture CDN pure ---
    { pattern: 'cloudflare.com', family: 'cloudflare', target: null },
    { pattern: 'cloudflare-dns.com', family: 'cloudflare', target: null },
    { pattern: 'cloudflareinsights.com', family: 'cloudflare', target: null },
    { pattern: 'fastly.net', family: 'fastly', target: null },
    { pattern: 'akamai.net', family: 'akamai', target: null },
    { pattern: 'akamaiedge.net', family: 'akamai', target: null },
    { pattern: 'akamaihd.net', family: 'akamai', target: null },
    { pattern: 'akamaitechnologies.com', family: 'akamai', target: null },

    // --- Altri servizi comuni ---
    { pattern: 'netflix.com', family: 'netflix', target: 'netflix.com' },
    { pattern: 'nflxvideo.net', family: 'netflix', target: 'netflix.com' },
    { pattern: 'nflximg.net', family: 'netflix', target: 'netflix.com' },
    { pattern: 'spotify.com', family: 'spotify', target: 'spotify.com' },
    { pattern: 'scdn.co', family: 'spotify', target: 'spotify.com' },
    { pattern: 'tiktok.com', family: 'tiktok', target: 'tiktok.com' },
    { pattern: 'tiktokcdn.com', family: 'tiktok', target: 'tiktok.com' },
    { pattern: 'tiktokv.com', family: 'tiktok', target: 'tiktok.com' },
    { pattern: 'byteoversea.com', family: 'tiktok', target: 'tiktok.com' },
    { pattern: 'linkedin.com', family: 'linkedin', target: 'linkedin.com' },
    { pattern: 'licdn.com', family: 'linkedin', target: 'linkedin.com' },
    { pattern: 'reddit.com', family: 'reddit', target: 'reddit.com' },
    { pattern: 'redditstatic.com', family: 'reddit', target: 'reddit.com' },
    { pattern: 'redditmedia.com', family: 'reddit', target: 'reddit.com' },
    { pattern: 'apple.com', family: 'apple', target: 'apple.com' },
    { pattern: 'icloud.com', family: 'apple', target: 'apple.com' },
    { pattern: 'mzstatic.com', family: 'apple', target: 'apple.com' },
    { pattern: 'discord.com', family: 'discord', target: 'discord.com' },
    { pattern: 'discordapp.com', family: 'discord', target: 'discord.com' },
    { pattern: 'discordapp.net', family: 'discord', target: 'discord.com' },
    { pattern: 'steamcontent.com', family: 'steam', target: 'steampowered.com' },
    { pattern: 'steampowered.com', family: 'steam', target: 'steampowered.com' },
    { pattern: 'steamstatic.com', family: 'steam', target: 'steampowered.com' },
];

/**
 * Cerca la prima voce della tabella il cui pattern è contenuto nel dominio dato.
 */
function findFamilyEntry(domain) {
    if (!domain) return null;
    const d = domain.toLowerCase();
    return DOMAIN_FAMILIES.find(entry => d.includes(entry.pattern)) || null;
}

module.exports = { DOMAIN_FAMILIES, findFamilyEntry };
