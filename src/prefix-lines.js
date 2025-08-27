const detectLastFormatting = require("./terminal-formatting/detect-last-formatting");

function prefixLines(text, prefix, latestFormatting) {
  let prefixedText = text.split('\n').map(line => {
    latestFormatting = detectLastFormatting(line, latestFormatting);
    return `${prefix} ${latestFormatting}${line}${latestFormatting !== '' ? '\x1b[0m' : ''}`;
  }).join('\n');

  if (prefixedText.endsWith(`${prefix} `)) {
    prefixedText = prefixedText.slice(0, -(`${prefix} `).length);
  }
  if (!prefixedText.endsWith('\n')) {
    prefixedText = prefixedText + '\n';
  }
  prefixedText = prefixedText.replace(/\x1b\[(?:2J|3J|H)|\x1bc|\x1b\[2K|\x1b\[K/gi, '');

  return { prefixedText, lastFormatting: latestFormatting };
}

module.exports = prefixLines;