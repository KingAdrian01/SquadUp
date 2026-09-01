const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// 1. JavaScript-Dateien verschleiern
const filesToObfuscate = ['app.js', 'dd-logic.js'];

filesToObfuscate.forEach(file => {
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
  }
});

// 2. CSS-Datei Kommentaren befreien und minifizieren
const cssFile = 'style.css';
const cssPath = path.join(__dirname, cssFile);
if (fs.existsSync(cssPath)) {
  let cssCode = fs.readFileSync(cssPath, 'utf8');

  cssCode = cssCode.replace(/\/\*[\s\S]*?\*\//g, '');

  cssCode = cssCode
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .trim();

  fs.writeFileSync(cssPath, cssCode, 'utf8');
  console.log(`✅ ${cssFile} Kommentare entfernt & minifiziert!`);
}