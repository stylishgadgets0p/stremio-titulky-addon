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

// Ultimate manifest
const manifest = {
  id: 'community.titulkycom.ultimate',
  version: '3.0.0',
  name: 'Titulky.com ULTIMATE ⚡',
  description: 'Ultimate timeout approach - No Puppeteer, just patience and clever hacks',
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

// Advanced search s lepším matchingem a URL fixem
async function ultimateSearch(movieTitle, movieYear) {
  try {
    console.log(`🔍 ULTIMATE: Hledám "${movieTitle}" (${movieYear})`);
    
    // Připrav různé varianty názvu pro přesnější matching
    const cleanedTitle = movieTitle.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const searchVariants = [
      movieTitle.toLowerCase(),
      cleanedTitle,
      movieTitle.split(':')[0].trim().toLowerCase(),
      movieTitle.split('(')[0].trim().toLowerCase(),
      movieTitle.split('-')[0].trim().toLowerCase()
    ];

    console.log(`🎯 ULTIMATE: Search variants: ${searchVariants.join(', ')}`);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'cs,en-US;q=0.7,en;q=0.3',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };

    console.log(`🌐 ULTIMATE: Načítám titulky.com`);
    const response = await axios.get('https://www.titulky.com/', {
      headers,
      timeout: 20000
    });

    const $ = cheerio.load(response.data);
    const movieMatches = [];

    // Lepší parsing s precizním matchingem
    const selectors = [
      'a[href*=".htm"]',
      'td a[href*=".htm"]', 
      'tr a[href*=".htm"]',
      '.movie-link',
      'table a'
    ];

    selectors.forEach(selector => {
      $(selector).each((i, element) => {
        const $el = $(element);
        const href = $el.attr('href');
        const text = $el.text().trim();
        
        if (text && href && href.includes('.htm')) {
          const lowerText = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          let score = 0;
          let matched = false;
          
          // PŘESNĚJŠÍ MATCHING
          searchVariants.forEach(variant => {
            // Exact match = nejvyšší score
            if (lowerText === variant) {
              score += 1000;
              matched = true;
            }
            // Obsahuje celý název
            else if (lowerText.includes(variant) && variant.length > 3) {
              score += 500;
              matched = true;
            }
            // Začíná stejně (důležité pro titulky)
            else if (lowerText.startsWith(variant) && variant.length > 3) {
              score += 300;
              matched = true;
            }
            // Obsahuje první slovo (ale jen pokud je dlouhé)
            else if (variant.length > 4) {
              const firstWord = variant.split(' ')[0];
              if (firstWord.length > 3 && lowerText.includes(firstWord)) {
                score += 100;
                matched = true;
              }
            }
          });
          
          // Bonus za rok (ale jen pokud už matchoval)
          if (matched && text.includes(movieYear)) {
            score += 200;
          }
          
          // Penalty za moc dlouhé názvy (pravděpodobně jiný film)
          if (lowerText.length > movieTitle.length * 2) {
            score -= 100;
          }
          
          if (score > 0) {
            // OPRAVA URL BUILDING - důležité!
            let fullUrl;
            if (href.startsWith('http')) {
              fullUrl = href;
            } else if (href.startsWith('/')) {
              fullUrl = `https://www.titulky.com${href}`;
            } else {
              fullUrl = `https://www.titulky.com/${href}`;
            }
            
            movieMatches.push({
              title: text,
              url: fullUrl,
              score: score,
              cleanText: lowerText
            });
          }
        }
      });
    });

    // Seřaď podle score
    movieMatches.sort((a, b) => b.score - a.score);
    
    console.log(`📋 ULTIMATE: Nalezeno ${movieMatches.length} potenciálních filmů`);
    
    // Debug top matches s více detaily
    movieMatches.slice(0, 5).forEach((match, i) => {
      console.log(`  ${i+1}. "${match.title}" (score: ${match.score})`);
      console.log(`      Clean: "${match.cleanText}"`);
      console.log(`      URL: ${match.url}`);
    });

    // FILTRUJ jen ty s vysokým score (nad 200)
    const goodMatches = movieMatches.filter(m => m.score > 200);
    console.log(`🎯 ULTIMATE: Filtrováno na ${goodMatches.length} kvalitních matchů`);

    return goodMatches;

  } catch (error) {
    console.error(`❌ ULTIMATE: Search error - ${error.message}`);
    return [];
  }
}

// Ultimate download s více strategiemi
async function ultimateDownload(movieUrl, movieTitle) {
  try {
    console.log(`🔗 ULTIMATE: Analyzujem stránku filmu`);
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://www.titulky.com/'
    };

    const response = await axios.get(movieUrl, {
      headers,
      timeout: 20000
    });

    const $ = cheerio.load(response.data);
    const downloadLinks = [];

    // Aggressive selector search
    const downloadSelectors = [
      'a[href*="download"]',
      'a[href*=".zip"]',
      'a[href*=".rar"]',
      'a[href*=".srt"]',
      '.download',
      '#download',
      'a:contains("Stáhnout")',
      'a:contains("Download")',
      'a:contains("ZIP")',
      'a:contains("RAR")'
    ];

    downloadSelectors.forEach(selector => {
      try {
        $(selector).each((i, element) => {
          const $el = $(element);
          const href = $el.attr('href');
          const text = $el.text().trim();
          
          if (href) {
            const fullUrl = href.startsWith('http') ? href : `https://www.titulky.com${href}`;
            downloadLinks.push({
              title: text || 'Download',
              url: fullUrl,
              selector: selector
            });
          }
        });
      } catch (e) {
        // Ignore selector errors
      }
    });

    // Fallback - hledej text obsahující download klíčová slova
    $('a').each((i, element) => {
      const $el = $(element);
      const href = $el.attr('href');
      const text = $el.text().toLowerCase();
      
      if (href && (text.includes('stáhnout') || text.includes('download') || 
                   text.includes('zip') || text.includes('rar'))) {
        const fullUrl = href.startsWith('http') ? href : `https://www.titulky.com${href}`;
        downloadLinks.push({
          title: $el.text().trim(),
          url: fullUrl,
          selector: 'text-search'
        });
      }
    });

    console.log(`⬇️ ULTIMATE: Nalezeno ${downloadLinks.length} download odkazů`);

    if (downloadLinks.length === 0) {
      console.log(`❌ ULTIMATE: Žádné download odkazy nenalezeny`);
      return [];
    }

    // Zkus první 3 download odkazy
    for (let i = 0; i < Math.min(downloadLinks.length, 3); i++) {
      const link = downloadLinks[i];
      console.log(`🎯 ULTIMATE: Testujem download ${i+1}: ${link.title}`);
      
      try {
        // MULTIPLE TIMEOUT STRATEGIES
        const timeouts = [0, 8000, 13000, 18000]; // 0s, 8s, 13s, 18s
        
        for (const timeout of timeouts) {
          try {
            if (timeout > 0) {
              console.log(`⏰ ULTIMATE: Čekám ${timeout/1000} sekund na countdown...`);
              await new Promise(resolve => setTimeout(resolve, timeout));
            }
            
            console.log(`📥 ULTIMATE: Pokus o download (timeout: ${timeout/1000}s)`);
            
            const downloadResponse = await axios.get(link.url, {
              responseType: 'arraybuffer',
              headers: {
                ...headers,
                'Referer': movieUrl
              },
              timeout: 30000,
              maxRedirects: 5
            });

            // Zkontroluj jestli je to skutečný soubor
            const contentType = downloadResponse.headers['content-type'] || '';
            const contentLength = parseInt(downloadResponse.headers['content-length'] || '0');
            
            console.log(`📊 ULTIMATE: Content-Type: ${contentType}, Size: ${contentLength} bytes`);
            
            // Je to soubor?
            if (contentLength > 1000 && (
                contentType.includes('zip') || 
                contentType.includes('rar') ||
                contentType.includes('octet-stream') ||
                contentType.includes('application'))) {
              
              console.log(`✅ ULTIMATE: Vypadá to jako soubor! Zpracovávám...`);
              
              const fileName = `${cleanTitle(movieTitle)}_ultimate_${Date.now()}`;
              
              // Detekce typu
              let ext = '.zip';
              if (contentType.includes('rar')) ext = '.rar';
              else if (contentType.includes('zip')) ext = '.zip';
              else if (link.url.includes('.rar')) ext = '.rar';
              else if (link.url.includes('.zip')) ext = '.zip';
              
              const filePath = path.join(subsDir, fileName + ext);
              fs.writeFileSync(filePath, downloadResponse.data);
              console.log(`💾 ULTIMATE: Soubor uložen: ${filePath}`);

              // Pokus o rozbalení
              if (ext === '.zip') {
                try {
                  const zip = new AdmZip(filePath);
                  const entries = zip.getEntries();
                  
                  for (const entry of entries) {
                    if (entry.entryName.endsWith('.srt') || entry.entryName.endsWith('.sub')) {
                      const extractPath = path.join(subsDir, `${fileName}.srt`);
                      fs.writeFileSync(extractPath, entry.getData());
                      console.log(`📂 ULTIMATE: Rozbaleno: ${extractPath}`);
                      
                      return [{
                        id: `ultimate_${Date.now()}`,
                        url: `${BASE_URL}/subtitles/${fileName}.srt`,
                        lang: 'cze'
                      }];
                    }
                  }
                } catch (zipError) {
                  console.log(`⚠️ ULTIMATE: ZIP error: ${zipError.message}`);
                }
              }
              
              // Fallback - jako SRT
              const srtPath = path.join(subsDir, `${fileName}.srt`);
              try {
                fs.renameSync(filePath, srtPath);
                console.log(`✅ ULTIMATE: Přejmenováno na SRT`);
                
                return [{
                  id: `ultimate_${Date.now()}`,
                  url: `${BASE_URL}/subtitles/${fileName}.srt`,
                  lang: 'cze'
                }];
              } catch (renameError) {
                console.log(`❌ ULTIMATE: Rename error: ${renameError.message}`);
              }
            } else {
              console.log(`⚠️ ULTIMATE: Neplatný soubor (velikost: ${contentLength}, typ: ${contentType})`);
              
              // Je to HTML stránka s countdown?
              if (contentType.includes('text/html')) {
                console.log(`🌐 ULTIMATE: HTML stránka - pokračujem s dalším timeout`);
                continue; // Zkus další timeout
              }
            }
            
          } catch (downloadError) {
            console.log(`⚠️ ULTIMATE: Download error s timeout ${timeout/1000}s: ${downloadError.message}`);
            continue; // Zkus další timeout
          }
        }
        
      } catch (linkError) {
        console.error(`❌ ULTIMATE: Error s linkem ${i+1}: ${linkError.message}`);
        continue; // Zkus další link
      }
    }

    console.log(`❌ ULTIMATE: Všechny download pokusy selhaly`);
    return [];

  } catch (error) {
    console.error(`❌ ULTIMATE: Download function error: ${error.message}`);
    return [];
  }
}

// Hlavní funkce
async function getSubtitles(type, id) {
  try {
    console.log(`🎬 ULTIMATE: Zpracovávám ${type} s ID: ${id}`);
    
    const movieInfo = await getMovieInfo(id);
    if (!movieInfo || movieInfo.Response === 'False') {
      console.log('❌ Film nenalezen v OMDB');
      return [];
    }

    console.log(`🎭 ULTIMATE: Nalezen film: ${movieInfo.Title} (${movieInfo.Year})`);

    // Ultimate search
    const movieMatches = await ultimateSearch(movieInfo.Title, movieInfo.Year);
    
    if (movieMatches.length === 0) {
      console.log('❌ ULTIMATE: Žádné filmy nenalezeny');
      return [];
    }

    // Zkus top 2 matches
    for (let i = 0; i < Math.min(movieMatches.length, 2); i++) {
      const match = movieMatches[i];
      console.log(`🎯 ULTIMATE: Testujem match ${i+1}: ${match.title} (score: ${match.score})`);
      
      try {
        const subtitles = await ultimateDownload(match.url, movieInfo.Title);
        
        if (subtitles.length > 0) {
          console.log(`🎉 ULTIMATE ÚSPĚCH: Titulky nalezeny pro "${match.title}"!`);
          return subtitles;
        }
        
      } catch (matchError) {
        console.error(`❌ ULTIMATE: Match error: ${matchError.message}`);
        continue;
      }
    }

    console.log(`😤 ULTIMATE: Všechny pokusy selhaly`);
    return [];

  } catch (error) {
    console.error('❌ ULTIMATE: Celková chyba:', error.message);
    return [];
  }
}

// Addon builder
const builder = addonBuilder(manifest);

builder.defineSubtitlesHandler(async ({ type, id }) => {
  console.log(`📥 ULTIMATE REQUEST: ${type}/${id}`);
  
  try {
    const subtitles = await getSubtitles(type, id);
    return { subtitles };
  } catch (error) {
    console.error('❌ ULTIMATE handler chyba:', error.message);
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
    console.log(`🔥 ULTIMATE REQUEST: ${req.method} ${req.url}`);
  }
  next();
});

// Static files
app.use('/subtitles', express.static(subsDir));

// Routes
app.get('/', (req, res) => {
  res.send(`
    ⚡ ULTIMATE TITULKY.COM ADDON ⚡
    <br>🎯 Multiple timeout strategies
    <br>🔍 Advanced search matching  
    <br>💪 No Puppeteer needed
    <br>🚀 Pure determination!
  `);
});

app.get('/manifest.json', (req, res) => {
  console.log('📋 ULTIMATE: Manifest požadavek');
  res.json(manifest);
});

// Main endpoint
app.get('/subtitles/:type/:id/:filename', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`⚡ ULTIMATE FORMAT: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    console.log(`✅ ULTIMATE: Returning ${subtitles.length} subtitles`);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ ULTIMATE endpoint chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Fallback
app.get('/subtitles/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`⚡ ULTIMATE FALLBACK: type=${type}, id=${id}`);
    const subtitles = await getSubtitles(type, id);
    res.json({ subtitles });
  } catch (error) {
    console.error('❌ ULTIMATE fallback chyba:', error);
    res.json({ subtitles: [] });
  }
});

// Start the ULTIMATE
app.listen(PORT, () => {
  console.log(`🚀 ULTIMATE ADDON běží na portu ${PORT}`);
  console.log(`⚡ ULTIMATE APPROACH: Multiple timeouts + smart matching`);
  console.log(`🎯 Target: titulky.com via pure determination`);
  console.log(`🔥 Manifest: ${BASE_URL}/manifest.json`);
  
  if (process.env.BASE_URL) {
    console.log(`🌐 ULTIMATE URL: ${process.env.BASE_URL}`);
  }
  
  console.log(`\n⚡ ULTIMATE MODE ACTIVATED! ⚡`);
});

module.exports = builder.getInterface();
