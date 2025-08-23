const detectLatestColor = require("./detect-last-color");

function prefixLines(text, prefix, latestColor) {
  let prefixedText = text.split('\n').map(line => {
    latestColor = detectLatestColor(line, latestColor);
    return `${prefix} ${latestColor}${line}${latestColor !== '' ? '\x1b[0m' : ''}`;
  }).join('\n');

  if (prefixedText.endsWith(`${prefix} `)) {
    prefixedText = prefixedText.slice(0, -(`${prefix} `).length);
  }
  if (!prefixedText.endsWith('\n')) {
    prefixedText = prefixedText + '\n';
  }
  prefixedText = prefixedText.replace(/\x1b\[(?:2J|3J|H)|\x1bc|\x1b\[2K|\x1b\[K/gi, '');

  return { prefixedText, latestColor };
}

module.exports = prefixLines;