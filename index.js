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
const OMDB_API_KEY = '96c2253d'; // Hardcoded working API key

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

// Manifest
const manifest = {
  id: 'community.titulkycom',
  version: '1.0.0',
  name: 'Titulky.com',
  description: 'Czech subtitles from titulky.com',
  resources: ['subtitles'],
  types: ['movie'],
  idPrefixes: ['tt'],
  catalogs: []
};

// Funkce pro čištění názvu filmu
function cleanTitle(title) {
  return title
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// OMDB API funkce
async function getMovieInfo(imdbId) {
  try {
    const response = await axios.get(`http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
    return response.data;
  } catch (error) {
    console.error('Chyba při získávání dat z OMDB:', error.message);
    return null;
  }
}

// Vyhledávání na titulky.com
async function searchTitulkycom(title, year) {
  try {
    console.log(`🔍 Hledám titulky pro: "${title}" (${year})`);
    
    const searchUrl = 'https://www.titulky.com/';
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const subtitleLinks = [];
    
    // Hledání odkazů na filmy
    $('a[href*=".htm"]').each((i, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
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

// Získání download odkazů z detailní stránky
async function getDownloadLinks(pageUrl) {
  try {
    console.log(`🔗 Získávám download odkazy z: ${pageUrl}`);
    
    const response = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const downloadLinks = [];

    // Hledání download odkazů
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

    // Hledání dalších možných download odkazů
    $('a').each((i, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (href && (text.includes('stáhn') || text.includes('download') || href.includes('download'))) {
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

// TIMEOUT APPROACH - čeká na countdown!
async function downloadWithTimeout(downloadUrl, movieTitle) {
  try {
    console.log(`⬇️ Stahuji titulky z: ${downloadUrl}`);
    
    // PRVNÍ POKUS - možná je to přímý link
    try {
      const quickResponse = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });
      
      // Zkontroluj jestli je to skutečný soubor
      const contentType = quickResponse.headers['content-type'];
      if (contentType && (contentType.includes('zip') || contentType.includes('rar') || contentType.includes('octet-stream'))) {
        console.log(`✅ Přímý download úspěšný!`);
        return await processDownloadedFile(quickResponse.data, movieTitle);
      }
    } catch (quickError) {
      console.log(`⚠️ Přímý download neúspěšný, zkouším s timeout`);
    }
    
    // TIMEOUT APPROACH - čekej na countdown
    console.log(`⏰ TIMEOUT APPROACH: Čekám 13 sekund na countdown...`);
    await new Promise(resolve => setTimeout(resolve, 13000));
    
    // Zkus znovu po čekání
    console.log(`🔄 Zkouším download po timeout...`);
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    return await processDownloadedFile(response.data, movieTitle);

  } catch (error) {
    console.error('❌ Chyba při stahování s timeout:', error.message);
    throw error;
  }
}

// Zpracování staženého souboru
async function processDownloadedFile(data, movieTitle) {
  const fileName = `${cleanTitle(movieTitle)}_${Date.now()}`;
  
  // Detekce typu souboru
  let fileExtension = '.zip';
  const header = data.slice(0, 4);
  if (header[0] === 0x50 && header[1] === 0x4B) fileExtension = '.zip';
  else if (header[0] === 0x52 && header[1] === 0x61) fileExtension = '.rar';
  else fileExtension = '.srt';

  const filePath = path.join(subsDir, fileName + fileExtension);
  fs.writeFileSync(filePath, data);
  console.log(`💾 Soubor uložen: ${filePath}`);

  // Pokus o rozbalení
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
      console.log('⚠️ Soubor není ZIP archiv');
    }
  }

  // Pokud rozbalení selhalo, vrať původní soubor jako .srt
  const finalPath = path.join(subsDir, fileName + '.srt');
  fs.renameSync(filePath, finalPath);
  return `${BASE_URL}/subtitles/${fileName}.srt`;
}

// Hlavní funkce pro získání titulků
async function getSubtitles(type, id) {
  try {
    console.log(`🎬 Zpracovávám ${type} s ID: ${id}`);
    
    const movieInfo = await getMovieInfo(id);
    if (!movieInfo || movieInfo.Response === 'False') {
      console.log('❌ Film nenalezen v OMDB');
      return [];
    }

    console.log(`🎭 Nalezen film: ${movieInfo.Title} (${movieInfo.Year})`);

    // Vyhledání na titulky.com
    const searchResults = await searchTitulkycom(movieInfo.Title, movieInfo.Year);
    
    if (searchResults.length === 0) {
      console.log('❌ Žádné titulky nenalezeny na hlavní stránce');
      return [];
    }

    const subtitles = [];

    // Zpracování prvních výsledků
    for (let i = 0; i < Math.min(searchResults.length, 2); i++) {
      const result = searchResults[i];
      
      try {
        console.log(`🔄 Zpracovávám: ${result.title}`);
        
        const downloadLinks = await getDownloadLinks(result.url);
        
        if (downloadLinks.length > 0) {
          console.log(`⏰ Zkouším download s timeout approach...`);
          
          const downloadUrl = await downloadWithTimeout(
            downloadLinks[0].url, 
            movieInfo.Title
          );
          
          subtitles.push({
            id: `titulkycom_timeout_${Date.now()}_${i}`,
            url: downloadUrl,
            lang: 'cze'
          });
          
          console.log(`✅ ÚSPĚCH! Titulky staženy: ${result.title}`);
          break; // Stačí první úspěšný
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

// Addon builder
const builder = addonBuilder(manifest);

builder.defineSubtitlesHandler(async ({ type, id }) => {
  console.log(`📥 TIMEOUT REQUEST: ${type}/${id}`);
  
  try {
    const subtitles = await getSubtitles(type, id);
    return { subtitles };
  } catch (error) {
    console.error('❌ Chyba v subtitles handleru:', error.message);
    return { subtitles: [] };
  }
});

// Express server
const app = express();

// CORS
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

// Cache busting
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});

// Debug middleware
app.use((req, res, next) => {
  if (req.url.includes('/subtitles')) {
    console.log(`🔥 TIMEOUT SUBTITLES REQUEST: ${req.method} ${req.url}`);
  }
  next();
});

// Static files
app.use('/subtitles', express.static(subsDir));

// Routes
app.get('/', (req, res) => {
  res.send('⏰ Timeout Titulky.com addon je spuštěn! No Puppeteer needed!');
});

app.get('/manifest.json', (req, res) => {
  console.log('📋 Manifest požadavek');
  res.json(manifest);
});

// Main endpoint with .json suffix (what Stremio uses)
app.get('/subtitles/:type/:id/:filename', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`⏰ TIMEOUT FORMAT: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    console.log(`✅ TIMEOUT: Returning ${subtitles.length} subtitles`);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ Timeout chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Fallback endpoint
app.get('/subtitles/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`⏰ TIMEOUT FALLBACK: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ Timeout fallback chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 TIMEOUT ADDON běží na portu ${PORT}`);
  console.log(`⏰ TIMEOUT APPROACH: Čeká 13 sekund na countdown!`);
  console.log(`🎯 Manifest: ${BASE_URL}/manifest.json`);
  
  if (process.env.BASE_URL) {
    console.log(`🌐 Externí URL: ${process.env.BASE_URL}`);
  }
});

module.exports = builder.getInterface();
