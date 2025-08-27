const applyFormattingCodes = require("./apply-formatting-codes");

function extractFormattingCodes(text, currentFormattingCodes = []) {
  const colorRegex = /\x1b\[[0-9;]*m/g;
  const matches = text.match(colorRegex);
  if (matches == null || matches.length <= 0) {
    return [];
  }

  for (const match of matches) {
    const formattingCodes = match.slice(2, -1).split(";");
    if (
      formattingCodes.length === 1 &&
      formattingCodes[0] === ""
    ) {
      currentFormattingCodes.splice(0);
      continue;
    }

    applyFormattingCodes(currentFormattingCodes, formattingCodes);
  }

  return currentFormattingCodes;
}

module.exports = extractFormattingCodes;
