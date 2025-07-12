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
const OMDB_API_KEY = '96c2253d';

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

// Beast Mode Manifest
const manifest = {
  id: 'community.titulkycom.beast',
  version: '2.0.0',
  name: 'Titulky.com BEAST MODE 🤖',
  description: '8GB Puppeteer power - Anti-bot? What anti-bot?',
  resources: ['subtitles'],
  types: ['movie'],
  idPrefixes: ['tt'],
  catalogs: []
};

// Čištění názvu
function cleanTitle(title) {
  return title
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// OMDB funkce
async function getMovieInfo(imdbId) {
  try {
    const response = await axios.get(`http://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
    return response.data;
  } catch (error) {
    console.error('❌ OMDB chyba:', error.message);
    return null;
  }
}

// 🤖 PUPPETEER BEAST MODE - 8GB EDITION 🤖
async function beastModeSearch(movieTitle, movieYear) {
  let browser;
  try {
    console.log(`🤖 BEAST MODE: Spouštím Chrome pro "${movieTitle}"`);
    console.log(`💪 8GB RAM: Anti-bot ochrana se může bát!`);
    
    // Launch Chrome s beast mode configem
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--memory-pressure-off'
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });

    const page = await browser.newPage();
    
    // Advanced stealth mode
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    console.log(`🌐 BEAST: Útočím na titulky.com`);
    await page.goto('https://www.titulky.com/', { 
      waitUntil: 'networkidle2',
      timeout: 45000 
    });

    // Čekej chvilku na načtení
    await page.waitForTimeout(2000);

    console.log(`🔍 BEAST: Analyzujem stránku pro "${movieTitle}"`);
    
    // Najdi filmy na hlavní stránce
    const movieMatches = await page.evaluate((title, year) => {
      const matches = [];
      
      // Hledej v různých sekcích
      const selectors = [
        'a[href*=".htm"]',
        '.movie-link',
        'tr a',
        'td a'
      ];
      
      selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          const text = element.textContent.trim();
          const href = element.href;
          
          if (text && href && href.includes('.htm')) {
            const lowerText = text.toLowerCase();
            const lowerTitle = title.toLowerCase();
            
            // Fuzzy matching
            if (lowerText.includes(lowerTitle) || 
                lowerTitle.includes(lowerText.split(' ')[0]) ||
                lowerText.includes(year)) {
              matches.push({
                text: text,
                url: href,
                score: lowerText.includes(lowerTitle) ? 100 : 50
              });
            }
          }
        });
      });
      
      // Seřaď podle score
      return matches.sort((a, b) => b.score - a.score);
    }, movieTitle, movieYear);

    console.log(`📋 BEAST: Nalezeno ${movieMatches.length} potenciálních filmů`);

    if (movieMatches.length === 0) {
      console.log(`❌ BEAST: Žádné filmy nenalezeny`);
      return [];
    }

    // Zkus první 2 nejlepší matches
    for (let i = 0; i < Math.min(movieMatches.length, 2); i++) {
      const match = movieMatches[i];
      console.log(`🎯 BEAST: Testujem match ${i+1}: ${match.text}`);
      
      try {
        // Jdi na stránku filmu
        await page.goto(match.url, { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });

        console.log(`🔍 BEAST: Hledám download tlačítko`);
        await page.waitForTimeout(1000);

        // Najdi download button - zkus více selektorů
        const downloadFound = await page.evaluate(() => {
          const selectors = [
            'a[href*="download"]',
            'a[href*=".zip"]',
            'a[href*=".rar"]',
            '.download',
            '#download',
            'a:contains("Stáhnout")',
            'a:contains("Download")'
          ];
          
          for (const selector of selectors) {
            try {
              const element = document.querySelector(selector);
              if (element) {
                return { found: true, selector: selector };
              }
            } catch (e) {}
          }
          
          // Fallback - hledej text
          const links = document.querySelectorAll('a');
          for (const link of links) {
            const text = link.textContent.toLowerCase();
            if (text.includes('stáhnout') || text.includes('download') || 
                text.includes('zip') || text.includes('rar')) {
              return { found: true, element: link.href };
            }
          }
          
          return { found: false };
        });

        if (!downloadFound.found) {
          console.log(`❌ BEAST: Download tlačítko nenalezeno pro ${match.text}`);
          continue;
        }

        console.log(`🎯 BEAST: Download tlačítko nalezeno!`);

        // Klikni na download
        await page.click('a[href*="download"], a[href*=".zip"], a[href*=".rar"]');
        
        console.log(`⏰ BEAST: Čekám na countdown (15 sekund)...`);
        console.log(`💪 8GB RAM: Můžu si dovolit čekat!`);
        
        // Počkej na countdown s extra časem
        await page.waitForTimeout(15000);

        console.log(`🔍 BEAST: Hledám finální download link`);

        // Zkus najít finální download
        const finalDownload = await page.evaluate(() => {
          const finalSelectors = [
            'a[href*=".zip"]:not([href*="download.php"])',
            'a[href*=".rar"]:not([href*="download.php"])',
            'a[download]',
            '.final-download',
            '#final-download'
          ];
          
          for (const selector of finalSelectors) {
            const element = document.querySelector(selector);
            if (element && element.href) {
              return element.href;
            }
          }
          
          // Backup - hledej v current URL
          if (window.location.href.includes('.zip') || 
              window.location.href.includes('.rar')) {
            return window.location.href;
          }
          
          return null;
        });

        if (finalDownload) {
          console.log(`💾 BEAST: Finální download nalezen: ${finalDownload}`);
          
          // Stáhni soubor
          const downloadPage = await browser.newPage();
          const response = await downloadPage.goto(finalDownload, {
            waitUntil: 'networkidle2',
            timeout: 30000
          });

          if (response && response.ok()) {
            const buffer = await response.buffer();
            const fileName = `${cleanTitle(movieTitle)}_beast_${Date.now()}`;
            
            // Detekce typu souboru
            let ext = '.zip';
            const contentType = response.headers()['content-type'];
            if (contentType) {
              if (contentType.includes('zip')) ext = '.zip';
              else if (contentType.includes('rar')) ext = '.rar';
              else if (contentType.includes('text')) ext = '.srt';
            }
            
            const filePath = path.join(subsDir, fileName + ext);
            fs.writeFileSync(filePath, buffer);
            console.log(`💾 BEAST: Soubor uložen: ${filePath}`);

            // Pokus o rozbalení
            if (ext === '.zip') {
              try {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(filePath);
                const entries = zip.getEntries();
                
                for (const entry of entries) {
                  if (entry.entryName.endsWith('.srt') || entry.entryName.endsWith('.sub')) {
                    const extractPath = path.join(subsDir, `${fileName}.srt`);
                    fs.writeFileSync(extractPath, entry.getData());
                    console.log(`📂 BEAST: Rozbaleno: ${extractPath}`);
                    
                    await downloadPage.close();
                    
                    return [{
                      id: `beast_mode_${Date.now()}`,
                      url: `${BASE_URL}/subtitles/${fileName}.srt`,
                      lang: 'cze'
                    }];
                  }
                }
              } catch (zipError) {
                console.log(`⚠️ BEAST: ZIP chyba, zkouším jako SRT`);
              }
            }
            
            // Fallback - rename to SRT
            const srtPath = path.join(subsDir, `${fileName}.srt`);
            try {
              fs.renameSync(filePath, srtPath);
              console.log(`✅ BEAST: Přejmenováno na SRT: ${srtPath}`);
              
              await downloadPage.close();
              
              return [{
                id: `beast_mode_${Date.now()}`,
                url: `${BASE_URL}/subtitles/${fileName}.srt`,
                lang: 'cze'
              }];
            } catch (renameError) {
              console.log(`❌ BEAST: Chyba přejmenování: ${renameError.message}`);
            }
          }
          
          await downloadPage.close();
        } else {
          console.log(`❌ BEAST: Finální download link nenalezen`);
        }

      } catch (matchError) {
        console.error(`❌ BEAST: Chyba při zpracování ${match.text}:`, matchError.message);
        continue;
      }
    }

    console.log(`❌ BEAST: Všechny pokusy selhaly`);
    return [];

  } catch (error) {
    console.error(`❌ BEAST MODE ERROR: ${error.message}`);
    return [];
  } finally {
    if (browser) {
      await browser.close();
      console.log(`🔒 BEAST: Chrome browser uzavřen`);
    }
  }
}

// Hlavní funkce
async function getSubtitles(type, id) {
  try {
    console.log(`🎬 BEAST MODE: Zpracovávám ${type} s ID: ${id}`);
    
    const movieInfo = await getMovieInfo(id);
    if (!movieInfo || movieInfo.Response === 'False') {
      console.log('❌ Film nenalezen v OMDB');
      return [];
    }

    console.log(`🎭 BEAST: Nalezen film: ${movieInfo.Title} (${movieInfo.Year})`);
    console.log(`🤖 BEAST: Spouštím 8GB Puppeteer útok!`);

    const subtitles = await beastModeSearch(movieInfo.Title, movieInfo.Year);
    
    if (subtitles.length > 0) {
      console.log(`🎉 BEAST MODE ÚSPĚCH: ${subtitles.length} titulků nalezeno!`);
    } else {
      console.log(`😤 BEAST MODE: Ani 8GB nestačilo...`);
    }

    return subtitles;

  } catch (error) {
    console.error('❌ BEAST: Celková chyba:', error.message);
    return [];
  }
}

// Addon builder
const builder = addonBuilder(manifest);

builder.defineSubtitlesHandler(async ({ type, id }) => {
  console.log(`📥 BEAST REQUEST: ${type}/${id}`);
  
  try {
    const subtitles = await getSubtitles(type, id);
    return { subtitles };
  } catch (error) {
    console.error('❌ BEAST handler chyba:', error.message);
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
    console.log(`🔥 BEAST SUBTITLES REQUEST: ${req.method} ${req.url}`);
  }
  next();
});

// Static files
app.use('/subtitles', express.static(subsDir));

// Routes
app.get('/', (req, res) => {
  res.send(`
    🤖 BEAST MODE ADDON 🤖
    <br>💪 8GB RAM Power
    <br>🎯 Anti-bot? What anti-bot?
    <br>🔥 Titulky.com has no chance!
  `);
});

app.get('/manifest.json', (req, res) => {
  console.log('📋 BEAST: Manifest požadavek');
  res.json(manifest);
});

// Main endpoint
app.get('/subtitles/:type/:id/:filename', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`🤖 BEAST FORMAT: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    console.log(`✅ BEAST: Returning ${subtitles.length} subtitles`);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ BEAST endpoint chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Fallback
app.get('/subtitles/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`🤖 BEAST FALLBACK: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ BEAST fallback chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Start the BEAST
app.listen(PORT, () => {
  console.log(`🚀 BEAST MODE ADDON běží na portu ${PORT}`);
  console.log(`🤖 8GB RAM: Ready to destroy anti-bot protection!`);
  console.log(`💪 Puppeteer: Loaded and dangerous!`);
  console.log(`🎯 Target: titulky.com countdown system`);
  console.log(`🔥 Manifest: ${BASE_URL}/manifest.json`);
  
  if (process.env.BASE_URL) {
    console.log(`🌐 BEAST URL: ${process.env.BASE_URL}`);
  }
  
  console.log(`\n🤖 BEAST MODE ACTIVATED! 🤖`);
});

module.exports = builder.getInterface();
