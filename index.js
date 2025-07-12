require('dotenv').config();
const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const AdmZip = require('adm-zip');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 7000;
const SUB_DIR = path.join(__dirname, 'subs');
if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR);

// Získání IP adresy pro lokální síť
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
// Použij BASE_URL pokud je nastavena, jinak lokální IP
const BASE_URL = process.env.BASE_URL || `http://${LOCAL_IP}:${PORT}`;

const app = express();

// Přidej cache-busting hlavičky
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.use('/sub', express.static(SUB_DIR));

app.listen(PORT, () => {
  console.log(`Express server běží na portu ${PORT}`);
  console.log(`Lokální adresa: http://${LOCAL_IP}:${PORT}`);
  console.log(`Addon URL: ${BASE_URL}/manifest.json`);
  
  if (process.env.BASE_URL) {
    console.log(`🌐 Používám externí URL: ${process.env.BASE_URL}`);
  } else {
    console.log(`⚠️  Používám lokální URL - nastavte BASE_URL proměnnou`);
  }
});

app.get('/', (req, res) => { 
  res.send(`
    <h1>Titulky.cz Addon</h1>
    <p>Server běží na portu: ${PORT}</p>
    <p>Lokální adresa: http://${LOCAL_IP}:${PORT}</p>
    <p>Addon URL: <a href="${BASE_URL}/manifest.json">${BASE_URL}/manifest.json</a></p>
    ${process.env.BASE_URL ? `<p>🌐 Externí URL: ${process.env.BASE_URL}</p>` : '<p>⚠️ Nastavte BASE_URL proměnnou</p>'}
  `); 
});

const manifest = {
  "id": "cz.titulky.railwayaddon",
  "version": "1.3.0",
  "name": "Titulky.cz Railway",
  "description": "Tahá a rozbaluje české titulky z titulky.cz",
  "resources": ["subtitles"],
  "types": ["movie", "series"],
  "idPrefixes": ["tt"],
  "catalogs": []
};

const builder = new addonBuilder(manifest);

// Funkce pro normalizaci názvu filmu pro hledání
function normalizeTitle(title) {
  return title
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Funkce pro hledání download linku s více variantami
function findDownloadLink($) {
  const selectors = [
    '#download a',
    'a[href*="download"]',
    '.download-link',
    'a:contains("Stáhnout")',
    'a[href*="zip"]'
  ];
  
  for (const selector of selectors) {
    const link = $(selector).attr('href');
    if (link) return link;
  }
  return null;
}

// Funkce pro hledání titulků na stránce
function findSubtitleLinks($) {
  const links = [];
  
  const selectors = [
    '.main-table tr a',
    '.table tr a',
    'a[href*="id="]',
    'a[href*="detail"]'
  ];
  
  selectors.forEach(selector => {
    $(selector).each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('id=')) {
        links.push(href);
      }
    });
  });
  
  return links;
}

builder.defineSubtitlesHandler(async ({ id }) => {
  const imdbId = id;

  try {
    console.log(`🔍 Zpracovávám požadavek pro: ${imdbId}`);
    
    const omdbResp = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`, {
      timeout: 10000
    });
    const movie = omdbResp.data;

    if (!movie || !movie.Title) {
      throw new Error('Film nenalezen v OMDb');
    }

    console.log(`📽️  Film: ${movie.Title} (${movie.Year})`);

    const normalizedTitle = normalizeTitle(movie.Title);
    const searchQuery = encodeURIComponent(`${normalizedTitle} ${movie.Year}`);
    const searchUrl = `https://www.titulky.cz/?Fulltext=${searchQuery}`;

    console.log(`🔍 Hledám na: ${searchUrl}`);

    const response = await axios.get(searchUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const subtitleLinks = findSubtitleLinks($);
    
    if (subtitleLinks.length === 0) {
      throw new Error('Nenalezeny žádné titulky');
    }

    const firstLink = subtitleLinks[0];
    const detailUrl = firstLink.startsWith('http') ? firstLink : `https://www.titulky.cz${firstLink}`;
    
    console.log(`📄 Načítám detail: ${detailUrl}`);

    const detailResp = await axios.get(detailUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    const $$ = cheerio.load(detailResp.data);
    const downloadHref = findDownloadLink($$);
    
    if (!downloadHref) {
      throw new Error('Download link not found');
    }

    const downloadUrl = downloadHref.startsWith('http') ? downloadHref : `https://www.titulky.cz${downloadHref}`;
    console.log(`⬇️  Stahuji: ${downloadUrl}`);

    const zipResp = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 30000
    });

    const zip = new AdmZip(zipResp.data);
    const entries = zip.getEntries();
    const srtEntry = entries.find(e => 
      e.entryName.toLowerCase().endsWith('.srt') || 
      e.entryName.toLowerCase().endsWith('.sub')
    );
    
    if (!srtEntry) {
      throw new Error('Žádný .srt soubor v ZIPu');
    }

    const filename = `${id.replace(/[^a-zA-Z0-9]/g, '_')}.srt`;
    const filepath = path.join(SUB_DIR, filename);
    
    fs.writeFileSync(filepath, srtEntry.getData(), 'utf8');

    console.log(`✅ Titulky uloženy: ${filename}`);

    return {
      subtitles: [{
        id: 'cs-titulkycz',
        lang: 'cs',
        label: 'Titulky.cz (Railway)',
        url: `${BASE_URL}/sub/${filename}`
      }]
    };

  } catch (err) {
    console.error(`❌ Chyba pro ${imdbId}:`, err.message);
    return { subtitles: [] };
  }
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(manifest);
});

module.exports = builder.getInterface();
