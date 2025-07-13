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
const OMDB_API_KEY = '6a2085aa';

// Global session management
let sessionCookies = null;
let sessionExpiry = null;

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

// Login funkce pro titulky.com - PŘESNÁ IMPLEMENTACE
async function loginToTitulky() {
  try {
    const username = "rentor";
    const password = "datartbest";
    
    if (!username || !password) {
      console.log('⚠️ LOGIN: Chybí username nebo password v environment variables');
      return null;
    }
    
    console.log(`🔐 LOGIN: Přihlašuji se jako ${username}...`);
    
    // POST login data - PŘESNĚ podle HTML formu
    const loginData = new URLSearchParams();
    loginData.append('Login', username);          // field name: "Login"
    loginData.append('Password', password);       // field name: "Password"
    loginData.append('prihlasit', 'Přihlásit');  // submit button
    loginData.append('foreverlog', '1');         // trvalé přihlášení
    loginData.append('Detail2', '');             // hidden field
    
    console.log(`🔗 LOGIN: POST na https://www.titulky.com/`);
    
    const loginResponse = await axios.post('https://www.titulky.com/', loginData, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.titulky.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'cs,en-US;q=0.7,en;q=0.3'
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 400
    });
    
    // Získej cookies z odpovědi
    const cookies = loginResponse.headers['set-cookie'];
    if (cookies && cookies.length > 0) {
      console.log('✅ LOGIN: Přihlášení úspěšné! Cookies získány.');
      console.log(`🍪 LOGIN: ${cookies.length} cookies uloženo`);
      
      // Uložit session s expiry (2 hodiny)
      sessionCookies = cookies.join('; ');
      sessionExpiry = Date.now() + (2 * 60 * 60 * 1000); // 2 hodiny
      
      return sessionCookies;
    } else {
      console.log('❌ LOGIN: Přihlášení selhalo - žádné cookies');
      console.log(`📄 LOGIN: Response status: ${loginResponse.status}`);
      
      // Debug response pro troubleshooting
      const responseText = loginResponse.data.substring(0, 500);
      console.log(`📝 LOGIN: Response preview: ${responseText}`);
      
      return null;
    }
    
  } catch (error) {
    console.log(`❌ LOGIN: Chyba při přihlašování: ${error.message}`);
    if (error.response) {
      console.log(`📄 LOGIN: Response status: ${error.response.status}`);
      console.log(`📝 LOGIN: Response preview: ${error.response.data ? error.response.data.substring(0, 300) : 'No data'}`);
    }
    return null;
  }
}

// Session management s auto-refresh
async function getSessionHeaders() {
  try {
    // Zkontroluj jestli session existuje a není expirovaná
    if (!sessionCookies || !sessionExpiry || Date.now() > sessionExpiry) {
      console.log('🔄 SESSION: Session expirovala nebo neexistuje, obnovuji...');
      sessionCookies = await loginToTitulky();
    }
    
    // Základní headers
    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'cs,en-US;q=0.7,en;q=0.3',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.titulky.com/'
    };
    
    // Přidej cookies pokud existují
    if (sessionCookies) {
      console.log('🍪 SESSION: Používám přihlášenou session');
      return {
        ...baseHeaders,
        'Cookie': sessionCookies
      };
    } else {
      console.log('⚠️ SESSION: Používám anonymous session');
      return baseHeaders;
    }
    
  } catch (error) {
    console.log(`❌ SESSION: Chyba při získávání headers: ${error.message}`);
    // Fallback na základní headers
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'cs,en-US;q=0.7,en;q=0.3',
      'Referer': 'https://www.titulky.com/'
    };
  }
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

// Advanced search s použitím správného search endpointu
async function ultimateSearch(movieTitle, movieYear) {
  try {
    console.log(`🔍 ULTIMATE: Hledám "${movieTitle}" (${movieYear})`);
    
    // Připrav search query pro titulky.com
    const searchQuery = encodeURIComponent(movieTitle.toLowerCase().trim());
    const searchUrl = `https://www.titulky.com/?Fulltext=${searchQuery}`;
    
    console.log(`🌐 ULTIMATE: Search URL: ${searchUrl}`);
    console.log(`🔍 ULTIMATE: Používám search endpoint s přihlášenou session`);
    
    const sessionHeaders = await getSessionHeaders();
    
    const response = await axios.get(searchUrl, {
      headers: sessionHeaders,
      timeout: 20000
    });

    const $ = cheerio.load(response.data);
    const movieMatches = [];

    console.log(`📄 ULTIMATE: Parsuju search výsledky`);

    // Parse search results - JEN filmové stránky, ne diskuze!
    const selectors = [
      'table tr a[href*=".htm"]:not([href*="pozadavek"])',  // výsledky v tabulce, ale ne požadavky
      '.search-result a[href*=".htm"]:not([href*="pozadavek"])',  // search results
      'tr a[href*=".htm"]:not([href*="pozadavek"])',  // řádky tabulky
      'td a[href*=".htm"]:not([href*="pozadavek"])'  // buňky tabulky
    ];

    selectors.forEach((selector, selectorIndex) => {
      $(selector).each((i, element) => {
        const $el = $(element);
        const href = $el.attr('href');
        const text = $el.text().trim();
        
        // EXTRA FILTER - vyfiltruj diskuze a požadavky
        if (text && href && href.includes('.htm') && 
            !href.includes('pozadavek') && 
            !href.includes('forum') &&
            !href.includes('diskuze') &&
            text.length < 200 && // dlouhé texty = komentáře
            !text.toLowerCase().includes('napsal') &&
            !text.toLowerCase().includes('řekl')) {
          
          console.log(`   Nalezen FILM: "${text}" → ${href}`);
          
          const lowerText = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          const lowerTitle = movieTitle.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          let score = 0;
          
          // PŘESNĚJŠÍ MATCHING PRO SEARCH RESULTS
          if (lowerText === lowerTitle) {
            score += 1000; // Exact match
            console.log(`      → EXACT MATCH! Score: ${score}`);
          }
          else if (lowerText.includes(lowerTitle)) {
            score += 800; // Obsahuje celý název
            console.log(`      → Contains full title! Score: ${score}`);
          }
          else if (lowerTitle.includes(lowerText)) {
            score += 600; // Název obsahuje nalezený text
            console.log(`      → Title contains result! Score: ${score}`);
          }
          else {
            // Check individual words
            const titleWords = lowerTitle.split(' ').filter(w => w.length > 2);
            const textWords = lowerText.split(' ').filter(w => w.length > 2);
            
            let matchedWords = 0;
            titleWords.forEach(word => {
              if (textWords.some(tw => tw.includes(word) || word.includes(tw))) {
                matchedWords++;
              }
            });
            
            if (matchedWords > 0) {
              score += matchedWords * 100; // Body za každé matchované slovo
              console.log(`      → Matched ${matchedWords} words! Score: ${score}`);
            }
          }
          
          // Bonus za rok
          if (text.includes(movieYear)) {
            score += 200;
            console.log(`      → Year match bonus! Score: ${score}`);
          }
          
          // Bonus za to že je v search results (mělo by být relevantní)
          score += 50;
          
          if (score > 0) {
            // OPRAVA URL BUILDING
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
              cleanText: lowerText,
              selector: selector
            });
          }
        }
      });
    });

    // Seřaď podle score
    movieMatches.sort((a, b) => b.score - a.score);
    
    console.log(`📋 ULTIMATE: Nalezeno ${movieMatches.length} search výsledků`);
    
    // Debug všechny matches
    movieMatches.forEach((match, i) => {
      console.log(`  ${i+1}. "${match.title}" (score: ${match.score})`);
      console.log(`      Clean: "${match.cleanText}"`);
      console.log(`      URL: ${match.url}`);
      console.log(`      Selector: ${match.selector}`);
    });

    // Vrať top matches (bez přísného filtrování)
    const topMatches = movieMatches.slice(0, 5);
    console.log(`🎯 ULTIMATE: Vracím top ${topMatches.length} matchů`);

    return topMatches;

  } catch (error) {
    console.error(`❌ ULTIMATE: Search error - ${error.message}`);
    return [];
  }
}

// Ultimate download s více strategiemi
async function ultimateDownload(movieUrl, movieTitle) {
  try {
    console.log(`🔗 ULTIMATE: Analyzujem stránku filmu s přihlášenou session`);
    
    const sessionHeaders = await getSessionHeaders();

    const response = await axios.get(movieUrl, {
      headers: sessionHeaders,
      timeout: 20000
    });

    const $ = cheerio.load(response.data);
    const downloadLinks = [];

    // Aggressive selector search pro titulky.com download
    const downloadSelectors = [
      'a[href*="idown.php"]',  // Hlavní download link na titulky.com
      'a:contains("Stáhnout v ZIP")',  // Text tlačítka
      'a:contains("Stáhnout")',
      'a[href*="download"]',
      'a[href*=".zip"]',
      'a[href*=".rar"]',
      'a[href*=".srt"]',
      '.download',
      '#download',
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
            // OPRAVA URL BUILDING pro idown.php
            let fullUrl;
            if (href.startsWith('http')) {
              fullUrl = href;
            } else if (href.startsWith('/')) {
              fullUrl = `https://www.titulky.com${href}`;
            } else if (href.startsWith('idown.php')) {
              fullUrl = `https://www.titulky.com/${href}`;  // DŮLEŽITÉ: lomítko před idown.php
            } else {
              fullUrl = `https://www.titulky.com/${href}`;
            }
            
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
        // TIMEOUT APPROACH - čekej na countdown
        const timeouts = [0, 8000, 13000, 18000]; // 0s, 8s, 13s, 18s
        
        for (const timeout of timeouts) {
          try {
            if (timeout > 0) {
              console.log(`⏰ POPUP: Čekám ${timeout/1000} sekund na countdown...`);
              await new Promise(resolve => setTimeout(resolve, timeout));
            }
            
            console.log(`📥 POPUP: Pokus o download (timeout: ${timeout/1000}s)`);
            
            const downloadResponse = await axios.get(link.url, {
              responseType: 'arraybuffer',
              headers: {
                ...sessionHeaders,
                'Referer': movieUrl
              },
              timeout: 30000,
              maxRedirects: 5
            });

            // Zkontroluj jestli je to skutečný soubor
            const contentType = downloadResponse.headers['content-type'] || '';
            const contentLength = parseInt(downloadResponse.headers['content-length'] || '0');
            
            console.log(`📊 POPUP: Content-Type: ${contentType}, Size: ${contentLength} bytes`);
            
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
              console.log(`⚠️ POPUP: Neplatný soubor (velikost: ${contentLength}, typ: ${contentType})`);
              
              // Je to HTML stránka s countdown?
              if (contentType.includes('text/html')) {
                console.log(`🌐 POPUP: HTML stránka - parsuju popup HTML pro download ID!`);
                
                // DIRECT HTML PARSING APPROACH 🎯
                try {
                  const htmlContent = downloadResponse.data.toString();
                  console.log(`📝 POPUP: HTML délka: ${htmlContent.length} znaků`);
                  
                  // Debug snippet
                  const snippet = htmlContent.substring(0, 500);
                  console.log(`📄 POPUP HTML snippet: ${snippet}`);
                  
                  let finalDownloadId = null;
                  let finalDownloadUrl = null;
                  
                  // Metoda 1: RegEx pro idown.php?id=XXXXXX
                  const idMatch = htmlContent.match(/idown\.php\?id=(\d+)/);
                  if (idMatch) {
                    finalDownloadId = idMatch[1];
                    finalDownloadUrl = `https://www.titulky.com/idown.php?id=${finalDownloadId}`;
                    console.log(`🎯 POPUP: RegEx nalezl ID: ${finalDownloadId}`);
                  }
                  
                  // Metoda 2: Cheerio parsing
                  if (!finalDownloadId) {
                    const $popup = cheerio.load(htmlContent);
                    
                    // Hledej v různých atributech
                    $popup('a, button, script').each((i, element) => {
                      const $el = $popup(element);
                      const href = $el.attr('href') || '';
                      const onclick = $el.attr('onclick') || '';
                      const innerHTML = $el.html() || '';
                      
                      if (href.includes('idown.php') && href.includes('id=')) {
                        const match = href.match(/id=(\d+)/);
                        if (match) {
                          finalDownloadId = match[1];
                          finalDownloadUrl = `https://www.titulky.com${href}`;
                          console.log(`🎯 POPUP: Cheerio nalezl href ID: ${finalDownloadId}`);
                        }
                      }
                      
                      if (onclick.includes('idown.php') || innerHTML.includes('idown.php')) {
                        const match = (onclick + innerHTML).match(/(\d{6,})/);
                        if (match) {
                          finalDownloadId = match[1];
                          finalDownloadUrl = `https://www.titulky.com/idown.php?id=${finalDownloadId}`;
                          console.log(`🎯 POPUP: Cheerio nalezl onclick/innerHTML ID: ${finalDownloadId}`);
                        }
                      }
                    });
                  }
                  
                  // Metoda 3: Hledej jakékoliv dlouhé číslo (backup)
                  if (!finalDownloadId) {
                    const numberMatch = htmlContent.match(/(\d{7,})/);
                    if (numberMatch) {
                      finalDownloadId = numberMatch[1];
                      finalDownloadUrl = `https://www.titulky.com/idown.php?id=${finalDownloadId}`;
                      console.log(`🎯 POPUP: Backup metoda nalezla číslo: ${finalDownloadId}`);
                    }
                  }
                  
                  if (finalDownloadId && finalDownloadUrl) {
                    console.log(`✅ POPUP: Finální download URL: ${finalDownloadUrl}`);
                    console.log(`⏰ POPUP: Čekám 12 sekund na countdown před finálním downloadem...`);
                    
                    // Počkej na countdown
                    await new Promise(resolve => setTimeout(resolve, 12000));
                    
                    console.log(`📥 POPUP: Stahuji finální soubor po countdown`);
                    
                    // Finální download
                    const finalResponse = await axios.get(finalDownloadUrl, {
                      responseType: 'arraybuffer',
                      headers: {
                        ...sessionHeaders,
                        'Referer': link.url
                      },
                      timeout: 30000
                    });
                    
                    const finalContentType = finalResponse.headers['content-type'] || '';
                    const finalContentLength = parseInt(finalResponse.headers['content-length'] || '0');
                    
                    console.log(`📊 POPUP: Finální response - Type: ${finalContentType}, Size: ${finalContentLength} bytes`);
                    
                    if (finalContentLength > 1000 && (
                        finalContentType.includes('zip') || 
                        finalContentType.includes('rar') ||
                        finalContentType.includes('octet-stream') ||
                        finalContentType.includes('application'))) {
                      
                      console.log(`🎉 POPUP: SUCCESS! Získán soubor přes direct HTML parsing!`);
                      
                      // Zpracuj stažený soubor
                      const fileName = `${cleanTitle(movieTitle)}_popup_${Date.now()}`;
                      
                      let ext = '.zip';
                      if (finalContentType.includes('rar')) ext = '.rar';
                      else if (finalContentType.includes('zip')) ext = '.zip';
                      
                      const filePath = path.join(subsDir, fileName + ext);
                      fs.writeFileSync(filePath, finalResponse.data);
                      console.log(`💾 POPUP: Soubor uložen: ${filePath}`);

                      // Pokus o rozbalení ZIP
                      if (ext === '.zip') {
                        try {
                          const zip = new AdmZip(filePath);
                          const entries = zip.getEntries();
                          
                          for (const entry of entries) {
                            if (entry.entryName.endsWith('.srt') || entry.entryName.endsWith('.sub')) {
                              const extractPath = path.join(subsDir, `${fileName}.srt`);
                              fs.writeFileSync(extractPath, entry.getData());
                              console.log(`📂 POPUP: Rozbaleno: ${extractPath}`);
                              
                              return [{
                                id: `popup_success_${Date.now()}`,
                                url: `${BASE_URL}/subtitles/${fileName}.srt`,
                                lang: 'cze'
                              }];
                            }
                          }
                        } catch (zipError) {
                          console.log(`⚠️ POPUP: ZIP error: ${zipError.message}`);
                        }
                      }
                      
                      // Fallback - jako SRT
                      const srtPath = path.join(subsDir, `${fileName}.srt`);
                      try {
                        fs.renameSync(filePath, srtPath);
                        console.log(`✅ POPUP: Přejmenováno na SRT`);
                        
                        return [{
                          id: `popup_success_${Date.now()}`,
                          url: `${BASE_URL}/subtitles/${fileName}.srt`,
                          lang: 'cze'
                        }];
                      } catch (renameError) {
                        console.log(`❌ POPUP: Rename error: ${renameError.message}`);
                      }
                    } else {
                      console.log(`⚠️ POPUP: Finální response není platný soubor`);
                      console.log(`📄 POPUP: Response preview: ${finalResponse.data.toString().substring(0, 300)}`);
                    }
                  } else {
                    console.log(`❌ POPUP: Nepodařilo se najít download ID v HTML`);
                    console.log(`📄 POPUP: HTML pro debugging:`);
                    console.log(htmlContent.substring(0, 1000));
                  }
                  
                } catch (parseError) {
                  console.error(`❌ POPUP: HTML parsing error: ${parseError.message}`);
                }
                
                continue; // Zkus další timeout pokud direct parsing selhal
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
    <br>💪 Session management with login
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
app.listen(PORT, async () => {
  console.log(`🚀 ULTIMATE ADDON běží na portu ${PORT}`);
  console.log(`⚡ ULTIMATE APPROACH: Multiple timeouts + smart matching + LOGIN SESSION`);
  console.log(`🎯 Target: titulky.com via pure determination + authentication`);
  console.log(`🔥 Manifest: ${BASE_URL}/manifest.json`);
  
  if (process.env.BASE_URL) {
    console.log(`🌐 ULTIMATE URL: ${process.env.BASE_URL}`);
  }
  
  // Přihlas se při startu
  console.log(`\n🔐 ULTIMATE: Přihlašuji se k titulky.com...`);
  const loginSuccess = await loginToTitulky();
  
  if (loginSuccess) {
    console.log(`✅ ULTIMATE: Session připravena!`);
  } else {
    console.log(`⚠️ ULTIMATE: Login selhal, pokračuji anonymous`);
  }
  
  console.log(`\n⚡ ULTIMATE MODE ACTIVATED! ⚡`);
});

module.exports = builder.getInterface();
