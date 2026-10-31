import { describe, expect, it } from "vitest";
import type { LicenseView } from "../api/types";
import { leavesSubscriptionRunning, onSubscription, publisherWords, standardWords } from "./License";

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
    expect(leavesSubscriptionRunning({ ...owned("yearly"), subscriptionShared: true }, "lifetime")).toBe(false);
  });
});

describe("Publisher on top of TBV for life", () => {
  const onTop = (forLife: boolean): LicenseView => ({ ...owned("lifetime"), publisher: true, publisherForLife: forLife });
  it("counts a Publisher subscription on top of TBV for life as a subscription", () => {
    expect(onSubscription(onTop(false))).toBe(true);
    expect(leavesSubscriptionRunning(onTop(false), "publisherUpgrade")).toBe(true);
  });
  it("doesn't once Publisher is owned for good", () => {
    expect(onSubscription(onTop(true))).toBe(false);
    expect(onSubscription(owned("lifetime"))).toBe(false);
  });
});

describe("Your plan's words", () => {
  const view = (more: Partial<LicenseView>): LicenseView => ({ ...owned(null), monthlyPrice: "$2.99", yearlyPrice: "$19.99", publisherMonthlyPrice: "$9.99", publisherYearlyPrice: "$39.99", ...more });
  it("names the exact Standard plan", () => {
    expect(standardWords(view({ plan: "monthly" }))).toMatch(/^TBV Standard Monthly, \$2.99 a month/);
    expect(standardWords(view({ plan: "yearly" }))).toMatch(/^TBV Standard Annual, \$19.99 a year/);
    expect(standardWords(view({ plan: "lifetime" }))).toMatch(/^TBV Standard Lifetime/);
    expect(standardWords(view({ plan: "yearly", publisher: true, publisherPlan: "yearly" }))).toBe("Included with your TBV Publisher Annual subscription.");
    expect(standardWords(view({ plan: "lifetime", publisher: true, publisherForLife: true }))).toMatch(/^Included with TBV Publisher Lifetime/);
  });
  it("names the exact Publisher plan", () => {
    expect(publisherWords(view({ plan: "lifetime", publisher: true, publisherPlan: "monthly" }))).toMatch(/^TBV Publisher Monthly, \$9.99 a month/);
    expect(publisherWords(view({ plan: "lifetime", publisher: true, publisherForLife: true }))).toMatch(/^TBV Publisher Lifetime/);
  });
});
