/**
 * Per-country local news feeds.
 *
 * The "Local" topic used to be hardcoded to Maldives, which showed Maldivian
 * news to every user. Feeds are now chosen by country, so the topic means
 * "news from where you are" rather than "news from where we are".
 *
 * Country is matched on ISO 3166-1 alpha-2. A country with no entry here
 * falls back to a worldwide set rather than showing nothing.
 */
import type { FeedSubscription } from "./feedStorage";

export interface CountryFeeds {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  name: string;
  feeds: Omit<FeedSubscription, "id" | "addedAt">[];
}

/** Used when a country has no curated set, and before the user picks one. */
export const WORLDWIDE_FEEDS: Omit<FeedSubscription, "id" | "addedAt">[] = [
  { title: "BBC World", siteUrl: "https://www.bbc.com/news/world", feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { title: "The Guardian World", siteUrl: "https://www.theguardian.com/world", feedUrl: "https://www.theguardian.com/world/rss" },
  { title: "Al Jazeera", siteUrl: "https://www.aljazeera.com/", feedUrl: "https://www.aljazeera.com/xml/rss/all.xml" },
  { title: "NPR News", siteUrl: "https://www.npr.org/", feedUrl: "https://feeds.npr.org/1001/rss.xml" },
];

export const COUNTRY_FEEDS: CountryFeeds[] = [
  {
    code: "MV",
    name: "Maldives",
    feeds: [
      { title: "Maldives Independent", siteUrl: "https://maldivesindependent.com", feedUrl: "https://maldivesindependent.com/api/rss" },
      { title: "PSM News", siteUrl: "https://psmnews.mv/en/", feedUrl: "https://psmnews.mv/en/feed/" },
      { title: "Edition", siteUrl: "https://edition.mv/", feedUrl: "kora://edition.mv/latest" },
      { title: "Sun MV", siteUrl: "https://sun.mv/", feedUrl: "kora://sun.mv/latest" },
      { title: "Avas", siteUrl: "https://avas.mv/", feedUrl: "kora://avas.mv/latest" },
    ],
  },
  {
    code: "US",
    name: "United States",
    feeds: [
      { title: "NPR News", siteUrl: "https://www.npr.org/", feedUrl: "https://feeds.npr.org/1001/rss.xml" },
      { title: "The New York Times", siteUrl: "https://www.nytimes.com/", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
      { title: "The Washington Post", siteUrl: "https://www.washingtonpost.com/", feedUrl: "https://feeds.washingtonpost.com/rss/world" },
      { title: "AP News", siteUrl: "https://abcnews.go.com/", feedUrl: "https://abcnews.go.com/abcnews/topstories" },
    ],
  },
  {
    code: "GB",
    name: "United Kingdom",
    feeds: [
      { title: "BBC News", siteUrl: "https://www.bbc.co.uk/news", feedUrl: "https://feeds.bbci.co.uk/news/rss.xml" },
      { title: "The Guardian", siteUrl: "https://www.theguardian.com/uk", feedUrl: "https://www.theguardian.com/uk/rss" },
      { title: "Sky News", siteUrl: "https://news.sky.com/uk", feedUrl: "https://feeds.skynews.com/feeds/rss/uk.xml" },
      { title: "The Independent", siteUrl: "https://www.independent.co.uk/", feedUrl: "https://www.independent.co.uk/news/uk/rss" },
      { title: "Financial Times", siteUrl: "https://www.ft.com/", feedUrl: "https://www.ft.com/rss/home" },
    ],
  },
  {
    code: "IN",
    name: "India",
    feeds: [
      { title: "The Hindu", siteUrl: "https://www.thehindu.com/", feedUrl: "https://www.thehindu.com/news/national/feeder/default.rss" },
      { title: "NDTV", siteUrl: "https://www.ndtv.com/", feedUrl: "https://feeds.feedburner.com/ndtvnews-top-stories" },
      { title: "Indian Express", siteUrl: "https://indianexpress.com/", feedUrl: "https://indianexpress.com/section/india/feed/" },
      { title: "Times of India", siteUrl: "https://timesofindia.indiatimes.com/", feedUrl: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms" },
      { title: "Scroll.in", siteUrl: "https://scroll.in/", feedUrl: "https://feeds.feedburner.com/ScrollinArticles.rss" },
    ],
  },
  {
    code: "AE",
    name: "United Arab Emirates",
    feeds: [
      { title: "BBC Middle East", siteUrl: "https://www.bbc.com/news/world/middle_east", feedUrl: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
      { title: "Arab News", siteUrl: "https://www.arabnews.com/", feedUrl: "https://www.arabnews.com/rss.xml" },
      { title: "Asharq Al-Awsat", siteUrl: "https://aawsat.com/", feedUrl: "https://aawsat.com/feed/" },
      { title: "The Middle East Eye", siteUrl: "https://www.middleeasteye.net/", feedUrl: "https://www.middleeasteye.net/rss" },
    ],
  },
  {
    code: "AU",
    name: "Australia",
    feeds: [
      { title: "ABC News Australia", siteUrl: "https://www.abc.net.au/news", feedUrl: "https://www.abc.net.au/news/feed/51120/rss.xml" },
      { title: "The Guardian Australia", siteUrl: "https://www.theguardian.com/australia-news", feedUrl: "https://www.theguardian.com/au/rss" },
      { title: "The Conversation AU", siteUrl: "https://theconversation.com/au", feedUrl: "https://theconversation.com/au/articles.atom" },
    ],
  },
  {
    code: "CA",
    name: "Canada",
    feeds: [
      { title: "CBC News", siteUrl: "https://www.cbc.ca/news", feedUrl: "https://www.cbc.ca/webfeed/rss/rss-topstories" },
      { title: "Global News", siteUrl: "https://globalnews.ca/", feedUrl: "https://globalnews.ca/feed/" },
      { title: "NPR", siteUrl: "https://www.npr.org/", feedUrl: "https://feeds.npr.org/1001/rss.xml" },
    ],
  },
  {
    code: "MY",
    name: "Malaysia",
    feeds: [
      { title: "Malay Mail", siteUrl: "https://www.malaymail.com/", feedUrl: "https://www.malaymail.com/feed/rss" },
      { title: "Free Malaysia Today", siteUrl: "https://www.freemalaysiatoday.com/", feedUrl: "https://www.freemalaysiatoday.com/feed" },
      { title: "The Straits Times", siteUrl: "https://www.straitstimes.com/", feedUrl: "https://www.straitstimes.com/news/world/rss.xml" },
    ],
  },
  {
    code: "PK",
    name: "Pakistan",
    feeds: [
      { title: "Dawn", siteUrl: "https://www.dawn.com/", feedUrl: "https://www.dawn.com/feeds/home" },
    ],
  },
  {
    code: "DE",
    name: "Germany",
    feeds: [
      { title: "Deutsche Welle", siteUrl: "https://www.dw.com/", feedUrl: "https://rss.dw.com/rdf/rss-en-all" },
      { title: "Der Spiegel", siteUrl: "https://www.spiegel.de/", feedUrl: "https://www.spiegel.de/schlagzeilen/tops/index.rss" },
      { title: "Tagesschau", siteUrl: "https://www.tagesschau.de/", feedUrl: "https://www.tagesschau.de/index~rss2.xml" },
    ],
  },
  {
    code: "FR",
    name: "France",
    feeds: [
      { title: "Le Monde", siteUrl: "https://www.lemonde.fr/", feedUrl: "https://www.lemonde.fr/rss/une.xml" },
      { title: "France 24", siteUrl: "https://www.france24.com/", feedUrl: "https://www.france24.com/en/rss" },
    ],
  },
  {
    code: "SA",
    name: "Saudi Arabia",
    feeds: [
      { title: "Arab News", siteUrl: "https://www.arabnews.com/", feedUrl: "https://www.arabnews.com/rss.xml" },
      { title: "Asharq Al-Awsat", siteUrl: "https://aawsat.com/", feedUrl: "https://aawsat.com/feed/" },
    ],
  },
  {
    code: "BD",
    name: "Bangladesh",
    feeds: [
      { title: "The Daily Star", siteUrl: "https://www.thedailystar.net/", feedUrl: "https://www.thedailystar.net/frontpage/rss.xml" },
    ],
  },
  {
    code: "SG",
    name: "Singapore",
    feeds: [
      { title: "CNA", siteUrl: "https://www.channelnewsasia.com/", feedUrl: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml" },
      { title: "The Straits Times", siteUrl: "https://www.straitstimes.com/", feedUrl: "https://www.straitstimes.com/news/world/rss.xml" },
      { title: "Mothership", siteUrl: "https://www.mothership.sg/", feedUrl: "https://www.mothership.sg/feed" },
    ],
  },
  {
    code: "JP",
    name: "Japan",
    feeds: [
      { title: "The Japan Times", siteUrl: "https://www.japantimes.co.jp/", feedUrl: "https://www.japantimes.co.jp/feed/" },
      { title: "NHK News", siteUrl: "https://www.nhk.or.jp/", feedUrl: "https://www.nhk.or.jp/rss/news/cat0.xml" },
    ],
  },
  {
    code: "NZ",
    name: "New Zealand",
    feeds: [
      { title: "RNZ", siteUrl: "https://www.rnz.co.nz/", feedUrl: "https://www.rnz.co.nz/rss/national.xml" },
      { title: "The Spinoff", siteUrl: "https://thespinoff.co.nz/", feedUrl: "https://thespinoff.co.nz/feed" },
    ],
  },
];

/** Countries offered in the picker, alphabetical by display name. */
export const COUNTRY_OPTIONS: { code: string; name: string }[] = [...COUNTRY_FEEDS]
  .map((c) => ({ code: c.code, name: c.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function feedsForCountry(code: string | null | undefined) {
  const c = (code || "").trim().toUpperCase();
  const hit = COUNTRY_FEEDS.find((x) => x.code === c);
  return hit ? hit.feeds : WORLDWIDE_FEEDS;
}

export function countryName(code: string | null | undefined): string {
  const c = (code || "").trim().toUpperCase();
  return COUNTRY_FEEDS.find((x) => x.code === c)?.name || "";
}
