/**
 * SSRF guard tests.
 *
 * The bug being locked down: `/api/proxy-image` blocked four exact hostnames
 * and nothing else, so `http://10.0.0.1/`, `http://192.168.1.1/` and
 * `http://[::1]/` all fetched happily. These assert the ranges are refused,
 * including the IPv4-mapped-IPv6 form that would otherwise walk straight
 * past the v6 check and back into the v4 one.
 */
import { assertSafeFetchTarget, isPrivateIPv4, isPrivateIPv6 } from "../ssrfGuard";

let pass = 0,
  fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) {
    pass++;
    console.log("PASS ", n);
  } else {
    fail++;
    console.log("FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`);
  }
};

const refused = (url: string, label = url) =>
  ok(`refuses ${label}`, assertSafeFetchTarget(url).ok === false, assertSafeFetchTarget(url));

/* The required ranges, plus the neighbours that must still be allowed. */
refused("http://127.0.0.1/", "loopback 127.0.0.1");
refused("http://127.0.0.53:8080/x", "loopback on a port");
refused("http://10.0.0.1/", "RFC1918 10/8");
refused("http://10.255.255.254/", "RFC1918 10/8 upper edge");
refused("http://172.16.0.1/", "RFC1918 172.16/12");
refused("http://172.31.255.254/", "RFC1918 172.16/12 upper edge");
refused("http://192.168.1.1/", "RFC1918 192.168/16");
refused("http://169.254.169.254/latest/meta-data/", "cloud metadata endpoint");
refused("http://169.254.1.1/", "link-local 169.254/16");
refused("http://[::1]/", "IPv6 loopback");
refused("http://[fe80::1]/", "IPv6 link-local");
refused("http://[fc00::1]/", "IPv6 unique-local");
refused("http://[::ffff:10.0.0.1]/", "IPv4-mapped IPv6 bypass");
refused("http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback bypass");
refused("http://localhost/", "localhost");
refused("http://metadata.google.internal/", "GCP metadata name");
refused("http://0.0.0.0/", "0.0.0.0");
refused("http://255.255.255.255/", "broadcast");
refused("http://100.64.0.1/", "CGNAT 100.64/10");
refused("http://intranet/", "bare single-label hostname");
refused("file:///etc/passwd", "file scheme");
refused("gopher://127.0.0.1:11211/", "gopher scheme");
refused("ftp://example.com/", "ftp scheme");
refused("not a url", "malformed input");
refused("http://", "empty host");

/* Public hosts must still work — an over-broad guard would break the app. */
const allowed = (url: string, label = url) =>
  ok(`allows ${label}`, assertSafeFetchTarget(url).ok === true, assertSafeFetchTarget(url).reason);
allowed("https://libgen.li/get.php?md5=abc");
allowed("https://booksdl.lc/download/1234.epub");
allowed("https://archive.org/download/x/y.epub");
allowed("https://annas-archive.org/dl/...");
allowed("https://172.32.0.1/", "172.32/12 — just OUTSIDE RFC1918");
allowed("https://11.0.0.1/", "11/8 — just OUTSIDE 10/8");
allowed("https://9.255.255.255/", "just below 10/8");
allowed("https://192.169.0.1/", "just above 192.168/16");
allowed("https://1.1.1.1/", "public IP");

/* Predicate-level checks. */
ok("isPrivateIPv4 rejects 10.0.0.1", isPrivateIPv4("10.0.0.1") === true);
ok("isPrivateIPv4 rejects 169.254.169.254", isPrivateIPv4("169.254.169.254") === true);
ok("isPrivateIPv4 accepts 8.8.8.8", isPrivateIPv4("8.8.8.8") === false);
ok("isPrivateIPv4 rejects a non-IP", isPrivateIPv4("libgen.li") === false);
ok("isPrivateIPv4 rejects out-of-range octets", isPrivateIPv4("999.1.1.1") === false);
ok("isPrivateIPv6 rejects ::1", isPrivateIPv6("::1") === true);
ok("isPrivateIPv6 catches mapped v4 private ranges", isPrivateIPv6("::ffff:192.168.0.1") === true);
ok("isPrivateIPv6 accepts a public address", isPrivateIPv6("2606:4700:4700::1111") === false);

/* The refusal reason must not leak the blocked address, or the endpoint
   becomes an internal port scanner through its error text. */
const leaked = ["http://169.254.169.254/", "http://10.0.0.1:8080/", "http://[::1]:22/"].filter((u) => {
  const r = assertSafeFetchTarget(u);
  return /169\.254|10\.0\.0\.1|::1/.test(r.reason || "");
});
ok("refusal reasons never echo the blocked address", leaked.length === 0, leaked);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);