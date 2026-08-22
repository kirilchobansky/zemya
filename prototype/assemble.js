const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const data = R('world-data.json');
const ui = R('src/ui.html');
const js = ['src/geo.js', 'src/map.js', 'src/quiz.js', 'src/app.js'].map(R).join('\n');

const cut = ui.indexOf('<div id="shell">');
const headPart = ui.slice(0, cut).trim();
const bodyPart = ui.slice(cut).trim();

const script = `<script>
(function(){
"use strict";
const WORLD = ${data};
${js}
})();
</script>`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });

// 1. Artifact build — page content only; the host wraps it in the document skeleton.
fs.writeFileSync(path.join(__dirname, 'dist/zemya-artifact.html'),
  `${headPart}\n\n${bodyPart}\n\n${script}\n`);

// 2. Standalone build — a complete offline document.
fs.writeFileSync(path.join(__dirname, 'dist/zemya-prototype.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Zemya — an interactive atlas built for learning geography: country dossiers, choropleths, true-size comparison, spaced repetition and nine kinds of quiz.">
<meta name="color-scheme" content="dark">
${headPart}
</head>
<body>
${bodyPart}
${script}
</body>
</html>
`);

for (const f of ['dist/zemya-prototype.html', 'dist/zemya-artifact.html']) {
  console.log(f, (fs.statSync(path.join(__dirname, f)).size / 1024).toFixed(0) + ' KB');
}
