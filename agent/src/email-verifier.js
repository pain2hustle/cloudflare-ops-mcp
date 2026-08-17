import { Agent } from "agents";
import { cleanText, sha256 } from "./contracts.js";

export class EmailVerifier extends Agent {
  initialState = { tests: {} };

  async beginTest({ id, code, expires_at }) {
    const tests = { ...(this.state.tests || {}) };
    tests[id] = {
      id,
      code_hash: await sha256(code),
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at,
      confirmed_at: null,
    };
    this.setState({ tests: this.trim(tests) });
    return { id, status: "pending", expires_at };
  }

  async onEmail(email) {
    if (Number(email.rawSize || 0) > 262144) {
      email.setReject("Verification message too large");
      return;
    }
    const raw = new TextDecoder().decode(await email.getRaw());
    const codes = [...raw.matchAll(/AMHWT-[A-Z0-9-]{16,80}/g)].map((match) => match[0]);
    const tests = { ...(this.state.tests || {}) };
    let matched = null;
    for (const code of codes.slice(0, 8)) {
      const digest = await sha256(code);
      matched = Object.values(tests).find((test) => test.status === "pending" && test.code_hash === digest);
      if (matched) break;
    }
    if (!matched) {
      console.warn(JSON.stringify({ service: "amh-wt-email-verifier", kind: "unmatched_email", raw_size: email.rawSize, from_hash: (await sha256(cleanText(email.from, 320))).slice(0, 16) }));
      return;
    }
    tests[matched.id] = { ...matched, status: "confirmed", confirmed_at: new Date().toISOString() };
    this.setState({ tests: this.trim(tests) });
    console.log(JSON.stringify({ service: "amh-wt-email-verifier", kind: "email_loopback_confirmed", test_id: matched.id }));
  }

  async testStatus(id) {
    const test = this.state.tests?.[id];
    if (!test) return null;
    if (test.status === "pending" && Date.now() > Date.parse(test.expires_at)) return { ...test, status: "expired", code_hash: undefined };
    return { ...test, code_hash: undefined };
  }

  trim(tests) {
    const cutoff = Date.now() - 86400000;
    return Object.fromEntries(Object.entries(tests).filter(([, test]) => Date.parse(test.created_at) >= cutoff).slice(-50));
  }
}
