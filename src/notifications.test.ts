import { describe, expect, test } from "bun:test";
import { shouldNotifyOnUnknownVisibility } from "./notifications";

describe("notifications", () => {
  test("notifies on unknown visibility by default", () => {
    expect(shouldNotifyOnUnknownVisibility({})).toBe(true);
  });

  test("can suppress unknown visibility notifications", () => {
    expect(shouldNotifyOnUnknownVisibility({ THUD_NOTIFY_ON_UNKNOWN_VISIBILITY: "0" })).toBe(false);
    expect(shouldNotifyOnUnknownVisibility({ THUD_NOTIFY_ON_UNKNOWN_VISIBILITY: "false" })).toBe(
      false,
    );
  });
});
