async function run() {
  const HARDCOVER_TOKEN = process.env.HARDCOVER_TOKEN || "";
  if (!HARDCOVER_TOKEN) throw new Error("Set HARDCOVER_TOKEN in the environment before running this test.");
  const res = await fetch("https://api.hardcover.app/v1/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${HARDCOVER_TOKEN}`
    },
    body: JSON.stringify({
      query: `query { books(where: {title: {_eq: "The Great Gatsby"}}, limit: 1) { id title user_books(where: {review: {_is_null: false}}, limit: 5) { rating review user { name username } } } }`
    })
  });
  console.log(await res.text());
}
run();
