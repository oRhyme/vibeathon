import { test, expect, type APIRequestContext } from "@playwright/test";
import type { Action, ActionResult } from "../src/domain/types";

async function command(request: APIRequestContext, action: Action) {
  const response = await request.post("/api/actions", { data: action });
  const result = (await response.json()) as ActionResult;
  expect(result.ok, `${action.type}: ${result.message}`).toBe(true);
  return result.state;
}
test.beforeEach(async ({ request }) => {
  await command(request, { type: "RESET" });
});

test("root home presents live role cards and opens each console", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".topbar-role-nav")).toBeVisible();
  await expect(page.getByText("Demo", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose the next good handoff." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("lenis")),
    )
    .toBe(true);
  await expect(page.locator(".home-role-card")).toHaveCount(4);
  await expect(page.locator(".home-card-icon-donor")).toHaveCount(1);
  await expect(page.locator(".home-card-icon-rider")).toHaveCount(1);
  await expect(page.locator(".home-card-icon-receiver")).toHaveCount(1);
  await expect(page.locator(".home-card-icon-operations")).toHaveCount(1);
  await expect(page.getByText("220 units ready · 2 stations")).toBeVisible();
  await expect(page.getByText("5/6 online · 5 available")).toBeVisible();
  await expect(page.getByText("5/5 open · 360 units requested")).toBeVisible();
  await expect(
    page.getByText("0 active relays · 0 need attention"),
  ).toBeVisible();
  for (const title of [
    "Donor",
    "Rider",
    "Receiving Point",
    "Operations Centre",
  ])
    await expect(
      page.getByRole("button", { name: `Open ${title}` }),
    ).toBeVisible();

  for (const [title, hash] of [
    ["Donor", "#donor"],
    ["Rider", "#rider"],
    ["Receiving Point", "#receiver"],
    ["Operations Centre", "#operations"],
  ] as const) {
    await page.getByRole("button", { name: `Open ${title}` }).click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains("lenis"),
        ),
      )
      .toBe(false);
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.locator(".topbar-role-nav")).toBeVisible();
    await expect(page.locator('nav[aria-label="Role views"]')).toHaveCount(0);
    for (const label of [
      "Operations control",
      "Donor desk",
      "Rider board",
      "Receiving points",
    ])
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    await page.getByRole("link", { name: "RelaySafe home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Choose the next good handoff." }),
    ).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  const cardTops = await page
    .locator(".home-role-card")
    .evaluateAll((cards) =>
      cards.map((card) => Math.round(card.getBoundingClientRect().top)),
    );
  expect(
    cardTops.every((top, index) => index === 0 || top > cardTops[index - 1]),
  ).toBe(true);
});

test("home motion respects reduced-motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Choose the next good handoff." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.documentElement.classList.contains("lenis"),
    ),
  ).toBe(false);
  expect(
    Number.parseFloat(
      await page
        .locator(".home-role-card")
        .first()
        .evaluate((card) => getComputedStyle(card).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.001);
});

test("role consoles keep the next action visible and secondary detail collapsed", async ({
  page,
}) => {
  for (const role of ["donor", "rider", "receiver"]) {
    await page.goto(`/#${role}`);
    await expect(page.locator(".role-hero")).toBeVisible();
    await expect(page.locator(".role-clock")).toBeVisible();
    await expect(page.locator(".role-details").first()).toBeVisible();
    await expect(
      page.locator("details.role-details").first(),
    ).not.toHaveAttribute("open");
  }
  await expect(
    page.getByLabel("Receiver open status", { exact: true }),
  ).toBeVisible();
});

test("desktop operations renders honest zero state and creates real split allocations", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#operations");
  await expect(
    page.getByRole("heading", { name: "Every relay counts." }),
  ).toBeVisible();
  await expect(page.locator(".dashboard-heading-glance")).toContainText(
    "21:00 IST",
  );
  await expect(
    page.getByRole("heading", { name: /Dispatch queue/ }),
  ).toBeVisible();
  const metricFontSize = await page
    .locator(".operations-dashboard .metric-value")
    .first()
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  expect(metricFontSize).toBeGreaterThanOrEqual(40);
  await expect(page.getByText("0 reserved for pickup")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export log" })).toBeVisible();
  await page.screenshot({ path: "test-results/relaysafe-desktop.png" });
  await page.getByRole("button", { name: "Auto-dispatch network" }).click();
  await expect(page.getByText("Decision confirmed")).toBeVisible();
  const state = await (await request.get("/api/state")).json();
  expect(
    state.reservations.reduce(
      (n: number, r: { quantity: number }) => n + r.quantity,
      0,
    ),
  ).toBe(180);
  expect(state.reservations.length).toBe(6);
  expect(errors).toEqual([]);
});

test("judge can demonstrate a ghost lease warning, release, and replacement from the UI", async ({
  page,
}) => {
  await page.goto("/#operations");
  await page.getByRole("button", { name: "Auto-dispatch network" }).click();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "+1 minute", exact: true }).click();
  await expect(
    page.getByText("warning inactive", { exact: true }).first(),
  ).toBeVisible();
  for (let i = 0; i < 2; i++)
    await page.getByRole("button", { name: "+1 minute", exact: true }).click();
  await expect(
    page.getByText("timed out", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("180 reserved for pickup")).toHaveCount(0);
  await page.goto("/#rider");
  await page.getByLabel("Rider", { exact: true }).selectOption("rider-6");
  // Controlled network-backed toggles change only after the server confirms them.
  await page.getByLabel("Online", { exact: true }).click();
  await expect(page.getByLabel("Online", { exact: true })).toBeChecked();
  await page.getByLabel("Available for assignments", { exact: true }).click();
  await expect(
    page.getByLabel("Available for assignments", { exact: true }),
  ).toBeChecked();
  await page.goto("/#operations");
  await page.getByRole("button", { name: "Auto-dispatch network" }).click();
  await expect(
    page.locator(".ledger-title").filter({ hasText: "Fatima" }).first(),
  ).toBeVisible();
});

test("pickup, in-transit closure, reroute and receipt work through real controls", async ({
  page,
  request,
}) => {
  const state = await command(request, {
    type: "RESERVE",
    batchId: "batch-1",
    riderId: "rider-1",
    receiverId: "receiver-2",
    quantity: 40,
  });
  const reservationId = state.reservations.at(-1)!.id;
  await page.goto("/#rider");
  await page.getByRole("button", { name: "Accept job", exact: true }).click();
  await page
    .getByRole("button", { name: "Start pickup trip", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Confirm donor arrival/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "+1 minute", exact: true }).click();
  await page.getByRole("button", { name: "+1 minute", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm donor arrival", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm physical pickup", exact: true })
    .click();
  await expect(
    page.locator(".role-shipment-lead > div:first-child > strong"),
  ).toHaveText("40 units");
  await page.goto("/#receiver");
  await page
    .getByLabel("Receiving point", { exact: true })
    .selectOption("receiver-2");
  const openForReceiving = page.getByLabel("Receiver open status", {
    exact: true,
  });
  await expect(openForReceiving).toBeChecked();
  await expect(openForReceiving).toBeEnabled();
  await openForReceiving.click();
  await expect(openForReceiving).not.toBeChecked();
  let latest = await (await request.get("/api/state")).json();
  const shipment = latest.shipments[0];
  expect(shipment.receiverId).not.toBe("receiver-2");
  await page.goto("/#rider");
  await expect(
    page.getByRole("button", { name: "Confirm delivery", exact: true }),
  ).toBeDisabled();
  while (latest.now < latest.shipments[0].eta) {
    await command(request, { type: "HEARTBEAT", reservationId });
    latest = await command(request, { type: "ADVANCE_TIME", minutes: 1 });
  }
  await expect(
    page.getByRole("button", { name: "Confirm delivery", exact: true }),
  ).toBeEnabled({ timeout: 5000 });
  await page
    .getByRole("button", { name: "Confirm delivery", exact: true })
    .click();
  await expect(
    page.getByText("40 units received", { exact: false }).first(),
  ).toBeVisible();
});

test("donor can post a batch and a second role sees the shared result", async ({
  page,
  context,
}) => {
  await page.goto("/#donor");
  await page.getByLabel("Quantity · units", { exact: true }).fill("27");
  await page.getByRole("button", { name: "Post batch", exact: false }).click();
  await expect(page.getByText("Batch posted.", { exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/#operations");
  await expect(
    second.getByText("27 units donated", { exact: false }),
  ).toBeVisible();
});

test("receiver missing cooking fuel exposes the exact safety reason", async ({
  page,
  request,
}) => {
  await page.goto("/#receiver");
  await page
    .getByLabel("Receiving point", { exact: true })
    .selectOption("receiver-5");
  await expect(page.getByText(/MISSING_COOKING_FUEL/).first()).toBeVisible();
  const response = await request.post("/api/actions", {
    data: {
      type: "RESERVE",
      batchId: "batch-2",
      riderId: "rider-1",
      receiverId: "receiver-5",
      quantity: 10,
    },
  });
  expect((await response.json()).code).toBe("MISSING_COOKING_FUEL");
});

for (const width of [1440, 768, 390])
  test(`all four role views fit ${width}px without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const role of ["operations", "donor", "rider", "receiver"]) {
      await page.goto(`/#${role}`);
      await expect(page.locator("h1")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${role} overflows at ${width}px`).toBe(false);
    }
    if (width === 390) {
      await page.goto("/");
      await page.screenshot({
        path: "test-results/relaysafe-mobile.png",
        fullPage: true,
      });
    }
  });
