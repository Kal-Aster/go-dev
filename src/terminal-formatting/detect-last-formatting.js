const extractFormattingCodes = require("./extract-formatting-codes");

function detectLastFormatting(text, latestFormatting) {
  const currentFormattingCodes = extractFormattingCodes(latestFormatting);
  const latestFormattingCodes = extractFormattingCodes(text, currentFormattingCodes);

  return latestFormattingCodes.filter(code => code != null).map(code => `\x1b[${code}m`).join("");
}

module.exports = detectLastFormatting;
