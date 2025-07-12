require('dotenv').config();
const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const puppeteer = require('puppeteer');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Konfigurace
const PORT = process.env.PORT || 7000;
const OMDB_API_KEY = '96c2253d'; // Hardcoded API klíč

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

// Jednoduchý manifest
const manifest = {
  id: 'community.titulkycom',
  version: '2.0.0',
  name: 'Titulky.com Pro',
  description: 'Czech subtitles from titulky.com with Puppeteer power',
  resources: ['subtitles'],
  types: ['movie'],
  idPrefixes: ['tt'],
  catalogs: []
};

// Funkce pro čištění názvu filmu pro vyhledávání
function cleanTitle(title) {
  return title
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Funkce pro získání informací o filmu z OMDB
async function getMovieInfo(imdbId) {
  try {
    const response = await axios.get(`http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
    return response.data;
  } catch (error) {
    console.error('❌ Chyba při získávání dat z OMDB:', error.message);
    return null;
  }
}

// PUPPETEER BEAST MODE 🤖
async function searchAndDownloadWithPuppeteer(movieTitle, movieYear) {
  let browser;
  try {
    console.log(`🤖 PUPPETEER: Spouštím browser pro "${movieTitle}"`);
    
    // Launch Puppeteer s headless módem
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    console.log(`🌐 PUPPETEER: Jdu na titulky.com`);
    await page.goto('https://www.titulky.com/', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    console.log(`🔍 PUPPETEER: Hledám "${movieTitle}"`);
    
    // Hledání filmu na hlavní stránce
    const movieLinks = await page.evaluate((title) => {
      const links = [];
      document.querySelectorAll('a').forEach(link => {
        const text = link.textContent.trim().toLowerCase();
        const href = link.href;
        if (text.includes(title.toLowerCase()) && href.includes('.htm')) {
          links.push({
            text: link.textContent.trim(),
            url: href
          });
        }
      });
      return links;
    }, movieTitle);

    console.log(`📋 PUPPETEER: Nalezeno ${movieLinks.length} potenciálních filmů`);

    if (movieLinks.length === 0) {
      console.log(`❌ PUPPETEER: Žádné filmy nenalezeny pro "${movieTitle}"`);
      return [];
    }

    // Vezmi první výsledek
    const firstResult = movieLinks[0];
    console.log(`🎯 PUPPETEER: Otevírám film: ${firstResult.text}`);
    
    await page.goto(firstResult.url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Najdi download button
    console.log(`🔗 PUPPETEER: Hledám download tlačítko`);
    
    const downloadButton = await page.$('a[href*="download"], a[href*=".zip"], a[href*=".rar"], .download');
    
    if (!downloadButton) {
      console.log(`❌ PUPPETEER: Download tlačítko nenalezeno`);
      return [];
    }

    console.log(`⬇️ PUPPETEER: Klikám na download`);
    await downloadButton.click();

    // WAIT FOR COUNTDOWN - tady je ta magie! 🎯
    console.log(`⏰ PUPPETEER: Čekám 12 sekund na countdown...`);
    await page.waitForTimeout(12000);

    // Zkus najít finální download link
    console.log(`🔍 PUPPETEER: Hledám finální download link`);
    
    const finalDownloadLink = await page.evaluate(() => {
      // Hledej různé možné selektory pro finální download
      const selectors = [
        'a[href*=".zip"]',
        'a[href*=".rar"]', 
        'a[href*="download"]',
        '.download-link',
        '#download'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.href) {
          return element.href;
        }
      }
      return null;
    });

    if (!finalDownloadLink) {
      console.log(`❌ PUPPETEER: Finální download link nenalezen`);
      return [];
    }

    console.log(`💾 PUPPETEER: Stahuji z: ${finalDownloadLink}`);

    // Stáhni soubor
    const response = await page.goto(finalDownloadLink, {
      waitUntil: 'networkidle2'
    });

    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()}`);
    }

    const buffer = await response.buffer();
    const fileName = `${cleanTitle(movieTitle)}_${Date.now()}.zip`;
    const filePath = path.join(subsDir, fileName);
    
    fs.writeFileSync(filePath, buffer);
    console.log(`✅ PUPPETEER: Soubor uložen: ${filePath}`);

    // Zkus rozbalit ZIP (pokud je to ZIP)
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();
      
      for (const entry of zipEntries) {
        if (entry.entryName.endsWith('.srt') || entry.entryName.endsWith('.sub')) {
          const extractPath = path.join(subsDir, `${cleanTitle(movieTitle)}_${Date.now()}.srt`);
          fs.writeFileSync(extractPath, entry.getData());
          console.log(`📂 PUPPETEER: Rozbaleno: ${extractPath}`);
          
          return [{
            id: `titulkycom_puppeteer_${Date.now()}`,
            url: `${BASE_URL}/subtitles/${path.basename(extractPath)}`,
            lang: 'cze'
          }];
        }
      }
    } catch (zipError) {
      console.log(`⚠️ PUPPETEER: Není ZIP nebo chyba rozbalování`);
      // Zkus to jako .srt přímo
      const srtPath = path.join(subsDir, `${cleanTitle(movieTitle)}_${Date.now()}.srt`);
      fs.renameSync(filePath, srtPath);
      
      return [{
        id: `titulkycom_puppeteer_${Date.now()}`,
        url: `${BASE_URL}/subtitles/${path.basename(srtPath)}`,
        lang: 'cze'
      }];
    }

    return [];

  } catch (error) {
    console.error(`❌ PUPPETEER ERROR: ${error.message}`);
    return [];
  } finally {
    if (browser) {
      await browser.close();
      console.log(`🔒 PUPPETEER: Browser uzavřen`);
    }
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

    // PUPPETEER POWER! 🚀
    console.log(`🤖 Spouštím Puppeteer pro: ${movieInfo.Title}`);
    const subtitles = await searchAndDownloadWithPuppeteer(movieInfo.Title, movieInfo.Year);
    
    if (subtitles.length > 0) {
      console.log(`✅ PUPPETEER ÚSPĚCH: Nalezeno ${subtitles.length} titulků!`);
    } else {
      console.log(`❌ PUPPETEER: Žádné titulky nenalezeny`);
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
  console.log(`📥 PUPPETEER REQUEST: ${type}/${id}`);
  
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

// Cache-busting
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});

// Debug middleware
app.use((req, res, next) => {
  if (req.url.includes('/subtitles')) {
    console.log(`🔥 PUPPETEER SUBTITLES REQUEST: ${req.method} ${req.url}`);
  }
  next();
});

// Statické soubory
app.use('/subtitles', express.static(subsDir));

// Routes
app.get('/', (req, res) => {
  res.send('🤖 Puppeteer Titulky.com addon je spuštěn! BIG GUNS MODE!');
});

app.get('/manifest.json', (req, res) => {
  console.log('📋 Manifest požadavek');
  res.json(manifest);
});

// Puppeteer endpoint s .json sufix
app.get('/subtitles/:type/:id/:filename', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`🤖 PUPPETEER FORMAT: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    console.log(`✅ PUPPETEER: Returning ${subtitles.length} subtitles`);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ Puppeteer chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Fallback endpoint
app.get('/subtitles/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`🤖 PUPPETEER FALLBACK: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ Puppeteer fallback chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Server start
app.listen(PORT, () => {
  console.log(`🚀 PUPPETEER ADDON běží na portu ${PORT}`);
  console.log(`🤖 BIG GUNS MODE: Anti-bot protection? NOT TODAY!`);
  console.log(`🎯 Manifest: ${BASE_URL}/manifest.json`);
  
  if (process.env.BASE_URL) {
    console.log(`🌐 Externí URL: ${process.env.BASE_URL}`);
  } else {
    console.log(`⚠️ Lokální URL - nastavte BASE_URL pro produkci`);
  }
});

module.exports = builder.getInterface();
