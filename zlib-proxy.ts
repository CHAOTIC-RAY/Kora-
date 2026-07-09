import express from "express";
const router = express.Router();

router.use(express.json());

router.post("/login", async (req, res) => {
  try {
    const { email, password, baseUrl } = req.body;
    if (!baseUrl) return res.status(400).json({ error: "Missing baseUrl" });
    
    const body = new URLSearchParams();
    body.append("email", email);
    body.append("password", password);
    
    const response = await fetch(`${baseUrl}/eapi/user/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Z-Library plugin KOReader"
      },
      body: body.toString()
    });
    
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/search", async (req, res) => {
  try {
    const { query, page = 1, limit = 50, baseUrl, user_id, user_key } = req.body;
    if (!baseUrl) return res.status(400).json({ error: "Missing baseUrl" });
    
    const body = new URLSearchParams();
    body.append("message", query);
    body.append("page", String(page));
    body.append("limit", String(limit));
    
    const headers: any = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Z-Library plugin KOReader"
    };
    
    if (user_id && user_key) {
      headers["Cookie"] = `remix_userid=${user_id}; remix_userkey=${user_key}`;
    }
    
    const response = await fetch(`${baseUrl}/eapi/book/search`, {
      method: "POST",
      headers,
      body: body.toString()
    });
    
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/download-link", async (req, res) => {
  try {
    const { book_id, book_hash, baseUrl, user_id, user_key } = req.body;
    if (!baseUrl || !book_id || !book_hash) return res.status(400).json({ error: "Missing parameters" });
    
    const headers: any = {
      "User-Agent": "Z-Library plugin KOReader"
    };
    if (user_id && user_key) {
      headers["Cookie"] = `remix_userid=${user_id}; remix_userkey=${user_key}`;
    }
    
    const response = await fetch(`${baseUrl}/eapi/book/${book_id}/${book_hash}/file`, {
      headers
    });
    
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/download", async (req, res) => {
  try {
    const { download_url, user_id, user_key } = req.body;
    if (!download_url) return res.status(400).json({ error: "Missing download_url" });
    
    const headers: any = {
      "User-Agent": "Z-Library plugin KOReader"
    };
    if (user_id && user_key) {
      headers["Cookie"] = `remix_userid=${user_id}; remix_userkey=${user_key}`;
    }
    
    const response = await fetch(download_url, { headers });
    if (!response.ok) {
      throw new Error(`Z-Lib responded with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    
    // Check if there is a content-disposition header to preserve filename
    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition) {
      res.setHeader("Content-Disposition", contentDisposition);
    }
    
    // Pipe the response stream
    if (!response.body) throw new Error("Empty response body from Z-Lib");
    const reader = response.body.getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const FALLBACK_DOMAINS = {
  success: 1,
  domains: [
    { domain: "z-library.sk", contentAvailable: true, isRedirector: false },
    { domain: "article.sk", contentAvailable: true, isRedirector: false },
    { domain: "articles.sk", contentAvailable: true, isRedirector: false },
    { domain: "proxy.zlibraryproxies.workers.dev", contentAvailable: true, isRedirector: false },
    { domain: "1lib.su" },
    { domain: "zlib.by" },
    { domain: "101ml.su" },
    { domain: "zlib.re" }
  ]
};

// Supported both GET and POST to prevent client-side routing mismatches,
// and added robust parsing with a fallback of domains
const handleDomainsRequest = async (req: express.Request, res: express.Response) => {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/ZlibraryKO/zlibrary.koplugin/main/assets/domains.json`, {
      signal: AbortSignal.timeout(4000) // 4 second timeout
    });
    if (!response.ok) {
      throw new Error(`GitHub raw domains.json returned status ${response.status}`);
    }
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e: any) {
      throw new Error(`Failed to parse domains JSON: ${e.message}`);
    }
    
    if (data && Array.isArray(data.domains) && data.domains.length > 0) {
      return res.json(data);
    }
    throw new Error("No domains found in response");
  } catch (error: any) {
    console.error("Z-Lib domains fetch failed, falling back to cached active domains. Error:", error.message);
    return res.json(FALLBACK_DOMAINS);
  }
};

router.get("/domains", handleDomainsRequest);
router.post("/domains", handleDomainsRequest);

export default router;
