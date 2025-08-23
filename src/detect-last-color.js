function detectLatestColor(text, latestColor) {
  const colorRegex = /\x1b\[[0-9;]*m/g;
  const matches = text.match(colorRegex);
  
  if (matches == null || matches.length <= 0) {
    return latestColor;
  }

  for (const match of matches) {
    if (match === '\x1b[0m' || match === '\x1b[m') {
      latestColor = '';
    } else if (!latestColor.includes(match)) {
      latestColor += match;
    }
  }

  return latestColor;
}

module.exports = detectLatestColor;