const PALETTE = [
  91, 92, 93, 94, 95, 96, // bright red, green, yellow, blue, magenta, cyan
  31, 32, 33, 34, 35, 36, // standard variants of the same
];

function shuffle(input) {
  const arr = input.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const shuffledPalette = shuffle(PALETTE);
const colorByKey = new Map();

function keyFor(name, mode, taskIndex) {
  if (taskIndex == null) return `${name}\0${mode}`;
  return `${name}\0${mode}\0${taskIndex}`;
}

function colorForKey(key) {
  let color = colorByKey.get(key);
  if (color != null) return color;
  color = shuffledPalette[colorByKey.size % shuffledPalette.length];
  colorByKey.set(key, color);
  return color;
}

function colorize(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function buildColoredPrefix(name, mode, taskIndex) {
  const color = colorForKey(keyFor(name, mode, taskIndex));
  const taskSegment = taskIndex != null ? `${taskIndex}:` : '';
  return colorize(`${name}:${mode}:${taskSegment}`, color);
}

function buildColoredTag(name, mode) {
  return colorize(`${name}:${mode}`, colorForKey(keyFor(name, mode)));
}

function colorService(name, mode) {
  return colorize(name, colorForKey(keyFor(name, mode)));
}

function colorMode(name, mode) {
  return colorize(mode, colorForKey(keyFor(name, mode)));
}

module.exports = {
  buildColoredPrefix,
  buildColoredTag,
  colorService,
  colorMode,
};
