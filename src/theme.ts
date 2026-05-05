import { RGBA, type CliRenderer, type TerminalColors } from "@opentui/core";
import type { RenderTheme } from "./render";

const selectedBgBlend = 0.08;
const textMutedPaleOffset = 8;

export async function detectRenderTheme(
  renderer: CliRenderer,
  paletteTimeoutMs: number,
): Promise<RenderTheme> {
  const colors = await renderer
    .getPalette({ timeout: paletteTimeoutMs })
    .catch((): TerminalColors | undefined => undefined);
  const themeMode = renderer.themeMode ?? (await renderer.waitForThemeMode(paletteTimeoutMs));
  const isDark = themeMode ? themeMode === "dark" : colors ? hasDarkBackground(colors) : true;
  const selectedBg = colors && selectedBackgroundFromTerminal(colors);
  const textMutedFg = colors && textMutedForegroundFromTerminal(colors, isDark);

  if (selectedBg) {
    return { selectedBg, textMutedFg };
  }

  return { selectedBg: RGBA.fromIndex(themeMode === "light" ? 254 : 235), textMutedFg };
}

function selectedBackgroundFromTerminal(colors: TerminalColors): RGBA | undefined {
  if (!colors.defaultBackground || !colors.defaultForeground) {
    return undefined;
  }

  const foreground = RGBA.fromHex(colors.defaultForeground);
  const background = RGBA.fromHex(colors.defaultBackground);
  const [foregroundRed, foregroundGreen, foregroundBlue] = foreground.toInts();
  const [backgroundRed, backgroundGreen, backgroundBlue] = background.toInts();

  return RGBA.fromInts(
    blendColor(backgroundRed, foregroundRed),
    blendColor(backgroundGreen, foregroundGreen),
    blendColor(backgroundBlue, foregroundBlue),
  );
}

function textMutedForegroundFromTerminal(
  colors: TerminalColors,
  isDark: boolean,
): RGBA | undefined {
  const background = colors.defaultBackground ?? colors.palette[0];

  return background ? generateMutedTextColor(RGBA.fromHex(background), isDark) : undefined;
}

function hasDarkBackground(colors: TerminalColors): boolean {
  const background = colors.defaultBackground ?? colors.palette[0];

  if (!background) {
    return true;
  }

  const [red, green, blue] = RGBA.fromHex(background).toInts();

  return luminance(red, green, blue) < 128;
}

function generateMutedTextColor(background: RGBA, isDark: boolean): RGBA {
  const [red, green, blue] = background.toInts();
  const backgroundLuminance = luminance(red, green, blue);
  let gray: number;

  if (isDark) {
    gray =
      backgroundLuminance < 10 ? 180 : Math.min(Math.floor(160 + backgroundLuminance * 0.3), 200);
  } else {
    gray =
      backgroundLuminance > 245
        ? 75
        : Math.max(Math.floor(100 - (255 - backgroundLuminance) * 0.2), 60);
  }

  const paleGray = Math.min(gray + textMutedPaleOffset, 255);

  return RGBA.fromInts(paleGray, paleGray, paleGray);
}

function luminance(red: number, green: number, blue: number): number {
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function blendColor(base: number, overlay: number, amount = selectedBgBlend): number {
  return Math.round(base + (overlay - base) * amount);
}
