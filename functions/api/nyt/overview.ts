export const onRequest = async () => {
  try {
    const res = await fetch("https://api.nytimes.com/svc/books/v3/lists/overview.json?api-key=" + (process.env.NYT_API_KEY || ""));
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch NYT data" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
