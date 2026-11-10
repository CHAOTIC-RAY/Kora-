/**
 * Guards for the plugin source relay.
 */
import {
  executeSourceFetch,
  urlAllowedForPluginBase,
  isPublicLegalSourceHost,
} from "../sourceFetchRelay";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log("PASS ", name);
  } else {
    fail++;
    console.log("FAIL ", name, detail);
  }
}

check("gutendex host is public-legal", isPublicLegalSourceHost("gutendex.com"));
check(
  "target under plugin base is allowed",
  urlAllowedForPluginBase(new URL("https://gutendex.com/books/?search=x"), "https://gutendex.com")
);
check(
  "random host blocked for gutenberg base",
  !urlAllowedForPluginBase(new URL("https://evil.example/book"), "https://gutendex.com")
);
async function runAsyncChecks() {
  check(
    "localhost blocked by SSRF",
    !(await executeSourceFetch({ url: "http://127.0.0.1/", baseUrl: "https://gutendex.com" })).ok
  );
  const missing = await executeSourceFetch({ url: "https://gutendex.com/books", baseUrl: "" });
  check("missing base rejected", missing.status === 400);
}

await runAsyncChecks();

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
