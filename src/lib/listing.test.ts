import { describe, expect, it } from "vitest";
import { validateListing, parseRequirements, type ListingDraft } from "./listing";

const TODAY = "2030-06-01";
const valid: ListingDraft = {
  headliner: "Field Mode",
  venueId: "venue-1",
  date: "2030-07-10",
  doorsTime: "19:00",
  setTime: "20:00",
  performanceLengthMins: 30,
  expectedAttendance: 250,
  genres: ["Indie"],
  artistSizeFit: ["emerging"],
  supportFee: 150,
  travelContribution: 20,
  bookingFee: 10,
  applicationDeadline: "2030-07-01",
  requirementsText: "Own backline\n",
  description: "",
  isUrgent: false,
};

describe("validateListing", () => {
  it("accepts a valid listing", () => {
    expect(validateListing(valid, TODAY)).toEqual({});
  });

  it("rejects dates in the past and a deadline after the show", () => {
    expect(validateListing({ ...valid, date: "2030-05-01", applicationDeadline: "2030-04-01" }, TODAY)).toMatchObject({
      date: expect.stringMatching(/past/),
      applicationDeadline: expect.stringMatching(/past/),
    });
    expect(validateListing({ ...valid, applicationDeadline: "2030-07-11" }, TODAY).applicationDeadline).toMatch(/on or before/);
  });

  it("lets an edit keep an already-past date it didn't change", () => {
    const past = { ...valid, date: "2030-05-01", applicationDeadline: "2030-04-20" };
    expect(validateListing(past, TODAY, { date: "2030-05-01", applicationDeadline: "2030-04-20" })).toEqual({});
  });

  it("checks times, money and counts against the database's limits", () => {
    const e = validateListing(
      { ...valid, setTime: "18:00", performanceLengthMins: 3, supportFee: -1, travelContribution: 6000, bookingFee: 9, expectedAttendance: 0, genres: [] },
      TODAY
    );
    expect(Object.keys(e).sort()).toEqual(["bookingFee", "expectedAttendance", "genres", "performanceLengthMins", "setTime", "supportFee", "travelContribution"]);
  });

  it("rejects fractional pounds and NaN (the database stores whole pounds)", () => {
    expect(validateListing({ ...valid, supportFee: 12.5 }, TODAY).supportFee).toBeDefined();
    expect(validateListing({ ...valid, supportFee: NaN }, TODAY).supportFee).toBeDefined();
  });

  it("requires a headliner and venue, and caps requirements at 10", () => {
    expect(validateListing({ ...valid, headliner: "   ", venueId: "" }, TODAY)).toMatchObject({ headliner: expect.any(String), venueId: expect.any(String) });
    const many = Array.from({ length: 11 }, (_, i) => `r${i}`).join("\n");
    expect(validateListing({ ...valid, requirementsText: many }, TODAY).requirementsText).toBeDefined();
    expect(parseRequirements(" a \n\n b\n")).toEqual(["a", "b"]);
  });
});
