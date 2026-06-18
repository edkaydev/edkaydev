const fs = require("fs");
const https = require("https");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const USERNAME = process.env.GITHUB_ACTOR || "edkaydev";

async function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getRecentActivity() {
  const events = await fetch(
    `https://api.github.com/users/${USERNAME}/events?per_page=10`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "User-Agent": "auto-post",
      },
    }
  );

  return events
    .filter((e) => ["PushEvent", "CreateEvent", "IssuesEvent", "PullRequestEvent", "WatchEvent", "ForkEvent"].includes(e.type))
    .slice(0, 5)
    .map((e) => {
      const repo = e.repo.name;
      const type = e.type.replace("Event", "");
      let detail = "";
      if (e.type === "PushEvent" && e.payload.commits) {
        detail = e.payload.commits.map((c) => c.message.split("\n")[0]).join("; ");
      }
      if (e.type === "IssuesEvent") detail = `${e.payload.action}: ${e.payload.issue?.title}`;
      if (e.type === "PullRequestEvent") detail = `${e.payload.action}: ${e.payload.pull_request?.title}`;
      if (e.type === "CreateEvent") detail = `Created ${e.payload.ref_type} ${e.payload.ref || ""}`;
      if (e.type === "WatchEvent") detail = "Starred";
      if (e.type === "ForkEvent") detail = "Forked";
      return `${type} in ${repo}${detail ? ` - ${detail}` : ""}`;
    })
    .join("\n");
}

async function generatePost(activity) {
  const prompt = `You are a developer posting on LinkedIn. Write a short, professional, and engaging LinkedIn post (max 250 words) based on this GitHub activity. Use a conversational tone. Include relevant hashtags at the end. Do not use emojis excessively (1-2 max). Here's the activity:\n\n${activity || "The developer has been actively coding and building projects."}`;

  const body = JSON.stringify({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
    temperature: 0.7,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  return res.choices?.[0]?.message?.content || "";
}

async function sendToZapier(post) {
  if (!ZAPIER_WEBHOOK_URL) {
    console.log("No Zapier webhook configured. Generated post:\n");
    console.log(post);
    return;
  }

  await fetch(ZAPIER_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: post }),
  });

  console.log("Post sent to Zapier successfully");
}

(async () => {
  try {
    console.log(`Fetching recent activity for ${USERNAME}...`);
    const activity = await getRecentActivity();
    console.log("Recent activity:\n", activity);

    console.log("Generating post...");
    const post = await generatePost(activity);
    console.log("Generated post:\n", post);

    await sendToZapier(post);
    console.log("Done!");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
