import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isEmailAllowed } from "./index.js";

const ENV_KEYS = ["OPTIO_ALLOWED_EMAIL_DOMAINS", "OPTIO_ALLOWED_EMAILS"] as const;

describe("isEmailAllowed", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("when nothing is configured", () => {
    it("allows any address, preserving upstream open-signup behaviour", () => {
      expect(isEmailAllowed("anyone@example.com")).toBe(true);
      expect(isEmailAllowed("someone@gmail.com")).toBe(true);
    });

    it("allows even an empty address, since no policy is being enforced", () => {
      expect(isEmailAllowed("")).toBe(true);
    });
  });

  describe("domain allowlist", () => {
    it("admits an address in the configured domain", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "lightningstep.com";
      expect(isEmailAllowed("tony@lightningstep.com")).toBe(true);
    });

    it("rejects an address outside it", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "lightningstep.com";
      expect(isEmailAllowed("attacker@gmail.com")).toBe(false);
    });

    it("is case-insensitive on both sides", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "LightningStep.COM";
      expect(isEmailAllowed("Tony@LIGHTNINGSTEP.com")).toBe(true);
    });

    it("accepts several domains and tolerates whitespace and @ or . prefixes", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = " @lightningstep.com , .lsapp.cloud ";
      expect(isEmailAllowed("tony@lightningstep.com")).toBe(true);
      expect(isEmailAllowed("bot@lsapp.cloud")).toBe(true);
      expect(isEmailAllowed("nope@example.com")).toBe(false);
    });

    it("does not treat a subdomain as a match for its parent", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "lightningstep.com";
      expect(isEmailAllowed("tony@evil.lightningstep.com")).toBe(false);
    });

    it("cannot be fooled by a domain that merely ends with an allowed one", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "lightningstep.com";
      expect(isEmailAllowed("attacker@notlightningstep.com")).toBe(false);
      expect(isEmailAllowed("attacker@lightningstep.com.evil.tld")).toBe(false);
    });

    it("rejects a malformed address once a policy is in force", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "lightningstep.com";
      expect(isEmailAllowed("")).toBe(false);
      expect(isEmailAllowed("no-at-sign")).toBe(false);
      expect(isEmailAllowed("@lightningstep.com")).toBe(false);
      expect(isEmailAllowed("tony@")).toBe(false);
    });

    it("uses the last @ segment so an address cannot smuggle a domain in the local part", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "lightningstep.com";
      expect(isEmailAllowed("tony@lightningstep.com@gmail.com")).toBe(false);
    });
  });

  describe("explicit address allowlist", () => {
    it("admits a listed address whose domain is not allowed", () => {
      process.env.OPTIO_ALLOWED_EMAILS = "contractor@gmail.com";
      expect(isEmailAllowed("contractor@gmail.com")).toBe(true);
      expect(isEmailAllowed("other@gmail.com")).toBe(false);
    });

    it("is case-insensitive and tolerates whitespace", () => {
      process.env.OPTIO_ALLOWED_EMAILS = " Contractor@Gmail.com ,second@x.io ";
      expect(isEmailAllowed("contractor@gmail.com")).toBe(true);
      expect(isEmailAllowed("SECOND@X.IO")).toBe(true);
    });
  });

  describe("both configured", () => {
    it("admits an address matching either list", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = "lightningstep.com";
      process.env.OPTIO_ALLOWED_EMAILS = "contractor@gmail.com";
      expect(isEmailAllowed("tony@lightningstep.com")).toBe(true);
      expect(isEmailAllowed("contractor@gmail.com")).toBe(true);
      expect(isEmailAllowed("stranger@example.com")).toBe(false);
    });
  });

  describe("configured but empty", () => {
    it("treats a value of only separators as no policy at all", () => {
      process.env.OPTIO_ALLOWED_EMAIL_DOMAINS = " , ";
      expect(isEmailAllowed("anyone@example.com")).toBe(true);
    });
  });
});
