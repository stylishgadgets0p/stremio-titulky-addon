require('dotenv').config();
const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const AdmZip = require('adm-zip');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Konfigurace
const PORT = process.env.PORT || 7000;
const OMDB_API_KEY = process.env.OMDB_API_KEY || 'your_api_key_here';

// Získání lokální IP adresy
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
const BASE_URL = process.env.BASE_URL || `http://${LOCAL_IP}:${PORT}`;

// Vytvoření složky pro titulky
const subsDir = path.join(__dirname, 'subs');
if (!fs.existsSync(subsDir)) {
  fs.mkdirSync(subsDir);
}

// Definice manifestu addonu
const manifest = {
  id: 'titulky.com.subtitles',
  version: '1.4.0',
  name: 'Titulky.com Czech/Slovak Subtitles',
  description: 'Stahuje a rozbaluje české a slovenské titulky z titulky.com',
  logo: `${BASE_URL}/logo.png`,
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: []
};

// Funkce pro čištění názvu filmu pro vyhledávání
function cleanTitle(title) {
  return title
    .replace(/[^\w\s]/g, ' ')  // Nahradit speciální znaky mezerami
    .replace(/\s+/g, ' ')      // Více mezer nahradit jednou
    .trim()
    .toLowerCase();
}

// Funkce pro získání informací o filmu z OMDB
async function getMovieInfo(imdbId) {
  try {
    const response = await axios.get(`http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
    return response.data;
  } catch (error) {
    console.error('Chyba při získávání dat z OMDB:', error.message);
    return null;
  }
}

// Funkce pro vyhledávání titulků na titulky.com
async function searchTitulkycom(title, year) {
  try {
    console.log(`🔍 Hledám titulky pro: "${title}" (${year})`);
    
    // Pokus o vyhledávání - titulky.com má vyhledávací formulář
    const searchUrl = 'https://www.titulky.com/';
    
    // Prvního pokusu - hlavní stránka s vyhledáváním
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    
    // Hledání odkazů na titulky v struktuře titulky.com
    const subtitleLinks = [];
    
    // Titulky.com má různé struktury - zkusím najít odkazy na filmy
    $('a[href*=".htm"]').each((i, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
      // Kontrola, jestli odkaz obsahuje název filmu
      if (text && href && text.toLowerCase().includes(title.toLowerCase())) {
        const fullUrl = href.startsWith('http') ? href : `https://www.titulky.com${href}`;
        subtitleLinks.push({
          title: text,
          url: fullUrl
        });
      }
    });

    console.log(`📋 Nalezeno ${subtitleLinks.length} potenciálních odkazů`);
    return subtitleLinks;

  } catch (error) {
    console.error('❌ Chyba při vyhledávání na titulky.com:', error.message);
    return [];
  }
}

// Funkce pro získání downloadovacích odkazů z detailní stránky
async function getDownloadLinks(pageUrl) {
  try {
    console.log(`🔗 Získávám download odkazy z: ${pageUrl}`);
    
    const response = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const downloadLinks = [];

    // Hledání download odkazů - titulky.com má specifickou strukturu
    $('a[href*="download"], a[href*=".zip"], a[href*=".rar"], a[href*=".srt"]').each((i, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `https://www.titulky.com${href}`;
        downloadLinks.push({
          title: text || 'Stáhnout titulky',
          url: fullUrl
        });
      }
    });

    console.log(`⬇️ Nalezeno ${downloadLinks.length} download odkazů`);
    return downloadLinks;

  } catch (error) {
    console.error('❌ Chyba při získávání download odkazů:', error.message);
    return [];
  }
}

// Funkce pro stažení a rozbalení titulků
async function downloadAndExtractSubtitles(downloadUrl, movieTitle) {
  try {
    console.log(`⬇️ Stahuji titulky z: ${downloadUrl}`);
    
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    const fileName = `${cleanTitle(movieTitle)}_${Date.now()}`;
    
    // Zkusím různé přípony podle Content-Type
    let fileExtension = '.zip';
    const contentType = response.headers['content-type'];
    if (contentType) {
      if (contentType.includes('rar')) fileExtension = '.rar';
      else if (contentType.includes('text')) fileExtension = '.srt';
    }

    const filePath = path.join(subsDir, fileName + fileExtension);
    fs.writeFileSync(filePath, response.data);

    console.log(`💾 Soubor uložen: ${filePath}`);

    // Pokus o rozbalení, pokud je to archiv
    if (fileExtension === '.zip') {
      try {
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        
        for (const entry of zipEntries) {
          if (entry.entryName.endsWith('.srt') || entry.entryName.endsWith('.sub')) {
            const extractPath = path.join(subsDir, `${fileName}_${entry.entryName}`);
            fs.writeFileSync(extractPath, entry.getData());
            console.log(`📂 Rozbalen soubor: ${extractPath}`);
            
            return `${BASE_URL}/subtitles/${fileName}_${entry.entryName}`;
          }
        }
      } catch (zipError) {
        console.log('⚠️ Soubor není ZIP archiv, zkouším jako SRT');
      }
    }

    // Pokud to není archiv nebo rozbalení selhalo, vrátím původní soubor
    const finalPath = path.join(subsDir, fileName + '.srt');
    fs.renameSync(filePath, finalPath);
    return `${BASE_URL}/subtitles/${fileName}.srt`;

  } catch (error) {
    console.error('❌ Chyba při stahování titulků:', error.message);
    throw error;
  }
}

// Hlavní funkce pro získání titulků
async function getSubtitles(type, id) {
  try {
    console.log(`🎬 Zpracovávám ${type} s ID: ${id}`);
    
    // Získání informací o filmu z OMDB
    const movieInfo = await getMovieInfo(id);
    if (!movieInfo || movieInfo.Response === 'False') {
      console.log('❌ Film nenalezen v OMDB');
      return [];
    }

    console.log(`🎭 Nalezen film: ${movieInfo.Title} (${movieInfo.Year})`);

    // Vyhledání titulků na titulky.com
    const searchResults = await searchTitulkycom(movieInfo.Title, movieInfo.Year);
    
    if (searchResults.length === 0) {
      console.log('❌ Žádné titulky nenalezeny');
      return [];
    }

    const subtitles = [];

    // Zpracování prvních několika výsledků
    for (let i = 0; i < Math.min(searchResults.length, 3); i++) {
      const result = searchResults[i];
      
      try {
        // Získání download odkazů z detailní stránky
        const downloadLinks = await getDownloadLinks(result.url);
        
        if (downloadLinks.length > 0) {
          // Pokus o stažení prvního odkazu
          const downloadUrl = await downloadAndExtractSubtitles(
            downloadLinks[0].url, 
            movieInfo.Title
          );
          
          subtitles.push({
            id: `titulkycom_${Date.now()}_${i}`,
            url: downloadUrl,
            lang: 'cze'
          });
          
          console.log(`✅ Titulky úspěšně přidány: ${result.title}`);
        }
      } catch (error) {
        console.error(`❌ Chyba při zpracování: ${result.title}`, error.message);
        continue;
      }
    }

    return subtitles;

  } catch (error) {
    console.error('❌ Celková chyba při získávání titulků:', error.message);
    return [];
  }
}

// Vytvoření addon builderu
const builder = addonBuilder(manifest);

// Definice subtitles handleru
builder.defineSubtitlesHandler(async ({ type, id }) => {
  console.log(`📥 Požadavek na titulky: ${type}/${id}`);
  
  try {
    const subtitles = await getSubtitles(type, id);
    return { subtitles };
  } catch (error) {
    console.error('❌ Chyba v subtitles handleru:', error.message);
    return { subtitles: [] };
  }
});

// Express server pro serving souborů
const app = express();

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Cache-busting hlavičky
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});

// Middleware pro statické soubory
app.use('/subtitles', express.static(subsDir));

// Základní route
app.get('/', (req, res) => {
  res.send('Titulky.com addon je spuštěn!');
});

// Manifest endpoint
app.get('/manifest.json', (req, res) => {
  console.log('📋 Manifest požadavek');
  res.json(manifest);
});

// Subtitles endpoint
// Zkus všechny možné cesty
app.get('/subtitles/*/*', async (req, res) => {
  const [type, id] = req.url.split('/').slice(2);
  console.log(`🔥 DEBUG: URL=${req.url}, type=${type}, id=${id}`);
  
  try {
    const subtitles = await getSubtitles(type, id);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ Chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Logo endpoint
app.get('/logo.png', (req, res) => {
  const logoSvg = `
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#1a1a1a"/>
      <text x="100" y="120" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
        Titulky.com
      </text>
    </svg>
  `;
  
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(logoSvg);
});

// Spuštění serveru
app.listen(PORT, () => {
  console.log(`🚀 Express server běží na portu ${PORT}`);
  console.log(`🌐 Lokální adresa: http://${LOCAL_IP}:${PORT}`);
  
  if (process.env.BASE_URL) {
    console.log(`🌐 Používám externí URL: ${process.env.BASE_URL}`);
  } else {
    console.log(`⚠️ Používám lokální URL - nastavte BASE_URL proměnnou pro produkci`);
  }
  
  console.log(`📋 Manifest addon dostupný na: ${BASE_URL}/manifest.json`);
  console.log(`🎯 Addon ID: ${manifest.id}`);
});

module.exports = builder.getInterface();
