const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

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