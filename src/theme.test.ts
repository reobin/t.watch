import { describe, expect, mock, test } from "bun:test";
import { RGBA, type CliRenderer, type TerminalColors } from "@opentui/core";
import { detectRenderTheme } from "./theme";

describe("detectRenderTheme", () => {
  test("blends terminal foreground into the selected background", async () => {
    const theme = await detectRenderTheme(
      renderer({
        colors: colors({ defaultBackground: "#000000", defaultForeground: "#ffffff" }),
        themeMode: "dark",
      }),
      100,
    );

    expect(theme.selectedBg?.equals(RGBA.fromInts(20, 20, 20))).toBe(true);
    expect(theme.textMutedFg?.equals(RGBA.fromInts(188, 188, 188))).toBe(true);
  });

  test("uses the light fallback when palette detection fails", async () => {
    const theme = await detectRenderTheme(
      renderer({ colorsError: new Error("palette timeout"), waitThemeMode: "light" }),
      100,
    );

    expect(theme.selectedBg?.slot).toBe(254);
  });

  test("uses renderer theme mode before waiting for one", async () => {
    const waitForThemeMode = mock(async () => "light" as const);
    const theme = await detectRenderTheme(
      renderer({ colors: undefined, themeMode: "dark", waitForThemeMode }),
      100,
    );

    expect(theme.selectedBg?.slot).toBe(235);
    expect(waitForThemeMode).not.toHaveBeenCalled();
  });

  test("derives muted foreground for light backgrounds", async () => {
    const theme = await detectRenderTheme(
      renderer({
        colors: colors({ defaultBackground: "#ffffff", defaultForeground: "#000000" }),
        themeMode: "light",
      }),
      100,
    );

    expect(theme.selectedBg?.equals(RGBA.fromInts(235, 235, 235))).toBe(true);
    expect(theme.textMutedFg?.equals(RGBA.fromInts(83, 83, 83))).toBe(true);
  });
});

function renderer(input: {
  colors?: TerminalColors;
  colorsError?: Error;
  themeMode?: "dark" | "light";
  waitThemeMode?: "dark" | "light";
  waitForThemeMode?: (timeout: number) => Promise<"dark" | "light">;
}): CliRenderer {
  return {
    getPalette: mock(async () => {
      if (input.colorsError) {
        throw input.colorsError;
      }

      return input.colors;
    }),
    themeMode: input.themeMode,
    waitForThemeMode: input.waitForThemeMode ?? mock(async () => input.waitThemeMode ?? "dark"),
  } as unknown as CliRenderer;
}

function colors(input: Partial<TerminalColors>): TerminalColors {
  return {
    palette: [],
    ...input,
  } as TerminalColors;
}
