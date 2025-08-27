const {
  RESET_ALL,
  RESET_FOREGROUND,
  RESET_BACKGROUND,

  SET_BOLD,
  SET_DIM,
  SET_ITALIC,
  SET_UNDERLINE,
  SET_SLOW_BLINK,
  SET_RAPID_BLINK,
  SET_REVERSE,
  SET_HIDE,
  SET_STRIKETHROUGH,
  SET_DOUBLE_UNDERLINE,

  RESET_BOLD_DIM,
  RESET_ITALIC,
  RESET_UNDERLINE,
  RESET_BLINK,
  RESET_REVERSE,
  RESET_HIDE,
  RESET_STRIKETHROUGH,

  SET_FG_BLACK,
  SET_FG_RED,
  SET_FG_GREEN,
  SET_FG_YELLOW,
  SET_FG_BLUE,
  SET_FG_MAGENTA,
  SET_FG_CYAN,
  SET_FG_WHITE,

  SET_BG_BLACK,
  SET_BG_RED,
  SET_BG_GREEN,
  SET_BG_YELLOW,
  SET_BG_BLUE,
  SET_BG_MAGENTA,
  SET_BG_CYAN,
  SET_BG_WHITE,

  SET_FG_BRIGHT_BLACK,
  SET_FG_BRIGHT_RED,
  SET_FG_BRIGHT_GREEN,
  SET_FG_BRIGHT_YELLOW,
  SET_FG_BRIGHT_BLUE,
  SET_FG_BRIGHT_MAGENTA,
  SET_FG_BRIGHT_CYAN,
  SET_FG_BRIGHT_WHITE,

  SET_BG_BRIGHT_BLACK,
  SET_BG_BRIGHT_RED,
  SET_BG_BRIGHT_GREEN,
  SET_BG_BRIGHT_YELLOW,
  SET_BG_BRIGHT_BLUE,
  SET_BG_BRIGHT_MAGENTA,
  SET_BG_BRIGHT_CYAN,
  SET_BG_BRIGHT_WHITE,

  SET_FG_COLOR,
  SET_BG_COLOR,

  COLOR_MODE_256,
  COLOR_MODE_RGB,

  FOREGROUND_INDEX,
  BACKGROUND_INDEX,
  BOLD_DIM_INDEX,
  ITALIC_INDEX,
  UNDERLINE_INDEX,
  BLINK_INDEX,
  REVERSE_INDEX,
  HIDE_INDEX,
  STRIKETHROUGH_INDEX,
} = require("./constants");

function applyFormattingCodes(currentCodes, codes) {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    switch (code) {
      case RESET_ALL: {
        currentCodes.splice(0);
        break;
      }
      case RESET_FOREGROUND: {
        currentCodes[FOREGROUND_INDEX] = undefined;
        break;
      }
      case RESET_BACKGROUND: {
        currentCodes[BACKGROUND_INDEX] = undefined;
        break;
      }
      case RESET_BOLD_DIM: {
        currentCodes[BOLD_DIM_INDEX] = undefined;
        break;
      }
      case RESET_ITALIC: {
        currentCodes[ITALIC_INDEX] = undefined;
        break;
      }
      case RESET_UNDERLINE: {
        currentCodes[UNDERLINE_INDEX] = undefined;
        break;
      }
      case RESET_BLINK: {
        currentCodes[BLINK_INDEX] = undefined;
        break;
      }
      case RESET_REVERSE: {
        currentCodes[REVERSE_INDEX] = undefined;
        break;
      }
      case RESET_HIDE: {
        currentCodes[HIDE_INDEX] = undefined;
        break;
      }
      case RESET_STRIKETHROUGH: {
        currentCodes[STRIKETHROUGH_INDEX] = undefined;
        break;
      }
      case SET_FG_BLACK:
      case SET_FG_RED:
      case SET_FG_GREEN:
      case SET_FG_YELLOW:
      case SET_FG_BLUE:
      case SET_FG_MAGENTA:
      case SET_FG_CYAN:
      case SET_FG_WHITE:
      case SET_FG_BRIGHT_BLACK:
      case SET_FG_BRIGHT_RED:
      case SET_FG_BRIGHT_GREEN:
      case SET_FG_BRIGHT_YELLOW:
      case SET_FG_BRIGHT_BLUE:
      case SET_FG_BRIGHT_MAGENTA:
      case SET_FG_BRIGHT_CYAN:
      case SET_FG_BRIGHT_WHITE:
      case SET_FG_COLOR: {
        if (code === SET_FG_COLOR) {
          const nextCode = codes[i + 1];
          let finalCode = `${code};${nextCode}`;
          if (nextCode === COLOR_MODE_256) {
            finalCode = `${finalCode};${codes[i + 2]}`;
            i += 2;
          } else {
            finalCode = `${finalCode};${codes[i + 2]};${codes[i + 3]};${codes[i + 4]}`;
            i += 4;
          }
          currentCodes[FOREGROUND_INDEX] = finalCode;
        } else {
          currentCodes[FOREGROUND_INDEX] = code;
        }
        break;
      }
      case SET_BG_BLACK:
      case SET_BG_RED:
      case SET_BG_GREEN:
      case SET_BG_YELLOW:
      case SET_BG_BLUE:
      case SET_BG_MAGENTA:
      case SET_BG_CYAN:
      case SET_BG_WHITE:
      case SET_BG_BRIGHT_BLACK:
      case SET_BG_BRIGHT_RED:
      case SET_BG_BRIGHT_GREEN:
      case SET_BG_BRIGHT_YELLOW:
      case SET_BG_BRIGHT_BLUE:
      case SET_BG_BRIGHT_MAGENTA:
      case SET_BG_BRIGHT_CYAN:
      case SET_BG_BRIGHT_WHITE:
      case SET_BG_COLOR: {
        if (code === SET_BG_COLOR) {
          const nextCode = codes[i + 1];
          let finalCode = `${code};${nextCode}`;
          if (nextCode === COLOR_MODE_256) {
            finalCode = `${finalCode};${codes[i + 2]}`;
            i += 2;
          } else {
            finalCode = `${finalCode};${codes[i + 2]};${codes[i + 3]};${codes[i + 4]}`;
            i += 4;
          }
          currentCodes[BACKGROUND_INDEX] = finalCode;
        } else {
          currentCodes[BACKGROUND_INDEX] = code;
        }
        break;
      }
      case SET_BOLD:
      case SET_DIM: {
        currentCodes[BOLD_DIM_INDEX] = code;
        break;
      }
      case SET_ITALIC: {
        currentCodes[ITALIC_INDEX] = code;
        break;
      }
      case SET_UNDERLINE:
      case SET_DOUBLE_UNDERLINE: {
        currentCodes[UNDERLINE_INDEX] = code;
        break;
      }
      case SET_SLOW_BLINK:
      case SET_RAPID_BLINK: {
        currentCodes[BLINK_INDEX] = code;
        break;
      }
      case SET_REVERSE: {
        currentCodes[REVERSE_INDEX] = code;
        break;
      }
      case SET_HIDE: {
        currentCodes[HIDE_INDEX] = code;
        break;
      }
      case SET_STRIKETHROUGH: {
        currentCodes[STRIKETHROUGH_INDEX] = code;
        break;
      }
    }
  }
}

module.exports = applyFormattingCodes;
