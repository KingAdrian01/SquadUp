const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// 1. JavaScript-Dateien verschleiern
const jsFiles = [
  'app.js',
  'busfahrer.js',
  'pferderennen.js',
  'state.js',
  'dd-logic.js'
];

jsFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const code = fs.readFileSync(filePath, 'utf8');

    const obfuscatedResult = JavaScriptObfuscator.obfuscate(code, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      identifierNamesGenerator: 'hexadecimal',
      removeComments: true
    });

    fs.writeFileSync(filePath, obfuscatedResult.getObfuscatedCode(), 'utf8');
    console.log(`✅ ${file} erfolgreich verschleiert!`);
  } else {
    console.warn(`⚠️ ${file} nicht gefunden, übersprungen.`);
  }
});

// 2. CSS-Dateien von Kommentaren befreien und minifizieren
const cssFiles = ['style.css', 'pferderennen.css'];

cssFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    let cssCode = fs.readFileSync(filePath, 'utf8');

    // Kommentare entfernen
    cssCode = cssCode.replace(/\/\*[\s\S]*?\*\//g, '');

    // Whitespace minifizieren
    cssCode = cssCode
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,])\s*/g, '$1')
      .trim();

    fs.writeFileSync(filePath, cssCode, 'utf8');
    console.log(`✅ ${file} Kommentare entfernt & minifiziert!`);
  } else {
    console.warn(`⚠️ ${file} nicht gefunden, übersprungen.`);
  }
});

// 3. index.html von Kommentaren befreien
const htmlFile = 'index.html';
const htmlPath = path.join(__dirname, htmlFile);

if (fs.existsSync(htmlPath)) {
  let htmlCode = fs.readFileSync(htmlPath, 'utf8');

  // Alle HTML-Kommentare <!-- ... --> entfernen
  htmlCode = htmlCode.replace(/<!--(?![\s\S]*?-->)[\s\S]*?-->|<!--[\s\S]*?-->/g, '');

  // Überflüssige leere Zeilen bereinigen
  htmlCode = htmlCode.replace(/^\s*[\r\n]/gm, '');

  fs.writeFileSync(htmlPath, htmlCode, 'utf8');
  console.log(`✅ ${htmlFile} Kommentare entfernt & bereinigt!`);
} else {
  console.warn(`⚠️ ${htmlFile} nicht gefunden, übersprungen.`);
}