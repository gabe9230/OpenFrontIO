import { afterEach, expect, test, vi } from "vitest";
import {
  KeyboardLayoutController,
  resetKeyboardLayoutForTests,
} from "../../src/client/KeyboardLayout";

const original = Object.getOwnPropertyDescriptor(navigator, "keyboard");
afterEach(() => {
  resetKeyboardLayoutForTests();
  if (original) Object.defineProperty(navigator, "keyboard", original);
  else Reflect.deleteProperty(navigator, "keyboard");
});

test("Chrome keyboard layout APIs without layoutchange events do not break page startup", async () => {
  const map = new Map([["KeyQ", "a"]]);
  Object.defineProperty(navigator, "keyboard", {
    configurable: true,
    value: { getLayoutMap: async () => map },
  });
  const host = { addController: vi.fn(), requestUpdate: vi.fn() };
  const controller = new KeyboardLayoutController(host as never);
  expect(() => controller.hostConnected()).not.toThrow();
  await Promise.resolve();
  expect(controller.map).toBe(map);
  expect(host.requestUpdate).toHaveBeenCalledOnce();
  controller.hostDisconnected();
});

test("browsers without a keyboard layout API retain static key labels", () => {
  Object.defineProperty(navigator, "keyboard", {
    configurable: true,
    value: undefined,
  });
  const controller = new KeyboardLayoutController({
    addController: vi.fn(),
    requestUpdate: vi.fn(),
  } as never);
  expect(() => controller.hostConnected()).not.toThrow();
  expect(controller.map).toBeNull();
  controller.hostDisconnected();
});
