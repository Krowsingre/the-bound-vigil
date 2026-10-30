import { describe, expect, it } from "vitest";
import type { LicenseView } from "../api/types";
import { leavesSubscriptionRunning } from "./License";

const owned = (plan: LicenseView["plan"], shop: LicenseView["shop"] = "apple"): LicenseView => ({ state: "owned", daysLeft: 0, trialEnds: 0, trialDays: 0, shop, price: "$59.99", plan });

describe("buying while subscribed", () => {
  it("warns whenever a lifetime purchase leaves a subscription charging", () => {
    expect(leavesSubscriptionRunning(owned("yearly"), "lifetime")).toBe(true);
    expect(leavesSubscriptionRunning(owned("monthly"), "publisherLifetime")).toBe(true);
    expect(leavesSubscriptionRunning(owned("monthly", "microsoft"), "lifetime")).toBe(true);
  });

  it("lets the App Store move between its own subscriptions, but not the Microsoft Store", () => {
    expect(leavesSubscriptionRunning(owned("monthly"), "publisherYearly")).toBe(false);
    expect(leavesSubscriptionRunning(owned("monthly", "microsoft"), "publisherYearly")).toBe(true);
  });

  it("says nothing to those without a subscription", () => {
    expect(leavesSubscriptionRunning(owned("lifetime"), "publisherUpgrade")).toBe(false);
    expect(leavesSubscriptionRunning({ ...owned(null), state: "trial" }, "lifetime")).toBe(false);
    expect(leavesSubscriptionRunning(null, "lifetime")).toBe(false);
  });
});
