// Preloaded into generate-snake-animation (NODE_OPTIONS=--import) so the snake
// eats the combined contribution grid of several GitHub accounts.
//
// The generator asks GitHub's GraphQL API for one user's calendar. This wraps
// fetch: that request is repeated for every login in SNAKE_EXTRA_USERS, the
// daily counts are summed by date, and the levels are recomputed from the
// combined counts. Private contributions only count where the account shows
// them on its profile ("Include private contributions on my profile").

const extraUsers = (process.env.SNAKE_EXTRA_USERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const LEVELS = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];

const realFetch = globalThis.fetch;

const fetchCalendar = async (url, init, body, login) => {
  const res = await realFetch(url, {
    ...init,
    body: JSON.stringify({ ...body, variables: { ...body.variables, login } }),
  });
  if (!res.ok) throw new Error(`${login}: ${await res.text().catch(() => res.statusText)}`);
  const json = await res.json();
  if (json.errors?.[0]) throw new Error(`${login}: ${json.errors[0].message}`);
  if (!json.data?.user) throw new Error(`${login}: user not found`);
  return json;
};

// Level 1-4 by quartile of the non-zero days, as GitHub draws its own grid.
const levelOf = (count, sorted) => {
  if (count === 0) return 0;
  const at = (q) => sorted[Math.floor((sorted.length - 1) * q)];
  if (count <= at(0.25)) return 1;
  if (count <= at(0.5)) return 2;
  if (count <= at(0.75)) return 3;
  return 4;
};

globalThis.fetch = async (url, init) => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  const login = body?.variables?.login;
  if (!String(url).endsWith("/graphql") || !login || extraUsers.length === 0) {
    return realFetch(url, init);
  }

  const logins = [login, ...extraUsers];
  const [primary, ...extras] = await Promise.all(
    logins.map((l) => fetchCalendar(url, init, body, l)),
  );

  const extraByDate = new Map();
  for (const json of extras) {
    for (const week of json.data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        extraByDate.set(day.date, (extraByDate.get(day.date) ?? 0) + day.contributionCount);
      }
    }
  }

  const weeks = primary.data.user.contributionsCollection.contributionCalendar.weeks;
  const days = weeks.flatMap((w) => w.contributionDays);
  for (const day of days) day.contributionCount += extraByDate.get(day.date) ?? 0;

  const sorted = days.map((d) => d.contributionCount).filter((c) => c > 0).sort((a, b) => a - b);
  for (const day of days) day.contributionLevel = LEVELS[levelOf(day.contributionCount, sorted)];

  const total = days.reduce((sum, d) => sum + d.contributionCount, 0);
  console.log(`🐍 merged ${logins.join(" + ")}: ${total} contributions`);

  return new Response(JSON.stringify(primary), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
